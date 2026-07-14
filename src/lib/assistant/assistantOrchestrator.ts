import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { mapGeminiClientError } from "@/lib/ai/geminiErrors";
import { getGeminiModelId } from "@/lib/ai/geminiModel";
import type {
  AssistantCommandResponse,
  AssistantCommandSource,
  AssistantPageContext,
} from "@/types/assistant";
import {
  formatContextForPrompt,
  resolveAssistantContext,
} from "./assistantContext";
import {
  getExplicitToolAllowlist,
  looksLikeNavigationCommand,
  tryResolveNavigation,
} from "./assistantNavigation";
import {
  ONEWORK_UNSUPPORTED_REPLY,
  ORCHESTRATOR_SYSTEM_INSTRUCTION,
} from "./assistantPrompts";
import { looksLikeHallucinatedSummary } from "./transcribeVoiceClip";
import {
  ALL_ASSISTANT_FUNCTION_DECLARATIONS,
  executeAssistantTool,
  inferToolFromTranscript,
} from "./assistantTools";

function unsupportedResponse(
  spokenReply: string = ONEWORK_UNSUPPORTED_REPLY,
): AssistantCommandResponse {
  return {
    spokenReply,
    clientActions: [],
    unsupported: true,
  };
}

function isUnsupportedTool(toolName: string, transcript: string): boolean {
  const allowed = getExplicitToolAllowlist(transcript);
  return !allowed.includes(toolName);
}

export async function runAssistantCommand(opts: {
  apiKey: string;
  userId: string;
  transcript: string;
  pageContext: AssistantPageContext;
  source?: AssistantCommandSource;
}): Promise<AssistantCommandResponse> {
  const transcript = opts.transcript.trim().slice(0, 1200);
  if (!transcript) {
    return {
      spokenReply: "I did not catch that. Hold the mic and try again.",
      clientActions: [],
    };
  }

  if (looksLikeHallucinatedSummary(transcript)) {
    return {
      spokenReply:
        "That did not sound like a voice command. Hold the mic and say something like “go to settings”.",
      clientActions: [],
    };
  }

  const ctx = await resolveAssistantContext(opts.userId, opts.pageContext);
  const contextText = formatContextForPrompt(ctx);
  const voiceCommand = opts.source === "voice";
  const allowedTools = getExplicitToolAllowlist(transcript);

  if (allowedTools.length === 0) {
    return unsupportedResponse();
  }

  const navPath = tryResolveNavigation(transcript, ctx);
  if (navPath) {
    const executed = await executeAssistantTool({
      apiKey: opts.apiKey,
      userId: opts.userId,
      toolName: "navigate",
      args: { path: navPath },
      ctx,
    });
    return {
      spokenReply: executed.spokenReply,
      clientActions: executed.clientActions,
      data: executed.data,
      toolName: "navigate",
    };
  }

  if (
    allowedTools.includes("navigate") &&
    looksLikeNavigationCommand(transcript) &&
    !navPath
  ) {
    return unsupportedResponse(
      "I couldn't find that page in OneWork. You'll stay on this page.",
    );
  }

  if (allowedTools.length === 1 && allowedTools[0] === "navigate") {
    return unsupportedResponse();
  }

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  // Gemini requires FunctionCallingConfigMode.ANY when passing allowedFunctionNames.
  const declarations = ALL_ASSISTANT_FUNCTION_DECLARATIONS;

  const userTurn = [
    contextText,
    "",
    `User command${voiceCommand ? " (voice)" : ""}:`,
    transcript,
  ].join("\n");

  try {
    const result = await ai.models.generateContent({
      model: getGeminiModelId(),
      contents: userTurn,
      config: {
        systemInstruction: ORCHESTRATOR_SYSTEM_INSTRUCTION,
        temperature: 0.15,
        maxOutputTokens: 500,
        tools: [{ functionDeclarations: declarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: allowedTools,
          },
        },
      },
    });

    const functionCalls = result.functionCalls;
    if (functionCalls?.length) {
      const call = functionCalls[0];
      const toolName = call.name ?? "";
      if (isUnsupportedTool(toolName, transcript)) {
        return unsupportedResponse();
      }
      const args =
        call.args && typeof call.args === "object"
          ? (call.args as Record<string, unknown>)
          : {};
      const executed = await executeAssistantTool({
        apiKey: opts.apiKey,
        userId: opts.userId,
        toolName,
        args,
        ctx,
      });
      return {
        spokenReply: executed.spokenReply,
        clientActions: executed.clientActions,
        data: executed.data,
        toolName,
      };
    }

    const plain = result.text?.trim();
    if (plain) {
      return { spokenReply: plain.slice(0, 900), clientActions: [] };
    }

    const inferred = await inferToolFromTranscript(
      opts.apiKey,
      transcript,
      contextText,
    );
    const inferredAllowed =
      inferred &&
      !isUnsupportedTool(inferred.toolName, transcript);

    if (inferred && inferredAllowed) {
      const executed = await executeAssistantTool({
        apiKey: opts.apiKey,
        userId: opts.userId,
        toolName: inferred.toolName,
        args: inferred.args,
        ctx,
      });
      return {
        spokenReply: executed.spokenReply,
        clientActions: executed.clientActions,
        data: executed.data,
        toolName: inferred.toolName,
      };
    }

    return unsupportedResponse();
  } catch (e: unknown) {
    const mapped = mapGeminiClientError(e);
    throw Object.assign(new Error(mapped.message), { httpStatus: mapped.httpStatus });
  }
}
