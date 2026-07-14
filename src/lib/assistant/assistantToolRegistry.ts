import { ASSISTANT_TOOL_NAMES, type AssistantToolName } from "@/types/assistant";

export { ASSISTANT_TOOL_NAMES };

export function isAssistantToolName(name: string): name is AssistantToolName {
  return (ASSISTANT_TOOL_NAMES as readonly string[]).includes(name);
}

/** Tool names listed in orchestrator system prompt. */
export function formatToolCatalogForPrompt(): string {
  return ASSISTANT_TOOL_NAMES.join(", ");
}
