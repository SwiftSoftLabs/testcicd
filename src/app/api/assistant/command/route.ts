import { NextResponse } from "next/server";
import { assertAssistantAiTier } from "@/lib/assistant/aiTierGate";
import { runAssistantCommand } from "@/lib/assistant/assistantOrchestrator";
import { logAssistantCommand } from "@/lib/assistant/assistantSchema";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import { toAccessResponse } from "@/lib/rbac/http";
import { requireSessionUser } from "@/lib/rbac/workspace-access";
import type {
  AssistantCommandSource,
  AssistantPageContext,
} from "@/types/assistant";

export const runtime = "nodejs";

function parsePageContext(raw: unknown): AssistantPageContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pathname =
    typeof o.pathname === "string" ? o.pathname.trim().slice(0, 300) : "/dashboard";
  return {
    pathname: pathname || "/dashboard",
    workspaceId:
      typeof o.workspaceId === "string" ? o.workspaceId.trim() : null,
    projectId: typeof o.projectId === "string" ? o.projectId.trim() : null,
    conversationId:
      typeof o.conversationId === "string" ? o.conversationId.trim() : null,
    emailMessageId:
      typeof o.emailMessageId === "string" ? o.emailMessageId.trim() : null,
    taskId: typeof o.taskId === "string" ? o.taskId.trim() : null,
  };
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(request);

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
    }

    const rate = checkSimpleRateLimit(`assistant:${user.id}`, 30, 600_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many voice commands. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((rate.retryAfterMs ?? 60_000) / 1000)),
          },
        },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const transcript =
      typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (!transcript) {
      return NextResponse.json({ error: "transcript is required" }, { status: 400 });
    }

    const pageContext = parsePageContext(body.pageContext);
    if (!pageContext) {
      return NextResponse.json({ error: "pageContext is required" }, { status: 400 });
    }

    const tierCheck = await assertAssistantAiTier(pageContext.workspaceId);
    if (!tierCheck.allowed) {
      return NextResponse.json(
        { error: tierCheck.message ?? "AI tier not sufficient." },
        { status: 403 },
      );
    }

    const source: AssistantCommandSource | undefined =
      body.source === "voice" || body.source === "typed"
        ? body.source
        : undefined;

    const result = await runAssistantCommand({
      apiKey,
      userId: user.id,
      transcript,
      pageContext,
      source,
    });

    await logAssistantCommand({
      userId: user.id,
      workspaceId: pageContext.workspaceId,
      transcript,
      toolName: result.toolName,
      toolArgs: result.unsupported ? { unsupported: true } : undefined,
      outcome: result.unsupported ? "unsupported" : "ok",
      spokenReply: result.spokenReply,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    const access = toAccessResponse(e);
    if (access) return access;

    const httpStatus =
      e && typeof e === "object" && "httpStatus" in e
        ? Number((e as { httpStatus: number }).httpStatus)
        : 500;
    const msg = e instanceof Error ? e.message : "Assistant command failed";
    if (httpStatus >= 400 && httpStatus < 600) {
      return NextResponse.json({ error: msg }, { status: httpStatus });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
