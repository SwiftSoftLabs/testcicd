"use client";

import React, { useState } from "react";
import { api } from "@/lib/api";
import { useUIContext } from "@/context/UIContext";
import {
  AiBorderCard,
  AiChip,
  AiSparkle,
  AiToggle,
  aiGradientTextClass,
} from "@/components/ai/AiUi";

type ChatAiKind = "proofread" | "improve" | "suggest_reply";

interface ChatComposeAssistantProps {
  conversationId: string;
  draft: string;
  onApplyText: (text: string) => void;
}

export const ChatComposeAssistant: React.FC<ChatComposeAssistantProps> = ({
  conversationId,
  draft,
  onApplyText,
}) => {
  const { addToast } = useUIContext();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ChatAiKind | null>(null);
  const [replies, setReplies] = useState<string[]>([]);

  const run = async (kind: ChatAiKind) => {
    if (!conversationId) return;
    if ((kind === "improve" || kind === "proofread") && !draft.trim()) {
      addToast("Type a message first.", "warning");
      return;
    }
    setBusy(kind);
    if (kind === "suggest_reply") setReplies([]);
    try {
      const data = await api.chat.runAi({
        kind,
        conversationId,
        draft: draft.trim() || undefined,
      });
      if (
        (kind === "improve" || kind === "proofread") &&
        typeof data.text === "string"
      ) {
        onApplyText(data.text);
        addToast(
          kind === "proofread" ? "Proofread applied" : "Message updated",
          "success",
        );
      }
      if (kind === "suggest_reply" && Array.isArray(data.replies)) {
        const list = data.replies.filter(
          (r): r is string => typeof r === "string" && r.trim().length > 0,
        );
        if (!list.length) {
          addToast("No reply suggestions returned.", "error");
          return;
        }
        setReplies(list);
        setOpen(true);
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : "AI request failed", "error");
    } finally {
      setBusy(null);
    }
  };

  if (!conversationId) return null;

  return (
    <div className="mb-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <AiToggle
          open={open}
          onClick={() => setOpen((o) => !o)}
          label="AI Assistant"
            />
        {open && (
          <>
            <AiChip
              busy={busy === "proofread"}
              disabled={!!busy}
              icon="spellcheck"
              onClick={() => void run("proofread")}
            >
              Proofread
            </AiChip>
            <AiChip
              busy={busy === "improve"}
              disabled={!!busy}
              icon="edit_note"
              onClick={() => void run("improve")}
            >
              Improve
            </AiChip>
            <AiChip
              busy={busy === "suggest_reply"}
              disabled={!!busy}
              icon="reply"
              onClick={() => void run("suggest_reply")}
            >
              Suggest reply
            </AiChip>
          </>
        )}
      </div>
      {replies.length > 0 && (
        <AiBorderCard innerClassName="p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <AiSparkle size="xs" />
            <p
              className={`text-[10px] font-bold uppercase tracking-wide ${aiGradientTextClass()}`}
            >
              Suggested replies
            </p>
          </div>
          {replies.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onApplyText(r);
                setReplies([]);
                addToast("Reply inserted", "success");
              }}
              className="cursor-pointer w-full text-left text-xs text-main rounded-lg px-2 py-2 hover:bg-white/5 border border-transparent hover:border-violet-500/20 transition-colors"
            >
              {r}
            </button>
          ))}
        </AiBorderCard>
      )}
    </div>
  );
};
