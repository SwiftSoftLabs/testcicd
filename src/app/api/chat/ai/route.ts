import { checkSimpleRateLimit } from "@/lib/email/rateLimit";
import {
  requireConversationAccess,
  loadMessagesForAi,
} from "@/lib/chat/chatAccess";
import { toAccessResponse } from "@/lib/rbac/http";
import { requireSessionUser } from "@/lib/rbac/workspace-access";
import {
  chatAiCacheGet,
  chatAiCacheKey,
  chatAiCacheSet,
} from "@/lib/chat/chatAiResponseCache";
import { runChatAi, type ChatAiKind, mapChatAiError } from "@/lib/chat/chatAiService";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isChatAiKind(v: string): v is ChatAiKind {
  return v === "improve" || v === "proofread" || v === "suggest_reply" || v === "thread_digest";
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireSessionUser(request);
  } catch (e: unknown) {
    const access = toAccessResponse(e);
    if (access) return access;
    throw e;
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "AI is not configured." }, { status: 503 });
  }

  const rate = checkSimpleRateLimit(`chat-ai:${user.id}`, 35, 900_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many chat AI requests. Try again later." },
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

  const kindRaw =
    (typeof body.kind === "string" && body.kind.trim()) ||
    (typeof body.type === "string" && body.type.trim()) ||
    "";
  if (!isChatAiKind(kindRaw)) {
    return NextResponse.json({ error: "Invalid or missing kind" }, { status: 400 });
  }
  const kind = kindRaw;

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId.trim() : "";
  if (!UUID_RE.test(conversationId)) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  let conv;
  try {
    conv = await requireConversationAccess(conversationId, user.id);
  } catch (e: unknown) {
    const access = toAccessResponse(e);
    if (access) return access;
    throw e;
  }

  const draft = typeof body.draft === "string" ? body.draft : "";
  const sinceUnread = body.sinceUnread !== false;

  let messages = await loadMessagesForAi(conversationId, {
    since: sinceUnread && kind === "thread_digest" ? conv.lastReadAt : null,
    limit: kind === "suggest_reply" ? 30 : 80,
  });

  if (kind === "thread_digest" && sinceUnread && conv.lastReadAt && messages.length === 0) {
    messages = await loadMessagesForAi(conversationId, { limit: 40 });
  }

  if ((kind === "improve" || kind === "proofread") && !draft.trim()) {
    return NextResponse.json({ error: "draft is required" }, { status: 400 });
  }
  if (kind === "suggest_reply" && messages.length === 0) {
    return NextResponse.json({ error: "No messages to reply to" }, { status: 400 });
  }

  const cacheable = kind === "thread_digest" || kind === "suggest_reply";
  let cacheKey: string | null = null;
  if (cacheable) {
    const sig = messages.map((m) => [m.id, m.content.slice(0, 80)]);
    cacheKey = chatAiCacheKey([
      "v1",
      user.id,
      kind,
      conversationId,
      sig,
      kind === "suggest_reply" ? draft.trim().slice(0, 200) : "",
    ]);
    const hit = chatAiCacheGet(cacheKey);
    if (hit) return NextResponse.json({ ...hit, cached: true });
  }

  try {
    const result = await runChatAi({
      apiKey,
      kind,
      userId: user.id,
      conversationName: conv.name || "chat",
      conversationType: conv.type,
      draft: draft || undefined,
      messages,
    });
    if (cacheKey) chatAiCacheSet(cacheKey, result);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Chat AI failed";
    if (
      msg === "draft is required" ||
      msg === "No messages to reply to" ||
      msg === "Could not parse reply suggestions" ||
      msg === "Could not parse improved text"
    ) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const mapped = mapChatAiError(e);
    return NextResponse.json({ error: mapped.message }, { status: mapped.httpStatus });
  }
}
