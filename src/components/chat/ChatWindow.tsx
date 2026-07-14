"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { User } from "@/types";
import { ChatInput, ChatAttachment } from "./ChatInput";
import { MessageItem } from "./MessageItem";
import { ThreadPanel } from "./ThreadPanel";
import { ChatUserPanel } from "./ChatUserPanel";
import PresenceDot from "@/components/PresenceDot";
import { presenceFromMemberStatus, PRESENCE_DND_LABEL } from "@/lib/presence";
import { ChatCatchUpPanel } from "./ChatCatchUpPanel";
import { ChannelMembersModal } from "./ChannelMembersModal";
import type { ChatMessage } from "./chat-types";
import { resolveDisplayAvatar, resolveDisplayName } from "./chat-types";

interface Channel {
  id: string;
  name: string;
  type: "channel" | "dm";
  unreadCount?: number;
  quota_locked?: boolean;
}

interface ChatWindowProps {
  conversationId: string;
  channelName: string;
  channelType?: "channel" | "dm";
  dmPartnerId?: string;
  liveCallId?: string | null;
  messages: ChatMessage[];
  users: User[];
  channels: Channel[];
  onSendMessage: (text: string, attachments?: ChatAttachment[]) => void;
  onSendThreadReply: (
    threadRootId: string,
    text: string,
    attachments: ChatAttachment[] | undefined,
    alsoSendToChannel: boolean,
  ) => void;
  onDeleteMessage: (id: string) => void;
  onEditMessage: (id: string, content: string) => Promise<void> | void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onStartCall?: () => void | Promise<void>;
  onCreateTaskFromMessage?: (content: string, senderName: string) => void;
  createTaskBusy?: boolean;
  isLoading?: boolean;
  loadingOlder?: boolean;
  hasOlderMessages?: boolean;
  onLoadOlder?: () => void;
  currentUserId?: string;
  workspaceId?: string;
  projectId?: string;
  canManageMembers?: boolean;
  activeThreadRootId?: string | null;
  onOpenThread?: (rootId: string) => void;
  onCloseThread?: () => void;
  threadReplies?: ChatMessage[];
  threadParentMessage?: ChatMessage | null;
  onThreadRepliesLoaded?: (
    rootId: string,
    parent: ChatMessage | null,
    replies: ChatMessage[],
    hasMore: boolean,
    nextCursor: string | null,
    append?: boolean,
  ) => void;
  onBackToList?: () => void;
  onSelectUser?: (userId: string) => void;
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  conversationId,
  channelName,
  channelType = "channel",
  dmPartnerId,
  liveCallId,
  messages,
  users,
  channels,
  onSendMessage,
  onSendThreadReply,
  onDeleteMessage,
  onEditMessage,
  onToggleReaction,
  onStartCall,
  onCreateTaskFromMessage,
  createTaskBusy = false,
  isLoading = false,
  loadingOlder = false,
  hasOlderMessages = false,
  onLoadOlder,
  currentUserId,
  workspaceId,
  projectId,
  canManageMembers = false,
  activeThreadRootId = null,
  onOpenThread,
  onCloseThread,
  threadReplies = [],
  threadParentMessage = null,
  onThreadRepliesLoaded,
  onBackToList,
  onSelectUser,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const stickToBottomRef = useRef(true);
  const pendingInitialScrollRef = useRef(false);

