"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { User } from "@/types";
import { ChatInput, ChatAttachment } from "./ChatInput";
import { MessageItem } from "./MessageItem";
import { api } from "@/lib/api";
import type { ChatMessage } from "./chat-types";
import { mapApiMessage, resolveDisplayAvatar, resolveDisplayName } from "./chat-types";

interface Channel {
  id: string;
  name: string;
  type: "channel" | "dm";
}

interface ThreadPanelProps {
  conversationId: string;
  threadRootId: string;
  users: User[];
  channels: Channel[];
  currentUserId?: string;
  workspaceId?: string;
  projectId?: string;
  threadReplies: ChatMessage[];
  parentMessage?: ChatMessage | null;
  onClose: () => void;
  onDeleteMessage: (id: string) => void;
  onEditMessage: (id: string, content: string) => Promise<void> | void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onSendThreadReply: (
    text: string,
    attachments: ChatAttachment[] | undefined,
    alsoSendToChannel: boolean,
  ) => void;
  onThreadRepliesLoaded: (
    rootId: string,
    parent: ChatMessage | null,
    replies: ChatMessage[],
    hasMore: boolean,
    nextCursor: string | null,
    append?: boolean,
  ) => void;
  onCreateTaskFromMessage?: (content: string, senderName: string) => void;
  createTaskBusy?: boolean;
  onUserClick?: (userId: string, fallback?: { name?: string; avatar?: string }) => void;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const ThreadPanel: React.FC<ThreadPanelProps> = ({
  conversationId,
  threadRootId,
  users,
  channels,
  currentUserId,
  workspaceId,
  projectId,
  threadReplies,
  parentMessage,
  onClose,
  onDeleteMessage,
  onEditMessage,
  onToggleReaction,
  onSendThreadReply,
  onThreadRepliesLoaded,
  onCreateTaskFromMessage,
  createTaskBusy = false,
  onUserClick,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [alsoSendToChannel, setAlsoSendToChannel] = useState(false);

  const loadReplies = useCallback(
    async (cursor?: string) => {
      if (cursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const result = (await api.chat.getThreadReplies(threadRootId, cursor, 50)) as {
          data?: {
            parent: Record<string, unknown> | null;
            replies: Record<string, unknown>[];
            hasMore: boolean;
            nextCursor: string | null;
          };
        };
        const data = result?.data;
        if (!data) return;
        const parent = data.parent ? mapApiMessage(data.parent) : null;
        const replies = (data.replies ?? []).map(mapApiMessage);
        setHasMore(Boolean(data.hasMore));
        setNextCursor(data.nextCursor ?? null);
        onThreadRepliesLoaded(threadRootId, parent, replies, Boolean(data.hasMore), data.nextCursor, Boolean(cursor));
      } catch (err) {
        console.error("Failed to load thread replies", err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [threadRootId, onThreadRepliesLoaded],
  );

  useEffect(() => {
    void loadReplies();
  }, [loadReplies]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadReplies.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const renderMessage = (msg: ChatMessage, opts: { showHeader: boolean; isThreadReply?: boolean }) => {
    const displayName = resolveDisplayName(msg, users);
    const displayAvatar = resolveDisplayAvatar(msg, users, displayName);
    const isMe = msg.senderId === currentUserId;
    return (
      <MessageItem
        key={msg.id}
        msg={msg}
        isMe={isMe}
        showHeader={opts.showHeader}
        isThreadReply={opts.isThreadReply}
        displayName={displayName}
        displayAvatar={displayAvatar}
        currentUserId={currentUserId}
        users={users}
        onDelete={onDeleteMessage}
        onEdit={onEditMessage}
        onToggleReaction={onToggleReaction}
        onReply={() => {}}
        onCreateTask={
          onCreateTaskFromMessage
            ? () => onCreateTaskFromMessage(msg.content, displayName)
            : undefined
        }
        createTaskBusy={createTaskBusy}
        onUserClick={
          onUserClick
            ? (userId) => onUserClick(userId, { name: displayName, avatar: displayAvatar })
            : undefined
        }
      />
    );
  };

  const replyCount = parentMessage?.replyCount ?? threadReplies.length;

  return (
    <div className="flex h-full w-full md:w-[380px] shrink-0 flex-col border-l border-border-dark bg-background-dark">
      <header className="flex items-center justify-between shrink-0 border-b border-border-dark px-4 py-3 bg-surface-dark/50">
        <div>
          <h3 className="text-sm font-bold text-white">Thread</h3>
          {replyCount > 0 && parentMessage?.lastReplyAt && (
            <p className="text-[10px] text-text-secondary mt-0.5">
              {replyCount} {replyCount === 1 ? "reply" : "replies"} · Last reply{" "}
              {formatRelativeTime(parentMessage.lastReplyAt)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
          title="Close thread"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-1 custom-scrollbar">
        {loading && !parentMessage ? (
          <div className="flex items-center justify-center py-8">
            <div className="size-6 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          </div>
        ) : (
          <>
            {parentMessage && renderMessage(parentMessage, { showHeader: true })}
            <div className="my-2 border-t border-border-dark/60" />
            {threadReplies.length === 0 && !loading ? (
              <p className="py-4 text-center text-xs text-text-secondary">
                Be the first to reply in this thread.
              </p>
            ) : (
              threadReplies.map((msg, i) => {
                const prev = threadReplies[i - 1];
                const showHeader = !prev || prev.senderId !== msg.senderId;
                return renderMessage(msg, { showHeader, isThreadReply: true });
              })
            )}
            {hasMore && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => nextCursor && void loadReplies(nextCursor)}
                  className="cursor-pointer rounded-full border border-border-dark bg-surface-dark px-3 py-1 text-xs font-semibold text-primary hover:bg-white/5 disabled:opacity-50"
                >
                  {loadingMore ? "Loading..." : "Load more replies"}
                </button>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border-dark px-4 pt-2 pb-1">
        <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={alsoSendToChannel}
            onChange={(e) => setAlsoSendToChannel(e.target.checked)}
            className="rounded border-border-dark bg-background-dark text-primary focus:ring-primary/50"
          />
          <span className="text-xs text-text-secondary">Also send to channel</span>
        </label>
        <ChatInput
          conversationId={`${conversationId}_thread_${threadRootId}`}
          variant="thread"
          users={users}
          channels={channels}
          workspaceId={workspaceId}
          projectId={projectId}
          placeholder="Reply in thread..."
          onSendMessage={(text, attachments) =>
            onSendThreadReply(text, attachments, alsoSendToChannel)
          }
        />
      </div>
    </div>
  );
};
