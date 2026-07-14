import { toAccessResponse } from "@/lib/rbac/http";
import { requireTaskRead } from "@/lib/rbac/task-access";
import { requireSessionUser } from "@/lib/rbac/workspace-access";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import { mapTaskAiError, runTaskAi, type TaskAiKind } from "@/lib/tasks/taskAiService";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isPerTaskKind(v: string): v is TaskAiKind {
  return v === "improve" || v === "subtasks" || v === "estimate";
}

/**
 * Back-compat entrypoint for task detail AI. Prefer POST /api/tasks/ai with { kind, taskId }.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
  const user = await requireSessionUser(request);

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const rate = checkSimpleRateLimit(`task-ai:${user.id}`, 40, 900_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many task AI requests. Try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rate.retryAfterMs ?? 60_000) / 1000)),
        },
      },
    );
  }

  const { id: taskId } = await params;
  await requireTaskRead(taskId, user.id);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const typeRaw = typeof body.type === "string" ? body.type.trim() : "";
  if (!isPerTaskKind(typeRaw)) {
    return NextResponse.json({ error: "Invalid suggestion type" }, { status: 400 });
  }

  try {
    const result = await runTaskAi({
      apiKey,
      kind: typeRaw,
      userId: user.id,
      taskId,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Task AI failed";
    if (msg === "Task not found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    const mapped = mapTaskAiError(e);
    return NextResponse.json({ error: mapped.message }, { status: mapped.httpStatus });
  }
  } catch (e: unknown) {
    const access = toAccessResponse(e);
    if (access) return access;
    const msg = e instanceof Error ? e.message : "Task AI failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