  const [showMembersModal, setShowMembersModal] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileFallback, setProfileFallback] = useState<{
    name?: string;
    avatar?: string;
  }>({});

  const activeChannel = channels.find((channel) => channel.id === conversationId) ?? null;
  const isLockedChannel = channelType === "channel" && !!activeChannel?.quota_locked;
  const dmPartner =
    channelType === "dm" ? users.find((user) => user.id === dmPartnerId) : null;
  const dmPartnerPresence = dmPartner
    ? presenceFromMemberStatus(dmPartner.status)
    : null;
  const dmPartnerLabel =
    dmPartner?.status === PRESENCE_DND_LABEL
      ? PRESENCE_DND_LABEL
      : dmPartnerPresence === "online"
        ? "Active now"
        : dmPartnerPresence === "away"
          ? "Away"
          : "Offline";

  useEffect(() => {
    onCloseThread?.();
    setProfileUserId(null);
    setProfileFallback({});
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    pendingInitialScrollRef.current = true;
    stickToBottomRef.current = true;
  }, [conversationId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "instant") => {
    if (behavior === "instant") {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  const onMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    if (isLoading || loadingOlder || messages.length === 0) return;

    const isInitial = pendingInitialScrollRef.current;
    pendingInitialScrollRef.current = false;

    if (isInitial) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToBottom("instant"));
      });
      return;
    }

    if (stickToBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom("smooth"));
    }
  }, [conversationId, isLoading, loadingOlder, messages.length, scrollToBottom]);

  const openUserProfile = useCallback(
    (userId: string, fallback?: { name?: string; avatar?: string }) => {
      onCloseThread?.();
      setProfileUserId(userId);
      setProfileFallback(fallback ?? {});
    },
    [onCloseThread],
  );

  const closeUserProfile = useCallback(() => {
    setProfileUserId(null);
    setProfileFallback({});
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageElRefs.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-primary/10");
      setTimeout(() => el.classList.remove("bg-primary/10"), 1500);
    }
  }, []);

  const openThread = useCallback(
    (rootId: string) => {
      closeUserProfile();
      onOpenThread?.(rootId);
    },
    [closeUserProfile, onOpenThread],
  );

  if (!channelName) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background-dark">
        <div className="flex size-20 items-center justify-center rounded-2xl border border-border-dark bg-surface-dark shadow-inner">
          <span className="material-symbols-outlined text-4xl text-text-secondary">forum</span>
        </div>
        <h3 className="mt-4 text-lg font-bold text-white">Pick a conversation</h3>
        <p className="mt-1 max-w-xs text-center text-sm text-text-secondary">
          Choose a channel or direct message from the sidebar to start chatting.
        </p>
      </div>
    );
  }

  const channelDisplayTitle =
    channelType === "channel" ? `#${channelName}` : channelName;

  const channelPane = (
    <div className="flex min-w-0 flex-1 flex-col h-full bg-background-dark overflow-hidden">
      <header className="px-3 sm:px-6 py-3 border-b border-border-dark flex items-center justify-between shrink-0 bg-surface-dark/50 backdrop-blur-sm gap-2">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          {onBackToList && (
            <button
              type="button"
              onClick={onBackToList}
              className="cursor-pointer shrink-0 p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors md:hidden"
              aria-label="Back to conversations"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </button>
          )}
          {channelType === "dm" && dmPartner ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={dmPartner.avatar}
                className="size-8 rounded-full border border-border-dark bg-slate-700 object-cover shrink-0"
                alt={dmPartner.name}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <h3 className="font-bold text-white truncate">{channelName}</h3>
                <div className="flex items-center gap-2">
                  <PresenceDot
                    status={dmPartnerPresence ?? "offline"}
                    title={`${dmPartnerLabel} in direct messages`}
                  />
                  <span className="text-xs text-text-secondary font-medium truncate">{dmPartnerLabel}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="material-symbols-outlined text-text-secondary shrink-0 hidden sm:block">
                {channelType === "dm" ? "person" : "tag"}
              </span>
              <h3 className="font-bold text-white truncate min-w-0">{channelDisplayTitle}</h3>
              {isLockedChannel && (
                <span className="hidden sm:inline rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-300 shrink-0">
                  Read-only
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-3 shrink-0">
          {workspaceId && onStartCall && (
            <button
              type="button"
              onClick={() => {
                if (!isLockedChannel) void onStartCall();
              }}
              disabled={isLockedChannel}
              aria-label={liveCallId ? "Join call" : "Start call"}
              className="size-8 sm:h-auto sm:w-auto sm:px-3 sm:py-1.5 text-xs font-bold bg-primary text-white rounded-lg flex items-center justify-center gap-1 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">videocam</span>
              <span className="hidden sm:inline">{liveCallId ? "Join call" : "Start call"}</span>
            </button>
          )}
          <ChatCatchUpPanel
            conversationId={conversationId}
            messageCount={messages.length}
            compact={!!onBackToList}
            disabled={isLockedChannel}
          />
          <div className="hidden sm:flex items-center gap-2">
            <div className="flex items-center -space-x-2">
              {users.slice(0, 3).map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={u.id}
                  src={u.avatar}
                  className="size-6 rounded-full border-2 border-background-dark bg-slate-700"
                  alt={u.name}
                />
              ))}
            </div>
            {channelType === "channel" && (
              <button
                type="button"
                onClick={() => {
                  if (!isLockedChannel) setShowMembersModal(true);
                }}
                disabled={isLockedChannel}
                title="Manage members"
                className="p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              >
                <span className="material-symbols-outlined text-[18px]">manage_accounts</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        data-chat-scroll
        onScroll={onMessagesScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 space-y-1 custom-scrollbar"
      >
        {loadingOlder && (
          <div className="flex justify-center pb-4">
            <div className="size-6 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          </div>
        )}
        {hasOlderMessages && !loadingOlder && !isLoading && (
          <div className="flex justify-center pb-4">
            <button
              type="button"
              onClick={onLoadOlder}
              className="cursor-pointer rounded-full border border-border-dark bg-surface-dark px-3 py-1 text-xs font-semibold text-primary hover:bg-white/5"
            >
              Load older messages
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
              <div className="size-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
              <p className="text-text-secondary text-xs">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="material-symbols-outlined text-text-secondary text-5xl">chat</span>
            <p className="text-text-secondary text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const displayName = resolveDisplayName(msg, users);
            const displayAvatar = resolveDisplayAvatar(msg, users, displayName);
            const isMe = msg.senderId === currentUserId;
            const prevMsg = messages[i - 1];
            const msgDate = msg.createdAt ? new Date(msg.createdAt) : null;
            const prevDate = prevMsg?.createdAt ? new Date(prevMsg.createdAt) : null;
            const isDifferentDay =
              !prevDate ||
              !msgDate ||
              msgDate.toDateString() !== prevDate.toDateString();
            const showHeader =
              isDifferentDay ||
              !prevMsg ||
              prevMsg.senderId !== msg.senderId;
            const threadRootId = msg.threadRootMessageId || msg.id;

            const dayLabel = msgDate
              ? (() => {
                  const today = new Date();
                  const yesterday = new Date();
                  yesterday.setDate(today.getDate() - 1);
                  if (msgDate.toDateString() === today.toDateString()) return "Today";
                  if (msgDate.toDateString() === yesterday.toDateString()) return "Yesterday";
                  return msgDate.toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: msgDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
                  });
                })()
              : null;

            return (
              <div
                key={msg.id}
                ref={(el) => {
                  if (el) messageElRefs.current.set(msg.id, el);
                  else messageElRefs.current.delete(msg.id);
                }}
              >
                {isDifferentDay && dayLabel && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 h-px bg-border-dark" />
                    <span className="text-[11px] font-semibold text-text-secondary shrink-0 px-1">
                      {dayLabel}
                    </span>
                    <div className="flex-1 h-px bg-border-dark" />
                  </div>
                )}
                <MessageItem
                  msg={msg}
                  isMe={isMe}
                  showHeader={showHeader}
                  displayName={displayName}
                  displayAvatar={displayAvatar}
                  currentUserId={currentUserId}
                  users={users}
                  replyCount={msg.replyCount}
                  lastReplyAt={msg.lastReplyAt}
                  replyUsers={msg.replyUsers}
                  alsoSentToChannel={msg.alsoSentToChannel}
                  threadRootMessageId={msg.threadRootMessageId}
                  onDelete={onDeleteMessage}
                  onEdit={onEditMessage}
                  onToggleReaction={onToggleReaction}
                  onReply={() => openThread(msg.alsoSentToChannel ? threadRootId : msg.id)}
                  onOpenThread={() => openThread(msg.id)}
                  onScrollToReply={scrollToMessage}
                  replyToMessageId={msg.replyToMessageId}
                  replyToContent={msg.replyToContent}
                  replyToSenderName={msg.replyToSenderName}
                  onCreateTask={
                    onCreateTaskFromMessage
                      ? () => onCreateTaskFromMessage(msg.content, displayName)
                      : undefined
                  }
                  createTaskBusy={createTaskBusy}
                  readOnly={isLockedChannel}
                  onUserClick={(userId) =>
                    openUserProfile(userId, { name: displayName, avatar: displayAvatar })
                  }
                />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <ChatInput
        conversationId={conversationId}
        onSendMessage={onSendMessage}
        users={users}
        channels={channels}
        workspaceId={workspaceId}
        projectId={projectId}
        disabled={isLockedChannel}
        disabledReason="Locked by plan limits. Upgrade to post in this channel again."
      />

      {isLockedChannel && (
        <div className="shrink-0 border-t border-amber-500/20 bg-amber-500/10 px-6 py-2 text-xs text-amber-300">
          Locked by plan limits. Upgrade to post in this channel again.
        </div>
      )}

      {showMembersModal && conversationId && currentUserId && (
        <ChannelMembersModal
          conversationId={conversationId}
          channelName={channelName}
          workspaceUsers={users}
          currentUserId={currentUserId}
          canManage={canManageMembers}
          readOnly={isLockedChannel}
          onClose={() => setShowMembersModal(false)}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-1 min-w-0 h-full overflow-hidden">
      {channelPane}
      {profileUserId && (
        <div className="fixed inset-0 z-40 md:static md:z-auto md:flex md:shrink-0">
          <button
            type="button"
            className="cursor-pointer absolute inset-0 bg-black/50 md:hidden"
            aria-label="Close profile"
            onClick={closeUserProfile}
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-md md:static md:max-w-none md:w-[380px]">
            <ChatUserPanel
              userId={profileUserId}
              users={users}
              fallbackName={profileFallback.name}
              fallbackAvatar={profileFallback.avatar}
              currentUserId={currentUserId}
              onClose={closeUserProfile}
              onMessageUser={onSelectUser}
            />
          </div>
        </div>
      )}
      {activeThreadRootId && onCloseThread && onThreadRepliesLoaded && (
        <div className="fixed inset-0 z-40 md:static md:z-auto md:flex md:shrink-0">
          <button
            type="button"
            className="cursor-pointer absolute inset-0 bg-black/50 md:hidden"
            aria-label="Close thread"
            onClick={onCloseThread}
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-md md:static md:max-w-none md:w-[380px]">
            <ThreadPanel
              conversationId={conversationId}
              threadRootId={activeThreadRootId}
              users={users}
              channels={channels}
              currentUserId={currentUserId}
              workspaceId={workspaceId}
              projectId={projectId}
              threadReplies={threadReplies}
              parentMessage={threadParentMessage}
              onClose={onCloseThread}
              onDeleteMessage={onDeleteMessage}
              onEditMessage={onEditMessage}
              onToggleReaction={onToggleReaction}
              onSendThreadReply={(text, attachments, alsoSendToChannel) =>
                onSendThreadReply(activeThreadRootId, text, attachments, alsoSendToChannel)
              }
              onThreadRepliesLoaded={onThreadRepliesLoaded}
              onCreateTaskFromMessage={onCreateTaskFromMessage}
              createTaskBusy={createTaskBusy}
              onUserClick={openUserProfile}
            />
          </div>
        </div>
      )}
    </div>
  );
};
