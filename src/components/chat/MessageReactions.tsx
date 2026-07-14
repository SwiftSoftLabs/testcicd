import React from "react";

interface MessageReactionsProps {
  reactions: Record<string, string[]>;
  currentUserId?: string;
  users?: Array<{ id: string; name: string }>;
  onToggleReaction: (emoji: string) => void;
  readOnly?: boolean;
}

function resolveUserName(
  userId: string,
  users: Array<{ id: string; name: string }> | undefined,
  currentUserId?: string,
): string {
  if (currentUserId && userId === currentUserId) return "You";
  return users?.find((u) => u.id === userId)?.name ?? `${userId.slice(0, 8)}…`;
}

function formatReactionTooltip(
  userIds: string[],
  users: Array<{ id: string; name: string }> | undefined,
  currentUserId?: string,
): string {
  const names = userIds.map((id) => resolveUserName(id, users, currentUserId));
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export const MessageReactions: React.FC<MessageReactionsProps> = ({
  reactions,
  currentUserId,
  users,
  onToggleReaction,
  readOnly = false,
}) => {
  const emojis = Object.keys(reactions).filter((e) => reactions[e].length > 0);
  if (emojis.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {emojis.map((emoji) => {
        const userIds = reactions[emoji];
        const count = userIds.length;
        const hasReacted = currentUserId ? userIds.includes(currentUserId) : false;
        const tooltip = formatReactionTooltip(userIds, users, currentUserId);

        return (
          <div key={emoji} className="relative group/reaction">
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                if (!readOnly) onToggleReaction(emoji);
              }}
              aria-label={`${emoji} ${count} reaction${count > 1 ? "s" : ""}: ${tooltip}`}
              className={`cursor-pointer flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${hasReacted
                  ? "border-primary/50 bg-primary/15 text-white"
                  : `border-border-dark bg-surface-dark text-text-secondary ${readOnly ? "opacity-70" : "hover:border-border-dark/80 hover:bg-white/5 hover:text-white"}`
                }`}
            >
              <span className="text-sm leading-none">{emoji}</span>
              <span className="font-semibold tabular-nums text-[10px]">{count}</span>
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute left-1/2 bottom-full z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border-dark bg-surface-dark px-2 py-1 text-[11px] text-white opacity-0 shadow-lg transition-opacity group-hover/reaction:opacity-100"
            >
              {tooltip}
            </div>
          </div>
        );
      })}
    </div>
  );
};
