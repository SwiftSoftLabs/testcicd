import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import {
  createDraftMeetingTask,
  getWorkspaceContextText,
} from "@/lib/ai/meetingTools";
import { getCallSession } from "@/lib/calls/access";
import { query, SCHEMA } from "@/lib/db";
import { checkSimpleRateLimit } from "@/lib/email/rateLimit";

export const runtime = "nodejs";

interface LlmMessage {
  role?: string;
  content?: string;
}

function verifyWebhookSecret(request: Request): boolean {
  const secret =
    process.env.CALL_AI_LLM_WEBHOOK_SECRET?.trim() ??
    process.env.AGORA_LLM_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const header =
    request.headers.get("x-onework-llm-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === secret;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: callId } = await params;
  const call = await getCallSession(callId);
  if (!call || !call.ai_enabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rate = checkSimpleRateLimit(`call-ai-llm:${callId}`, 120, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  const body = (await request.json()) as {
    messages?: LlmMessage[];
    turn_id?: number;
  };

  const participantsRes = await query<{ user_id: string }>(
    `SELECT user_id FROM ${SCHEMA}.call_participants WHERE call_session_id = $1`,
    [callId],
  );
  const participantIds = participantsRes.rows.map((p) => p.user_id);
  const contextText = await getWorkspaceContextText(call, participantIds);

  const conversation = (body.messages ?? [])
    .map((m) => `${m.role ?? "user"}: ${m.content ?? ""}`)
    .join("\n");

  const prompt = [
    contextText,
    "",
    "## Conversation",
    conversation,
    "",
    "Respond helpfully and concisely for voice. If the user agrees on a concrete action item, include a line: ACTION_ITEM: {json with title, description, suggestedPriority}",
  ].join("\n");

  const ai = new GoogleGenAI({ apiKey });

  try {
    const result = await ai.models.generateContent({
      model: getGeminiModelId(),
      contents: prompt,
      config: {
        systemInstruction:
          "You are the OneWork meeting voice assistant. Be brief. Only use workspace context and conversation facts.",
        temperature: 0.2,
        maxOutputTokens: 500,
      },
    });

    let reply = result.text?.trim() ?? "I'm here to help with your meeting.";

    const actionMatch = reply.match(/ACTION_ITEM:\s*(\{[\s\S]*?\})/);
    if (actionMatch) {
      try {
        const action = JSON.parse(actionMatch[1]) as {
          title?: string;
          description?: string;
          suggestedPriority?: string;
        };
        if (action.title) {
          await createDraftMeetingTask(
            call,
            {
              title: action.title,
              description: action.description,
              suggestedPriority: action.suggestedPriority as
                | "urgent"
                | "high"
                | "medium"
                | "low"
                | undefined,
            },
            call.created_by,
          );
          reply = reply.replace(actionMatch[0], "").trim();
          reply += " I've added that to your meeting tasks for review.";
        }
      } catch {
        /* ignore parse errors */
      }
    }

    return NextResponse.json({
      id: `chatcmpl-${callId}-${body.turn_id ?? 0}`,
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: reply },
          finish_reason: "stop",
        },
      ],
    });
  } catch (e: unknown) {
    const { httpStatus, message } = mapGeminiClientError(e);
    return NextResponse.json({ error: message }, { status: httpStatus });
  }
}
