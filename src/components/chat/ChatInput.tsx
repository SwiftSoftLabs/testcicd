"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { User } from "@/types";
import { WorkspaceFile } from "@/types/files";
import { ScheduleModal } from "./ScheduleModal";
import { ChatComposeAssistant } from "./ChatComposeAssistant";
import { WorkspaceFilePicker } from "@/components/files/WorkspaceFilePicker";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import {
  expandBareFenceAtCursor,
  normalizeBareFencesToMarkdown,
} from "@/lib/chat/fencedMarkdown";

function buildReplyPreview(content: string): { text: string; hasCode: boolean } {
  const trimmed = content.trim();
  const match = trimmed.match(/^([^`]*)```(?:markdown|\w*\n?)([\s\S]*?)```/);
  if (match) {
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
    const combined = parts.join(" ") || "Code block";
    return {
      text: combined.length > 100 ? combined.slice(0, 100) + "…" : combined,
      hasCode: true,
    };
  }
  return {
    text: trimmed.length > 120 ? trimmed.slice(0, 120) + "…" : trimmed,
    hasCode: false,
  };
}

interface Channel {
  id: string;
  name: string;
}

type MentionItem = { kind: "everyone" } | { kind: "user"; user: User };

type SlashCommandType = "task" | "email" | "files";
interface SlashTaskResult { id: string; title: string; status: string; priority: string; project_name: string | null; }
interface SlashEmailResult { email_id: string; email_subject: string; email_preview: string; }
interface SlashFileResult { id: string; file_name: string; file_type: string; file_size: number; storage_path: string; }
type SlashResult = SlashTaskResult | SlashEmailResult | SlashFileResult;

export type ChatAttachment =
  | {
    type?: "file";
    workspace_file_id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    storage_path: string;
  }
  | {
      type: "commit";
      commit_id: string;
      commit_message: string;
      commit_sha?: string;
      author_name?: string;
    }
  | {
      type: "task";
      task_id: string;
      task_title: string;
      task_status: string;
      task_priority: string;
      task_project?: string;
    }
  | {
      type: "email";
      email_id: string;
      email_subject: string;
      email_preview: string;
    };

export type ReplyContext = {
  id: string;
  content: string;
  senderName: string;
  imagePreviewUrl?: string;
};

interface ChatInputProps {
  conversationId: string;
  onSendMessage: (text: string, attachments?: ChatAttachment[], replyTo?: ReplyContext) => void;
  users?: User[];
  channels?: Channel[];
  workspaceId?: string;
  projectId?: string;
  replyingTo?: ReplyContext | null;
  onCancelReply?: () => void;
  placeholder?: string;
  variant?: "channel" | "thread";
  disabled?: boolean;
  disabledReason?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  conversationId,
  onSendMessage,
  users = [],
  channels = [],
  workspaceId,
  projectId,
  replyingTo,
  onCancelReply,
  placeholder = "Message...",
  variant = "channel",
  disabled = false,
  disabledReason,
}) => {
  const [message, setMessage] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [channelQuery, setChannelQuery] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledMessages, setScheduledMessages] = useState<
    { id: string; text: string; time: Date }[]
  >([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showCommitPicker, setShowCommitPicker] = useState(false);
  const [commitList, setCommitList] = useState<
    { id: string; message: string; sha?: string; author_name?: string }[]
  >([]);
  const [isDragging, setIsDragging] = useState(false);
  // object URLs for image previews: workspace_file_id → objectURL
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});

  const [slashCommand, setSlashCommand] = useState<SlashCommandType | null>(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashResults, setSlashResults] = useState<SlashResult[]>([]);
  const [slashLoading, setSlashLoading] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onSendMessageRef = useRef(onSendMessage);
  const imagePreviewsRef = useRef(imagePreviews);

  useEffect(() => { onSendMessageRef.current = onSendMessage; }, [onSendMessage]);
  useEffect(() => { imagePreviewsRef.current = imagePreviews; }, [imagePreviews]);

  useEffect(() => {
    if (slashCommand === null) { setSlashResults([]); return; }
    if (slashDebounceRef.current) clearTimeout(slashDebounceRef.current);
    slashDebounceRef.current = setTimeout(async () => {
      setSlashLoading(true);
      try {
        const qp = encodeURIComponent(slashQuery);
        let url = "";
        if (slashCommand === "task" && workspaceId)
          url = `/api/chat/slash/tasks?workspaceId=${workspaceId}&q=${qp}`;
        else if (slashCommand === "email")
          url = `/api/chat/slash/emails?q=${qp}`;
        else if (slashCommand === "files" && workspaceId)
          url = `/api/chat/slash/files?workspaceId=${workspaceId}&q=${qp}`;
        if (!url) return;
        const res = await authenticatedFetch(url);
        if (res.ok) setSlashResults(((await res.json()) as { data: SlashResult[] }).data ?? []);
      } catch { /* silent */ } finally { setSlashLoading(false); }
    }, 250);
    return () => { if (slashDebounceRef.current) clearTimeout(slashDebounceRef.current); };
  }, [slashCommand, slashQuery, workspaceId]);

  // Revoke all object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(imagePreviewsRef.current).forEach(URL.revokeObjectURL);
    };
  }, []);

  // Load draft
  useEffect(() => {
    if (!conversationId) return;
    const draft = localStorage.getItem(`chat_draft_${conversationId}`);
    setMessage(draft ?? "");
  }, [conversationId]);

  // Close emoji picker on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node))
        setShowEmojiPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close add menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
        setShowCommitPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const mentionItems: MentionItem[] =
    mentionQuery !== null
      ? [
          ...("everyone".startsWith(mentionQuery.toLowerCase()) ? [{ kind: "everyone" as const }] : []),
          ...users
            .filter(
              (u) =>
                u.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
                u.id.toLowerCase().includes(mentionQuery.toLowerCase()),
            )
            .map((u): MentionItem => ({ kind: "user", user: u })),
        ]
      : [];

  const filteredChannels =
    channelQuery !== null
      ? channels.filter((c) => c.name.toLowerCase().includes(channelQuery.toLowerCase()))
      : [];

  // ─── Shared file upload ──────────────────────────────────────────────────────
  const uploadFile = useCallback(async (file: File) => {
    if (!workspaceId) return;
    setIsUploading(true);
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("workspace_id", workspaceId);
      const res = await authenticatedFetch("/api/files/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const uploaded = await res.json();
      const att: ChatAttachment = {
        type: "file",
        workspace_file_id: uploaded.id,
        file_name: uploaded.file_name,
        file_type: uploaded.file_type,
        file_size: uploaded.file_size,
        storage_path: uploaded.storage_path,
      };
      setPendingAttachments((prev) => [...prev, att]);
      if (previewUrl) {
        setImagePreviews((prev) => ({ ...prev, [uploaded.id]: previewUrl }));
      }
    } catch (err) {
      console.error("File upload failed:", err);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    } finally {
      setIsUploading(false);
    }
  }, [workspaceId]);

  const removeAttachment = useCallback((att: ChatAttachment) => {
    if (!att.type || att.type === "file") {
      const preview = imagePreviewsRef.current[att.workspace_file_id];
      if (preview) {
        URL.revokeObjectURL(preview);
        setImagePreviews((prev) => {
          const next = { ...prev };
          delete next[att.workspace_file_id];
          return next;
        });
      }
    }
    setPendingAttachments((prev) =>
      prev.filter((a) => {
        if (att.type === "commit") return !(a.type === "commit" && a.commit_id === att.commit_id);
        if (att.type === "task")   return !(a.type === "task"   && a.task_id   === att.task_id);
        if (att.type === "email")  return !(a.type === "email"  && a.email_id  === att.email_id);
        return !((!a.type || a.type === "file") && a.workspace_file_id === att.workspace_file_id);
      }),
    );
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    let val = e.target.value;
    const cursor = e.target.selectionStart || 0;
    const expanded = expandBareFenceAtCursor(val, cursor, message);
    if (expanded) {
      val = expanded.text;
      setMessage(val);
      if (conversationId) {
        if (val.trim()) localStorage.setItem(`chat_draft_${conversationId}`, val);
        else localStorage.removeItem(`chat_draft_${conversationId}`);
      }
      setTimeout(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(expanded.cursor, expanded.cursor);
      }, 0);
    } else {
      setMessage(val);
      if (conversationId) {
        if (val.trim()) localStorage.setItem(`chat_draft_${conversationId}`, val);
        else localStorage.removeItem(`chat_draft_${conversationId}`);
      }
    }
    const effectiveCursor = expanded ? expanded.cursor : cursor;
    const textBeforeCursor = val.slice(0, effectiveCursor);
    const words = textBeforeCursor.split(/\s/);
    const lastWord = words[words.length - 1];
    if (lastWord.startsWith("@")) {
      setMentionQuery(lastWord.slice(1));
      setChannelQuery(null);
      setSelectedIndex(0);
    } else if (lastWord.startsWith("#")) {
      setChannelQuery(lastWord.slice(1));
      setMentionQuery(null);
      setSelectedIndex(0);
    } else {
      setMentionQuery(null);
      setChannelQuery(null);
      const slashMatch = textBeforeCursor.match(/(?:^|\s)(\/(?:task|email|files))(\S*.*?)$/i);
      if (slashMatch) {
        const cmd = slashMatch[1].slice(1).toLowerCase() as SlashCommandType;
        const sq = slashMatch[2].trimStart();
        setSlashCommand(cmd);
        setSlashQuery(sq);
        setSlashSelectedIndex(0);
      } else {
        setSlashCommand(null);
        setSlashQuery("");
      }
    }
  };

  const insertText = (text: string) => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart || 0;
    const textBeforeCursor = message.slice(0, cursor);
    const words = textBeforeCursor.split(/\s/);
    const lastWord = words[words.length - 1];
    const newTextBeforeCursor = textBeforeCursor.slice(0, -lastWord.length) + text + " ";
    const newText = newTextBeforeCursor + message.slice(cursor);
    setMessage(newText);
    setMentionQuery(null);
    setChannelQuery(null);
    if (conversationId) localStorage.setItem(`chat_draft_${conversationId}`, newText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = newTextBeforeCursor.length;
        textareaRef.current.selectionEnd = newTextBeforeCursor.length;
      }
    }, 0);
  };

  const insertAtCursor = (text: string) => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart ?? message.length;
    const next = message.slice(0, cursor) + text + message.slice(cursor);
    setMessage(next);
    if (conversationId) localStorage.setItem(`chat_draft_${conversationId}`, next);
    setTimeout(() => {
      if (!textareaRef.current) return;
      const pos = cursor + text.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (slashCommand !== null && slashResults.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashSelectedIndex((i) => (i < slashResults.length - 1 ? i + 1 : 0)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlashSelectedIndex((i) => (i > 0 ? i - 1 : slashResults.length - 1)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); handleSelectSlashResult(slashResults[slashSelectedIndex]); return; }
      if (e.key === "Escape")    { e.preventDefault(); removeSlashCommandText(); return; }
    }
    const isPopupOpen =
      (mentionQuery !== null && mentionItems.length > 0) ||
      (channelQuery !== null && filteredChannels.length > 0) ||
      (slashCommand !== null && slashResults.length > 0);
    const maxIndex = mentionQuery !== null ? mentionItems.length - 1 : filteredChannels.length - 1;

    if (isPopupOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < maxIndex ? prev + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : maxIndex));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (mentionQuery !== null) {
          const item = mentionItems[selectedIndex];
          if (item.kind === "everyone") insertText("@everyone");
          else insertText(`@${item.user.name.replace(/\s+/g, "")}`);
        } else if (channelQuery !== null) {
          insertText(`#${filteredChannels[selectedIndex].name}`);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        setChannelQuery(null);
        return;
      }
    }

    if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      onCancelReply?.();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (message.trim() || pendingAttachments.length > 0) handleSend();
    }
  };

  // ─── Clipboard paste ─────────────────────────────────────────────────────────
  const handlePaste = async (e: React.ClipboardEvent) => {
    if (disabled) return;
    if (!workspaceId) return;
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();
    await uploadFile(file);
  };

  // ─── Drag and drop ───────────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    if (!workspaceId) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    if (!workspaceId) return;
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await uploadFile(file);
    }
  };

  const handleFileSelect = (file: WorkspaceFile) => {
    if (disabled) return;
    setShowFilePicker(false);
    setPendingAttachments((prev) => {
      if (prev.some((a) => (!a.type || a.type === "file") && a.workspace_file_id === file.id)) return prev;
      return [
        ...prev,
        {
          type: "file" as const,
          workspace_file_id: file.id,
          file_name: file.file_name,
          file_type: file.file_type,
          file_size: file.file_size,
          storage_path: file.storage_path,
        },
      ];
    });
  };

  const handleNativeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setShowAddMenu(false);
    await uploadFile(file);
    e.target.value = "";
  };

  const handleOpenCommitPicker = async () => {
    if (disabled || !projectId) return;
    try {
      const res = await authenticatedFetch(`/api/vc/commits?projectId=${projectId}`);
      const data = await res.json();
      setCommitList(
        data.map((c: Record<string, unknown>) => ({
          id: c.id as string,
          message: c.message as string,
          sha: c.sha as string | undefined,
          author_name: (c.author as { full_name?: string } | null)?.full_name,
        })),
      );
      setShowCommitPicker(true);
    } catch (err) {
      console.error("Failed to load commits:", err);
    }
  };

  const handleSelectCommit = (commit: {
    id: string;
    message: string;
    sha?: string;
    author_name?: string;
  }) => {
    if (disabled) return;
    setPendingAttachments((prev) => {
      if (prev.some((a) => a.type === "commit" && a.commit_id === commit.id)) return prev;
      return [
        ...prev,
        {
          type: "commit" as const,
          commit_id: commit.id,
          commit_message: commit.message,
          commit_sha: commit.sha,
          author_name: commit.author_name,
        },
      ];
    });
    setShowCommitPicker(false);
    setShowAddMenu(false);
  };

  const removeSlashCommandText = useCallback(() => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart ?? message.length;
    const textBefore = message.slice(0, cursor);
    const slashIdx = textBefore.search(/\/(?:task|email|files)/i);
    if (slashIdx === -1) return;
    const newText = (textBefore.slice(0, slashIdx).trimEnd() + message.slice(cursor)).trimEnd();
    setMessage(newText);
    setSlashCommand(null);
    setSlashQuery("");
    setSlashResults([]);
    if (conversationId) {
      if (newText) localStorage.setItem(`chat_draft_${conversationId}`, newText);
      else localStorage.removeItem(`chat_draft_${conversationId}`);
    }
    setTimeout(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(slashIdx, slashIdx);
    }, 0);
  }, [message, conversationId]);

  const handleSelectSlashResult = useCallback((result: SlashResult) => {
    if (slashCommand === "task") {
      const r = result as SlashTaskResult;
      setPendingAttachments((prev) =>
        prev.some((a) => a.type === "task" && a.task_id === r.id)
          ? prev
          : [...prev, { type: "task", task_id: r.id, task_title: r.title, task_status: r.status, task_priority: r.priority, task_project: r.project_name ?? undefined }],
      );
    } else if (slashCommand === "email") {
      const r = result as SlashEmailResult;
      setPendingAttachments((prev) =>
        prev.some((a) => a.type === "email" && a.email_id === r.email_id)
          ? prev
          : [...prev, { type: "email", email_id: r.email_id, email_subject: r.email_subject, email_preview: r.email_preview }],
      );
    } else if (slashCommand === "files") {
      const r = result as SlashFileResult;
      setPendingAttachments((prev) =>
        prev.some((a) => (!a.type || a.type === "file") && a.workspace_file_id === r.id)
          ? prev
          : [...prev, { type: "file", workspace_file_id: r.id, file_name: r.file_name, file_type: r.file_type, file_size: r.file_size, storage_path: r.storage_path }],
      );
    }
    removeSlashCommandText();
  }, [slashCommand, removeSlashCommandText]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (disabled) return;
    if (!message.trim() && pendingAttachments.length === 0) return;
    onSendMessage(
      normalizeBareFencesToMarkdown(message),
      pendingAttachments.length > 0 ? pendingAttachments : undefined,
      replyingTo ?? undefined,
    );
    setMessage("");
    setPendingAttachments([]);
    setMentionQuery(null);
    setChannelQuery(null);
    setSlashCommand(null);
    setSlashQuery("");
    setSlashResults([]);
    onCancelReply?.();
    // Revoke object URLs after send
    Object.values(imagePreviews).forEach(URL.revokeObjectURL);
    setImagePreviews({});
    if (conversationId) localStorage.removeItem(`chat_draft_${conversationId}`);
  };

  const handleSchedule = (delayMs: number) => {
    if (disabled || !message.trim()) return;
    const sendTime = new Date(Date.now() + delayMs);
    const textToSend = normalizeBareFencesToMarkdown(message);
    const msgId = Math.random().toString(36).slice(2);
    setScheduledMessages((prev) => [...prev, { id: msgId, text: textToSend, time: sendTime }]);
    setTimeout(() => {
      onSendMessageRef.current(textToSend);
      setScheduledMessages((prev) => prev.filter((m) => m.id !== msgId));
    }, delayMs);
    setMessage("");
    setPendingAttachments([]);
    setMentionQuery(null);
    setChannelQuery(null);
    if (conversationId) localStorage.removeItem(`chat_draft_${conversationId}`);
  };

  return (
    <div
      className={`p-4 border-t bg-background-dark relative transition-colors ${
        isDragging ? "border-primary/60 bg-primary/5" : "border-border-dark"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/60 bg-primary/10 pointer-events-none">
          <span className="material-symbols-outlined text-primary text-4xl mb-2">
            image
          </span>
          <p className="text-primary font-bold text-sm">Drop to attach</p>
        </div>
      )}

      {showFilePicker && workspaceId && (
        <WorkspaceFilePicker
          workspaceId={workspaceId}
          onSelect={handleFileSelect}
          onClose={() => setShowFilePicker(false)}
        />
      )}
      {showScheduleModal && !disabled && (
        <ScheduleModal
          onClose={() => setShowScheduleModal(false)}
          onSchedule={handleSchedule}
        />
      )}

      {scheduledMessages.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {scheduledMessages.map((sm) => (
            <div
              key={sm.id}
              className="text-xs text-amber-500/80 bg-amber-500/10 px-3 py-1.5 rounded flex items-center justify-between border border-amber-500/20"
            >
              <span>Scheduled for {sm.time.toLocaleTimeString()}</span>
              <span className="truncate max-w-[150px] opacity-70">"{sm.text}"</span>
            </div>
          ))}
        </div>
      )}

      {/* Autocomplete Popup — Mentions */}
      {mentionQuery !== null && mentionItems.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-64 bg-surface-dark border border-border-dark rounded-xl shadow-xl overflow-hidden z-50">
          <div className="px-3 py-2 bg-white/5 border-b border-border-dark text-xs font-bold text-text-secondary">
            Members matching "{mentionQuery}"
          </div>
          <ul className="max-h-48 overflow-y-auto custom-scrollbar p-1">
            {mentionItems.map((item, i) => {
              if (item.kind === "everyone") {
                return (
                  <li
                    key="__everyone__"
                    onClick={() => insertText("@everyone")}
                    className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer ${
                      i === selectedIndex ? "bg-primary/20 text-white" : "text-text-secondary hover:bg-white/5"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] text-amber-400">groups</span>
                    <span className="text-amber-400 font-semibold">Everyone</span>
                  </li>
                );
              }
              return (
                <li
                  key={item.user.id}
                  onClick={() => insertText(`@${item.user.name.replace(/\s+/g, "")}`)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer ${
                    i === selectedIndex ? "bg-primary/20 text-white" : "text-text-secondary hover:bg-white/5"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.user.avatar} className="size-5 rounded-full object-cover" alt="" />
                  <span>{item.user.name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Autocomplete Popup — Channels */}
      {channelQuery !== null && filteredChannels.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-64 bg-surface-dark border border-border-dark rounded-xl shadow-xl overflow-hidden z-50">
          <div className="px-3 py-2 bg-white/5 border-b border-border-dark text-xs font-bold text-text-secondary">
            Channels matching "{channelQuery}"
          </div>
          <ul className="max-h-48 overflow-y-auto custom-scrollbar p-1">
            {filteredChannels.map((channel, i) => (
              <li
                key={channel.id}
                onClick={() => insertText(`#${channel.name}`)}
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer ${
                  i === selectedIndex ? "bg-primary/20 text-white" : "text-text-secondary hover:bg-white/5"
                }`}
              >
                <span className="text-text-secondary font-bold">#</span>
                <span>{channel.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conversationId && !disabled && (
        <>
          {/* Slash Command Popup */}
          {slashCommand !== null && (
            <div className="absolute bottom-full left-4 mb-2 w-80 bg-surface-dark border border-border-dark rounded-xl shadow-xl overflow-hidden z-50">
              <div className="px-3 py-2 bg-white/5 border-b border-border-dark text-xs font-bold text-text-secondary flex items-center justify-between">
                <span>
                  {slashCommand === "task" && "Tasks"}
                  {slashCommand === "email" && "Emails"}
                  {slashCommand === "files" && "Files"}
                  {slashQuery && ` matching "${slashQuery}"`}
                </span>
                {slashLoading && (
                  <span className="material-symbols-outlined text-[14px] animate-spin text-primary">progress_activity</span>
                )}
              </div>
              <ul className="max-h-56 overflow-y-auto custom-scrollbar p-1">
                {slashResults.length === 0 && !slashLoading ? (
                  <li className="px-3 py-3 text-xs text-text-secondary text-center">No results</li>
                ) : (
                  slashResults.map((result, i) => {
                    const sel = `flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm ${i === slashSelectedIndex ? "bg-primary/20 text-white" : "text-text-secondary hover:bg-white/5"}`;
                    if (slashCommand === "task") {
                      const r = result as SlashTaskResult;
                      return (
                        <li key={r.id} onClick={() => handleSelectSlashResult(r)} className={sel}>
                          <span className="material-symbols-outlined text-[16px] text-primary mt-0.5 shrink-0">task_alt</span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{r.title}</div>
                            <div className="text-[11px] opacity-60 flex items-center gap-1 flex-wrap">
                              {r.project_name && (
                                <>
                                  <span className="text-primary/70">{r.project_name}</span>
                                  <span>·</span>
                                </>
                              )}
                              <span>{r.status}</span>
                              <span>·</span>
                              <span>{r.priority}</span>
                            </div>
                          </div>
                        </li>
                      );
                    }
                    if (slashCommand === "email") {
                      const r = result as SlashEmailResult;
                      return (
                        <li key={r.email_id} onClick={() => handleSelectSlashResult(r)} className={sel}>
                          <span className="material-symbols-outlined text-[16px] text-primary mt-0.5 shrink-0">mail</span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{r.email_subject}</div>
                            <div className="text-[11px] opacity-60 truncate">{r.email_preview}</div>
                          </div>
                        </li>
                      );
                    }
                    const r = result as SlashFileResult;
                    return (
                      <li key={r.id} onClick={() => handleSelectSlashResult(r)} className={sel}>
                        <span className="material-symbols-outlined text-[16px] text-primary mt-0.5 shrink-0">attach_file</span>
                        <div className="truncate">{r.file_name}</div>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </>
      )}

      {conversationId && !disabled && (
        <ChatComposeAssistant
          conversationId={conversationId}
          draft={message}
          onApplyText={(text) => {
            if (disabled) return;
            setMessage(text);
            localStorage.setItem(`chat_draft_${conversationId}`, text);
            textareaRef.current?.focus();
          }}
        />
      )}

      {/* Pending attachments */}
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingAttachments.map((att) => {
            if (att.type === "task") {
              return (
                <div
                  key={att.task_id}
                  className="flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1 text-xs text-text-secondary"
                >
                  <span className="material-symbols-outlined text-[14px] text-primary">task_alt</span>
                  {att.task_project && (
                    <span className="text-primary/70 shrink-0">{att.task_project}</span>
                  )}
                  <span className="max-w-[120px] truncate">{att.task_title}</span>
                  <span className="opacity-50 shrink-0">{att.task_status}</span>
                  <button onClick={() => removeAttachment(att)} className="cursor-pointer ml-0.5 hover:text-red-400 transition-colors">
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </div>
              );
            }
            if (att.type === "email") {
              return (
                <div
                  key={att.email_id}
                  className="flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1 text-xs text-text-secondary"
                >
                  <span className="material-symbols-outlined text-[14px] text-primary">mail</span>
                  <span className="max-w-[140px] truncate">{att.email_subject}</span>
                  <button onClick={() => removeAttachment(att)} className="cursor-pointer ml-0.5 hover:text-red-400 transition-colors">
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </div>
              );
            }
            if (att.type === "commit") {
              return (
                <div
                  key={att.commit_id}
                  className="flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1 text-xs text-text-secondary"
                >
                  <span className="material-symbols-outlined text-[14px]">commit</span>
                  <span className="font-mono text-primary text-[11px]">
                    {att.commit_sha?.slice(0, 7) ?? att.commit_id.slice(0, 7)}
                  </span>
                  <span className="max-w-[120px] truncate">{att.commit_message}</span>
                  <button
                    onClick={() => removeAttachment(att)}
                    className="cursor-pointer ml-0.5 hover:text-red-400 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </div>
              );
            }

            const isImage = att.file_type?.startsWith("image/");
            const previewSrc =
              imagePreviews[att.workspace_file_id] ||
              `/api/files/${att.workspace_file_id}/download`;

            if (isImage) {
              return (
                <div key={att.workspace_file_id} className="relative group/img shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewSrc}
                    alt={att.file_name}
                    className="size-20 rounded-xl object-cover border border-border-dark"
                  />
                  <button
                    onClick={() => removeAttachment(att)}
                    className="cursor-pointer absolute -top-1.5 -right-1.5 size-5 flex items-center justify-center bg-background-dark border border-border-dark rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-red-500/20 hover:border-red-500/40"
                  >
                    <span className="material-symbols-outlined text-[12px] text-text-secondary hover:text-red-400">
                      close
                    </span>
                  </button>
                </div>
              );
            }

            return (
              <div
                key={att.workspace_file_id}
                className="flex items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-2.5 py-1 text-xs text-text-secondary"
              >
                <span className="material-symbols-outlined text-[14px]">attach_file</span>
                <span className="max-w-[120px] truncate">{att.file_name}</span>
                <button
                  onClick={() => removeAttachment(att)}
                  className="cursor-pointer ml-0.5 hover:text-red-400 transition-colors"
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Reply bar */}
      {replyingTo && (
        <div className="mb-2 flex items-center gap-2 pl-0 pr-2 py-2 bg-primary/5 border border-primary/20 rounded-xl overflow-hidden">
          <div className="w-0.5 self-stretch bg-primary/60 shrink-0 ml-3" />
          {replyingTo.imagePreviewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={replyingTo.imagePreviewUrl}
              alt=""
              className="size-10 rounded-lg object-cover shrink-0 border border-border-dark"
            />
          )}
          <div className="flex-1 min-w-0 py-0.5">
            <span className="text-[10px] font-bold text-primary block mb-0.5">
              Replying to {replyingTo.senderName}
            </span>
            {replyingTo.content.trim() ? (() => {
              const { text, hasCode } = buildReplyPreview(replyingTo.content);
              return (
                <span className="text-xs text-white/70 block truncate leading-relaxed">
                  {hasCode && (
                    <span className="material-symbols-outlined text-[10px] mr-0.5 align-middle opacity-60">code</span>
                  )}
                  {text}
                </span>
              );
            })() : replyingTo.imagePreviewUrl ? (
              <span className="text-xs text-white/50 flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">image</span>
                Photo
              </span>
            ) : (
              <span className="text-xs text-white/50">
                <span className="material-symbols-outlined text-[12px]">attach_file</span>
                Attachment
              </span>
            )}
          </div>
          <button
            onClick={onCancelReply}
            className="cursor-pointer p-1 hover:bg-white/10 rounded text-text-secondary hover:text-white shrink-0"
            title="Cancel reply"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      <div className="relative bg-surface-dark border border-border-dark rounded-xl focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50 transition-all shadow-sm">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? (disabledReason ?? "This channel is read-only.")
              : isUploading
                ? "Uploading..."
                : placeholder
          }
          className="w-full bg-transparent text-sm text-white p-3 min-h-[44px] max-h-[120px] resize-none focus:outline-none custom-scrollbar placeholder:text-text-secondary disabled:cursor-not-allowed disabled:text-text-secondary"
          rows={1}
          disabled={disabled || isUploading}
        />

        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            {/* + Button with dropdown */}
            {workspaceId && (
              <div className="relative" ref={addMenuRef}>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleNativeUpload}
                  accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,text/plain,text/csv,text/markdown,application/json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="cursor-pointer p-1.5 text-text-secondary hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  onClick={() => {
                    setShowAddMenu((prev) => !prev);
                    setShowCommitPicker(false);
                  }}
                  disabled={disabled || isUploading}
                  title="Add attachment"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {isUploading ? "hourglass_empty" : "add_circle"}
                  </span>
                </button>
                {showAddMenu && !showCommitPicker && (
                  <div className="absolute bottom-full left-0 mb-2 w-48 bg-surface-dark border border-border-dark rounded-xl shadow-xl overflow-hidden z-50">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={disabled}
                      className="cursor-pointer flex items-center gap-2 w-full px-3 py-2.5 text-sm text-text-secondary hover:bg-white/5 hover:text-white transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">upload_file</span>
                      Upload file
                    </button>
                    {projectId && (
                      <button
                        type="button"
                        onClick={handleOpenCommitPicker}
                        disabled={disabled}
                        className="cursor-pointer flex items-center gap-2 w-full px-3 py-2.5 text-sm text-text-secondary hover:bg-white/5 hover:text-white transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">commit</span>
                        Attach commit
                      </button>
                    )}
                  </div>
                )}
                {showAddMenu && showCommitPicker && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 bg-surface-dark border border-border-dark rounded-xl shadow-xl overflow-hidden z-50">
                    <div className="px-3 py-2 bg-white/5 border-b border-border-dark text-xs font-bold text-text-secondary flex items-center justify-between">
                      <span>Select commit</span>
                      <button onClick={() => setShowCommitPicker(false)} className="cursor-pointer hover:text-white">
                        <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                      </button>
                    </div>
                    <ul className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                      {commitList.length === 0 ? (
                        <li className="px-3 py-3 text-xs text-text-secondary text-center">No commits found</li>
                      ) : (
                        commitList.map((c) => (
                          <li
                            key={c.id}
                            onClick={() => handleSelectCommit(c)}
                            className="px-3 py-2 text-sm text-text-secondary hover:bg-white/5 hover:text-white rounded-lg cursor-pointer"
                          >
                            <div className="font-mono text-xs text-primary">
                              {c.sha?.slice(0, 7) ?? c.id.slice(0, 7)}
                            </div>
                            <div className="truncate">{c.message}</div>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Attach from workspace files */}
            {workspaceId && (
              <button
                type="button"
                className="cursor-pointer p-1.5 text-text-secondary hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                disabled={disabled}
                onClick={() => setShowFilePicker(true)}
                title="Attach from Files"
              >
                <span className="material-symbols-outlined text-[18px]">folder_open</span>
              </button>
            )}

            {/* Emoji picker */}
            <div className="relative" ref={emojiPickerRef}>
              <button
                type="button"
                className="cursor-pointer p-1.5 text-text-secondary hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                disabled={disabled}
                onClick={() => setShowEmojiPicker((prev) => !prev)}
                title="Emoji"
              >
                <span className="material-symbols-outlined text-[18px]">sentiment_satisfied</span>
              </button>
              {showEmojiPicker && (
                <div className="absolute bottom-full left-0 mb-2 z-50">
                  <EmojiPicker
                    onEmojiClick={(data: EmojiClickData) => {
                      insertAtCursor(data.emoji);
                      setShowEmojiPicker(false);
                    }}
                    theme={Theme.DARK}
                    width={300}
                    height={400}
                  />
                </div>
              )}
            </div>

            {/* Mention */}
            <button
              type="button"
              className="cursor-pointer p-1.5 text-text-secondary hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              disabled={disabled}
              onClick={() => {
                const newText = message + "@";
                setMessage(newText);
                setMentionQuery("");
                textareaRef.current?.focus();
              }}
              title="Mention"
            >
              <span className="material-symbols-outlined text-[18px]">alternate_email</span>
            </button>

            {/* Schedule */}
            <button
              type="button"
              className="cursor-pointer p-1.5 text-text-secondary hover:text-white hover:bg-white/10 rounded-lg transition-colors ml-2"
              onClick={() => message.trim() && setShowScheduleModal(true)}
              disabled={disabled || !message.trim()}
              title="Schedule Message"
            >
              <span className="material-symbols-outlined text-[18px]">schedule</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={disabled || (!message.trim() && pendingAttachments.length === 0) || isUploading}
            className="p-1.5 bg-primary text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors shadow-lg shadow-primary/20"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isUploading ? "hourglass_empty" : "send"}
            </span>
          </button>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-text-secondary text-center hidden sm:block">
        {variant === "thread" ? (
          "Replying in thread."
        ) : (
          <>
            <strong>Return</strong> to send · <strong>Shift+Return</strong> for new line · <strong>Paste</strong> or <strong>drop</strong> to attach image
          </>
        )}
      </div>
    </div>
  );
};
