import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { MessageContent } from "./MessageContent";
import { MessageReactions } from "./MessageReactions";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { api } from "@/lib/api";
import { AiMessageTaskButton } from "@/components/ai/AiUi";
import { ChatAttachment } from "./ChatInput";
import { ImageLightbox } from "./ImageLightbox";

function renderReplyPreview(content: string) {
  const trimmed = content.trim();
  const match = trimmed.match(/^([^`]*)```(?:markdown|\w*\n?)([\s\S]*?)```/);
  let text: string;
  let hasCode = false;
  if (match) {
    hasCode = true;
    const prefix = match[1].trim();
    const codeLines = match[2]
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0)
      .slice(0, 2)
      .join(" • ");
    const parts: string[] = [];
    if (prefix) parts.push(prefix.slice(0, 50));
    if (codeLines) parts.push(codeLines.slice(0, 80));
    text = parts.join(" ") || "Code block";
    if (text.length > 100) text = text.slice(0, 100) + "…";
  } else {
    text = trimmed.length > 120 ? trimmed.slice(0, 120) + "…" : trimmed;
  }
  return (
    <span className="text-xs text-text-secondary/80 truncate block group-hover/quote:text-text-secondary transition-colors">
      {hasCode && (
        <span className="material-symbols-outlined text-[10px] mr-0.5 align-middle opacity-60">code</span>
      )}
      {text}
    </span>
  );
}

interface ChatMsg {
  id: string;
  senderId?: string;
  content: string;
  timestamp: string;
  status?: "sending" | "sent" | "failed" | "deleted";
  metadata?: {
    reactions?: Record<string, string[]>;
    attachments?: ChatAttachment[];
  };
  updatedAt?: string;
  deletedAt?: string;
  replyToMessageId?: string;
  replyToContent?: string;
  replyToSenderName?: string;
}

export interface ReplyToPreview {
  id: string;
  senderName: string;
  content: string;
}

interface MessageItemProps {
  msg: ChatMsg;
  isMe: boolean;
  showHeader: boolean;
  isThreadReply?: boolean;
  replyTo?: ReplyToPreview;
  displayName: string;
  displayAvatar: string;
  currentUserId?: string;
  users?: Array<{ id: string; name: string; avatar: string }>;
  threadReplies?: ChatMsg[];
  replyCount?: number;
  lastReplyAt?: string;
  replyUsers?: Array<{ userId: string; avatarUrl?: string; fullName?: string }>;
  alsoSentToChannel?: boolean;
  threadRootMessageId?: string;
  onDelete: (id: string) => void;
  onEdit?: (id: string, content: string) => Promise<void> | void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onReply: () => void;
  onOpenThread?: () => void;
  onScrollToReply?: (id: string) => void;
  replyToMessageId?: string;
  replyToContent?: string;
  replyToSenderName?: string;
  onCreateTask?: () => void;
  createTaskBusy?: boolean;
  compactHoverTime?: boolean;
  readOnly?: boolean;
  onUserClick?: (userId: string) => void;
}

const EMOJI_PICKER_WIDTH = 300;
const EMOJI_PICKER_HEIGHT = 400;
const EMOJI_PICKER_GAP = 8;

function computeEmojiPickerPosition(rect: DOMRect, isMe: boolean) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = isMe ? rect.right - EMOJI_PICKER_WIDTH : rect.left;
  left = Math.max(
    EMOJI_PICKER_GAP,
    Math.min(left, vw - EMOJI_PICKER_WIDTH - EMOJI_PICKER_GAP),
  );

  const spaceAbove = rect.top - EMOJI_PICKER_GAP;
  const spaceBelow = vh - rect.bottom - EMOJI_PICKER_GAP;
  let top =
    spaceAbove >= EMOJI_PICKER_HEIGHT || spaceAbove >= spaceBelow
      ? rect.top - EMOJI_PICKER_HEIGHT - EMOJI_PICKER_GAP
      : rect.bottom + EMOJI_PICKER_GAP;
  top = Math.max(
    EMOJI_PICKER_GAP,
    Math.min(top, vh - EMOJI_PICKER_HEIGHT - EMOJI_PICKER_GAP),
  );

  return { top, left };
}

function formatThreadRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  msg,
  isMe,
  showHeader,
  isThreadReply = false,
  displayName,
  displayAvatar,
  currentUserId,
  users,
  onDelete,
  onEdit,
  onToggleReaction,
  onReply,
  onOpenThread,
  onScrollToReply,
  replyToMessageId,
  replyToContent,
  replyToSenderName,
  replyCount = 0,
  lastReplyAt,
  replyUsers,
  alsoSentToChannel,
  threadRootMessageId,
  onCreateTask,
  createTaskBusy = false,
  readOnly = false,
  onUserClick,
}) => {
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(msg.content);
  const [editWidth, setEditWidth] = useState<number | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; fileName: string } | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const reactionButtonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const emojiPickerPortalRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!showEmojiPicker || !reactionButtonRef.current) {
      setEmojiPickerPos(null);
      return;
    }

    const updatePosition = () => {
      const rect = reactionButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setEmojiPickerPos(computeEmojiPickerPosition(rect, isMe));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showEmojiPicker, isMe]);

  // Auto-grow the edit textarea to fit its content
  useEffect(() => {
    if (!isEditing || !editTextareaRef.current) return;
    const el = editTextareaRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [isEditing, editContent]);

  // Close emoji picker on click outside
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (emojiPickerRef.current?.contains(target)) return;
      if (reactionButtonRef.current?.contains(target)) return;
      if (emojiPickerPortalRef.current?.contains(target)) return;
      setShowEmojiPicker(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  const handleSaveEdit = async () => {
    if (readOnly) return;
    if (editContent.trim() === msg.content || !editContent.trim()) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await onEdit?.(msg.id, editContent);
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to edit message", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (readOnly) return;
    if (!confirm("Are you sure you want to delete this message?")) return;
    if (!currentUserId) return;
    try {
      await api.chat.deleteMessage(msg.id, currentUserId);
      onDelete(msg.id);
    } catch (err) {
      console.error("Failed to delete message", err);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
  };

  const handleReaction = (emojiObj: EmojiClickData) => {
    setShowEmojiPicker(false);
    if (readOnly || !onToggleReaction) return;
    onToggleReaction(msg.id, emojiObj.emoji);
  };

  const toggleExistingReaction = (emoji: string) => {
    if (readOnly || !onToggleReaction) return;
    onToggleReaction(msg.id, emoji);
  };

  const actionBtnPointer = showActions || showEmojiPicker
    ? "pointer-events-auto"
    : "pointer-events-none";

  const handleActionsMouseLeave = (e: React.MouseEvent) => {
    if (showEmojiPicker) return;
    const next = e.relatedTarget as Node | null;
    if (next && bubbleRef.current?.contains(next)) return;
    if (
      next instanceof Element &&
      (next.closest("[data-message-emoji-picker]") ||
        next.closest("[data-message-actions]"))
    ) {
      return;
    }
    setShowActions(false);
  };

  const isDeleted = msg.status === "deleted";

  return (
    <>
    <div
      className={`flex gap-2 sm:gap-3 group ${isMe ? "flex-row-reverse" : ""} ${showHeader ? "mt-4" : "mt-0.5"}`}
    >
      {showHeader ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={displayAvatar}
          className="size-7 sm:size-9 rounded-lg bg-slate-700 object-cover mt-1 shrink-0"
          alt=""
        />
      ) : (
        <div className="w-7 sm:w-9 shrink-0" />
      )}

      <div className={`flex-1 min-w-0 flex flex-col ${isMe ? "items-end" : ""}`}>
        {showHeader && !isMe && (
          <div className="flex items-baseline gap-2 mb-1">
            {msg.senderId && onUserClick ? (
              <button
                type="button"
                onClick={() => onUserClick(msg.senderId!)}
                className="cursor-pointer text-sm font-bold hover:underline text-white"
              >
                {displayName}
              </button>
            ) : (
              <span className="text-sm font-bold text-white">{displayName}</span>
            )}
            <span className="text-[10px] text-text-secondary font-mono">
              {msg.timestamp}
            </span>
          </div>
        )}
        {showHeader && isMe && (
          <div className="flex items-baseline justify-end gap-2 mb-1">
            <span className="text-[10px] text-text-secondary font-mono">
              {msg.timestamp}
            </span>
          </div>
        )}

        <div className={`relative group/msg w-fit max-w-full sm:max-w-[75%] overflow-visible ${isMe ? "self-end" : ""}`}>
          {isDeleted ? (
            <div className="text-sm italic text-text-secondary/50 py-0.5">
              This message was deleted.
            </div>
          ) : (
            <div
              className="relative inline-block max-w-full overflow-visible"
              ref={bubbleRef}
              style={isEditing && editWidth ? { width: editWidth } : undefined}
              onMouseEnter={() => setShowActions(true)}
              onMouseLeave={handleActionsMouseLeave}
            >
            <div
              className={`px-3 py-1.5 rounded-2xl transition-colors ${
                isMe
                  ? "bg-primary/15 border border-primary/25 rounded-tr-sm"
                  : "hover:bg-white/2 rounded-tl-sm"
              } ${
                msg.status === "sending"
                  ? "opacity-50"
                  : msg.status === "failed"
                    ? "text-red-400"
                    : ""
              }`}
            >
              {isEditing ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    ref={editTextareaRef}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={1}
                    className="w-full bg-transparent font-sans text-text-secondary resize-none border-0 outline-none appearance-none p-0 m-0 custom-scrollbar leading-relaxed"
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setEditContent(msg.content);
                      }}
                      className="cursor-pointer px-3 py-1 bg-white/10 text-text-secondary text-xs font-bold rounded hover:bg-white/20 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={isSaving}
                      className="cursor-pointer px-3 py-1 bg-primary text-white text-xs font-bold rounded hover:bg-blue-600 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
              {/* Broadcast-from-thread indicator in channel */}
              {alsoSentToChannel && threadRootMessageId && !isThreadReply && (
                <button
                  type="button"
                  onClick={onOpenThread}
                  className="cursor-pointer mb-1 flex items-center gap-1 text-[10px] text-primary/80 hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[12px]">forum</span>
                  Also sent to thread
                </button>
              )}

              {/* Inline reply quote — legacy only; hidden in thread panel */}
              {!isThreadReply && replyToMessageId && (replyToContent || replyToSenderName) && !replyCount && (
                <button
                  onClick={() => onScrollToReply?.(replyToMessageId)}
                  className="cursor-pointer mb-1.5 flex items-stretch gap-1.5 text-left w-full group/quote"
                >
                  <div className="w-0.5 rounded-full bg-primary/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-bold text-primary block">
                      {replyToSenderName}
                    </span>
                    {replyToContent?.trim() ? (
                      renderReplyPreview(replyToContent)
                    ) : (
                      <span className="text-xs text-text-secondary/60 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">image</span>
                        Photo
                      </span>
                    )}
                  </div>
                </button>
              )}

              {msg.content.trim() && (
                <div className="w-full break-words">
                  <MessageContent content={msg.content} />
                </div>
              )}
              {msg.metadata?.attachments &&
                msg.metadata.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {msg.metadata.attachments.map((att) => {
                      if (att.type === "task") {
                        return (
                          <Link
                            key={att.task_id}
                            href={`/tasks?open=${att.task_id}`}
                            className="flex items-start gap-2 rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-xs hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px] text-primary mt-0.5 shrink-0">task_alt</span>
                            <div className="min-w-0">
                              {att.task_project && (
                                <div className="text-primary/70 text-[10px] mb-0.5 truncate">{att.task_project}</div>
                              )}
                              <div className="text-white font-medium truncate">{att.task_title}</div>
                              <div className="flex items-center gap-1.5 mt-0.5 text-text-secondary">
                                <span className="capitalize">{att.task_status}</span>
                                <span className="opacity-50">·</span>
                                <span className="capitalize">{att.task_priority}</span>
                              </div>
                            </div>
                          </Link>
                        );
                      }
                      if (att.type === "email") {
                        return (
                          <Link
                            key={att.email_id}
                            href={`/email/${att.email_id}`}
                            className="flex items-start gap-2 rounded-lg border border-border-dark bg-surface-dark px-3 py-2 text-xs max-w-[280px] hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px] text-primary mt-0.5 shrink-0">mail</span>
                            <div className="min-w-0">
                              <div className="text-white font-medium truncate">{att.email_subject}</div>
                              {att.email_preview && (
                                <div className="text-text-secondary/70 mt-0.5 line-clamp-2 leading-relaxed">{att.email_preview}</div>
                              )}
                            </div>
                          </Link>
                        );
                      }
                      if (att.type === "commit") {
                        return (
                          <div
                            key={att.commit_id}
                            className="flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1 text-xs text-text-secondary"
                          >
                            <span className="material-symbols-outlined text-[14px] text-primary">
                              commit
                            </span>
                            <span className="font-mono text-primary">
                              {att.commit_sha?.slice(0, 7) ??
                                att.commit_id.slice(0, 7)}
                            </span>
                            <span className="max-w-[140px] truncate">
                              {att.commit_message}
                            </span>
                          </div>
                        );
                      }
                      if (att.file_type?.startsWith("image/")) {
                        const imgUrl = `/api/files/${att.workspace_file_id}/download`;
                        return (
                          <button
                            key={att.workspace_file_id}
                            type="button"
                            onClick={() => setLightboxSrc({ src: imgUrl, fileName: att.file_name })}
                            className="cursor-pointer block focus:outline-none"
                            title="Click to view"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgUrl}
                              alt={att.file_name}
                              className="max-w-[280px] max-h-[200px] rounded-xl object-contain border border-border-dark hover:opacity-85 transition-opacity cursor-zoom-in"
                              loading="lazy"
                            />
                          </button>
                        );
                      }
                      return (
                        <a
                          key={att.workspace_file_id}
                          href={`/api/files/${att.workspace_file_id}/download`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1 text-xs text-text-secondary hover:text-white hover:border-border-dark/60 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            attach_file
                          </span>
                          <span className="max-w-[140px] truncate">
                            {att.file_name}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                )}
              <div className="flex items-center gap-2 mt-0.5">
                {msg.updatedAt && (
                  <span className="text-[10px] text-text-secondary/50 italic">
                    (edited)
                  </span>
                )}
                {msg.status === "sending" && (
                  <span className="text-[10px] text-text-secondary">
                    sending...
                  </span>
                )}
                {msg.status === "failed" && (
                  <span className="text-[10px] text-red-400 font-bold">
                    ✗ failed
                  </span>
                )}
              </div>
                </>
              )}
            </div>

          {/* Message Actions (Hover) — flush above bubble; container ignores clicks, buttons only */}
          {!isDeleted && !isEditing && (
            <div
              className={`absolute bottom-full z-20 pointer-events-none ${
                isMe ? "right-0" : "left-0"
              }`}
            >
              <div
                data-message-actions
                onMouseEnter={() => setShowActions(true)}
                className={`flex gap-1 bg-surface-dark border border-border-dark rounded-md shadow-lg p-1 transition-opacity whitespace-nowrap ${
                  showActions || showEmojiPicker ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                }`}
              >
                <button
                  disabled={readOnly}
                  onClick={() => { if (!readOnly) onReply(); }}
                  className={`cursor-pointer p-1 hover:bg-white/10 rounded text-text-secondary hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary ${actionBtnPointer}`}
                  title="Reply"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    reply
                  </span>
                </button>
                <div className="relative" ref={emojiPickerRef}>
                  <button
                    ref={reactionButtonRef}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setShowEmojiPicker((open) => !open)}
                    disabled={readOnly}
                    className={`cursor-pointer p-1 hover:bg-white/10 rounded text-text-secondary hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary ${actionBtnPointer}`}
                    title="Add reaction"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      add_reaction
                    </span>
                  </button>
                </div>
                <button
                  onClick={handleCopy}
                  className={`cursor-pointer p-1 hover:bg-white/10 rounded text-text-secondary hover:text-white ${actionBtnPointer}`}
                  title="Copy text"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    content_copy
                  </span>
                </button>
                {onCreateTask && (
                  <AiMessageTaskButton
                    onClick={onCreateTask}
                    disabled={readOnly || createTaskBusy}
                    busy={createTaskBusy}
                    className={actionBtnPointer}
                  />
                )}
                {isMe && (
                  <>
                    <button
                      disabled={readOnly}
                      onClick={() => {
                        if (readOnly) return;
                        setEditWidth(bubbleRef.current?.getBoundingClientRect().width ?? null);
                        setIsEditing(true);
                      }}
                      className={`cursor-pointer p-1 hover:bg-white/10 rounded text-text-secondary hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary ${actionBtnPointer}`}
                      title="Edit message"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        edit
                      </span>
                    </button>
                    <button
                      disabled={readOnly}
                      onClick={handleDelete}
                      className={`cursor-pointer p-1 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-red-400 ${actionBtnPointer}`}
                      title="Delete message"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        delete
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
            </div>
          )}

          {!isDeleted && msg.metadata?.reactions && (
            <MessageReactions
              reactions={msg.metadata.reactions}
              currentUserId={currentUserId}
              users={users}
              onToggleReaction={toggleExistingReaction}
              readOnly={readOnly}
            />
          )}

          {!isDeleted && !isThreadReply && replyCount > 0 && onOpenThread && (
            <button
              type="button"
              onClick={onOpenThread}
              className={`mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 ${isMe ? "flex-row-reverse" : ""} cursor-pointer`}
            >
              <div className={`flex items-center ${isMe ? "-space-x-2 flex-row-reverse" : "-space-x-2"}`}>
                {(replyUsers ?? []).slice(0, 3).map((u) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={u.userId}
                    src={
                      u.avatarUrl ||
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(u.fullName || "?")}&background=1e293b&color=e2e8f0`
                    }
                    alt=""
                    className="size-5 rounded-full border-2 border-background-dark bg-slate-700 object-cover"
                  />
                ))}
              </div>
              <span className="text-xs font-semibold text-primary hover:underline">
                {replyCount} {replyCount === 1 ? "reply" : "replies"}
                {lastReplyAt ? ` · Last reply ${formatThreadRelativeTime(lastReplyAt)}` : ""}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>

    {lightboxSrc && (
      <ImageLightbox
        src={lightboxSrc.src}
        alt={lightboxSrc.fileName}
        fileName={lightboxSrc.fileName}
        downloadUrl={lightboxSrc.src}
        onClose={() => setLightboxSrc(null)}
      />
    )}

    {typeof document !== "undefined" &&
      showEmojiPicker &&
      emojiPickerPos &&
      createPortal(
        <div
          ref={emojiPickerPortalRef}
          data-message-emoji-picker
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: emojiPickerPos.top,
            left: emojiPickerPos.left,
            zIndex: 9999,
          }}
        >
          <EmojiPicker
            onEmojiClick={handleReaction}
            theme={Theme.DARK}
            width={EMOJI_PICKER_WIDTH}
            height={EMOJI_PICKER_HEIGHT}
          />
        </div>,
        document.body,
      )}
    </>
  );
};
