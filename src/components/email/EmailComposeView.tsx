"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import EmailRichEditor, {
  EmailRichEditorHandle,
} from "@/components/email/EmailRichEditor";
import { api } from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { useAssistantPageContextBridge } from "@/context/AssistantPageContextBridge";
import { useUIContext } from "@/context/UIContext";
import { EmailMessage, MailAccountStatus, User } from "@/types";
import {
  buildStoredContent,
  parseStoredEmailContent,
  StoredAttachmentMeta,
} from "@/lib/email/contentMeta";
import {
  fetchMailboxMessage,
  isDemoMailboxProject,
} from "@/lib/email/demoMailbox";
import { AiChip, AiHeading, AiPanel } from "@/components/ai/AiUi";
import { readMailboxStatusCache } from "@/lib/email/mailboxSessionCache";

interface LocalAttachment extends StoredAttachmentMeta {
  localId: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatSavedAgo(at: Date | null): string {
  if (!at) return "";
  const s = Math.max(0, Math.floor((Date.now() - at.getTime()) / 1000));
  if (s < 15) return "Saved just now";
  if (s < 60) return `Saved ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Saved ${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Saved ${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `Saved ${d} day${d === 1 ? "" : "s"} ago`;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildQuoteHtml(email: EmailMessage): string {
  const when = new Date(email.created_at).toLocaleString();
  const sentBy = email.sender?.full_name || "Sender";
  const { bodyHtml } = parseStoredEmailContent(email.content || "");
  return `<p></p><hr style="border-color:rgba(148,163,184,0.35)" /><p style="font-size:12px;color:#94a3b8">${when} · ${sentBy} wrote:</p><blockquote style="border-left:2px solid #195de6;padding-left:12px;margin:8px 0;color:#cbd5e1">${bodyHtml || ""}</blockquote>`;
}

function findUser(users: User[], id: string): User | undefined {
  return users.find((u) => u.id === id);
}

function RecipientChip({
  label,
  sub,
  initials,
  avatarUrl,
  onRemove,
  disabled,
}: {
  label: string;
  sub?: string;
  initials: string;
  avatarUrl?: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg bg-surface-highlight border border-border-dark text-xs max-w-full">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="size-7 rounded-full shrink-0 object-cover border border-border-dark/80"
        />
      ) : (
        <span
          className="size-7 rounded-full shrink-0 flex items-center justify-center bg-primary/18 text-[10px] font-black text-primary border border-primary/25"
          aria-hidden
        >
          {initials}
        </span>
      )}
      <span className="flex flex-col min-w-0">
        <span className="font-bold text-main truncate">{label}</span>
        {sub ? (
          <span className="text-[10px] text-text-secondary truncate">
            {sub}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        className="shrink-0 p-1 rounded-md text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
        aria-label={`Remove ${label}`}
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </span>
  );
}

function RecipientRow({
  idPrefix,
  label,
  chips,
  onRemove,
  draft,
  setDraft,
  onCommitDraft,
  users,
  disabled,
}: {
  idPrefix: string;
  label: string;
  chips: { id: string; label: string; initials: string; avatarUrl?: string }[];
  onRemove: (id: string) => void;
  draft: string;
  setDraft: (v: string) => void;
  onCommitDraft: () => void;
  users: User[];
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-3 px-5 py-3 border-b border-border-dark/90 bg-background-dark/15">
      <span className="text-[13px] font-bold text-text-secondary w-10 shrink-0 pt-2">
        {label}
      </span>
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <RecipientChip
            key={c.id}
            label={c.label}
            initials={c.initials}
            avatarUrl={c.avatarUrl}
            onRemove={() => onRemove(c.id)}
            disabled={disabled}
          />
        ))}
        <input
          list={`${idPrefix}-user-options`}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              onCommitDraft();
            }
          }}
          onBlur={() => {
            if (draft.trim()) onCommitDraft();
          }}
          placeholder="Add recipients…"
          className="flex-1 min-w-[140px] max-w-[min(280px,100%)] bg-transparent border-0 py-2 text-sm text-main focus:ring-0 placeholder:text-text-secondary/55 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <datalist id={`${idPrefix}-user-options`}>
          {users.map((u) => (
            <option key={u.id} value={u.email}>
              {u.name} — {u.email}
            </option>
          ))}
        </datalist>
      </div>
    </div>
  );
}

type ComposeAiMode =
  | "improve"
  | "proofread"
  | "shorter"
  | "expand"
  | "tone"
  | "subject";

function ComposeWritingAssistant({
  demoMailbox,
  readOnly,
  subject,
  setSubject,
  editorRef,
  onBodyHtmlCommitted,
}: {
  demoMailbox: boolean;
  readOnly?: boolean;
  subject: string;
  setSubject: (s: string) => void;
  editorRef: React.RefObject<EmailRichEditorHandle | null>;
  /** Keeps compose baseline in sync so editor resetKey effects do not restore stale HTML. */
  onBodyHtmlCommitted?: (html: string) => void;
}) {
  const { addToast } = useUIContext();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [tone, setTone] = useState<"formal" | "friendly" | "neutral">(
    "neutral",
  );

  const run = async (mode: ComposeAiMode) => {
    if (readOnly) return;
    if (demoMailbox) {
      addToast("AI assistant is not available for the sample mailbox.", "info");
      return;
    }
    const bodyHtml = editorRef.current?.getHtml() || "";
    const plainLen = bodyHtml.replace(/<[^>]+>/g, "").trim().length;
    if (mode !== "subject" && !plainLen) {
      addToast("Write something in the body first.", "warning");
      return;
    }
    if (mode === "subject" && !plainLen && !hint.trim()) {
      addToast(
        "Add message text or a short hint so AI can suggest a subject.",
        "warning",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await api.email.composeAi({
        mode,
        subject,
        bodyHtml,
        instruction: hint.trim() || undefined,
        tone: mode === "tone" ? tone : undefined,
      });
      if (res.subject) {
        setSubject(res.subject);
        addToast("Subject updated", "success");
      }
      if (res.bodyHtml) {
        editorRef.current?.replaceHtml(res.bodyHtml);
        onBodyHtmlCommitted?.(res.bodyHtml);
        editorRef.current?.focus();
        if (!res.subject) {
          addToast(
            mode === "proofread" ? "Proofread applied" : "Body updated",
            "success",
          );
        }
      }
      if (res.sourceTruncated) {
        addToast("Long draft was shortened before AI processing.", "info");
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : "AI request failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AiPanel
      open={open}
      onToggle={() => setOpen((o) => !o)}
      collapsible={false}
      header={
        <AiHeading
          title="AI Writing assistant"
          subtitle="Proofread, polish, or suggest a subject"
          className="flex-1"
        />
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <AiChip
            busy={busy}
            disabled={readOnly || busy}
            icon="spellcheck"
            onClick={() => void run("proofread")}
            >
            Proofread
          </AiChip>
          <AiChip
            busy={busy}
            disabled={readOnly || busy}
            icon="edit_note"
            onClick={() => void run("improve")}
            >
            Improve
          </AiChip>
          <AiChip
            busy={busy}
            disabled={readOnly || busy}
            icon="compress"
            onClick={() => void run("shorter")}
            >
            Make shorter
          </AiChip>
          <AiChip
            busy={busy}
            disabled={readOnly || busy}
            icon="unfold_more"
            onClick={() => void run("expand")}
            >
            Expand
          </AiChip>
          <AiChip
            busy={busy}
            disabled={readOnly || busy}
            icon="title"
            onClick={() => void run("subject")}
            >
            Suggest subject
          </AiChip>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-border-dark/60 bg-background-dark/30 p-3">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-secondary">
            Tone rewrite
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={tone}
              disabled={readOnly}
              onChange={(e) =>
                setTone(e.target.value as "formal" | "friendly" | "neutral")
              }
              className="flex-1 min-w-[8rem] rounded-lg border border-border-dark bg-surface-dark px-2 py-1.5 text-xs text-main"
            >
              <option value="neutral">Neutral</option>
              <option value="formal">Formal</option>
              <option value="friendly">Friendly</option>
            </select>
            <AiChip
              busy={busy}
              disabled={readOnly || busy}
              icon="tonality"
              onClick={() => void run("tone")}
            >
              Apply tone
            </AiChip>
          </div>
        </div>
        <label className="block text-[10px] font-bold uppercase tracking-wide text-text-secondary">
          Optional hint for AI
          <textarea
            value={hint}
            disabled={readOnly}
            onChange={(e) => setHint(e.target.value)}
            rows={2}
            placeholder="e.g. Mention we need an answer by Friday"
            className="mt-1 w-full rounded-xl border border-border-dark bg-background-dark px-3 py-2 text-xs text-main placeholder:text-text-secondary/50 outline-none focus:ring-2 focus:ring-primary/30 resize-none disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="size-4 border-2 border-violet-400/30 border-t-violet-300 rounded-full animate-spin" />
            Working…
          </div>
        ) : null}
      </div>
    </AiPanel>
  );
}

function ComposeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useUIContext();
  const { selectedProjectId, users, currentUser } = useAppContext();
  const { setEmailMessageId } = useAssistantPageContextBridge();

  const replyToParam = searchParams.get("replyTo");
  const replyAllParam = searchParams.get("replyAll");
  const forwardParam = searchParams.get("forward");
  const draftParam = searchParams.get("draft");

  const draftIdStable = draftParam || "";

  const [toIds, setToIds] = useState<string[]>([]);
  const [ccIds, setCcIds] = useState<string[]>([]);
  const [bccIds, setBccIds] = useState<string[]>([]);
  const [toDraft, setToDraft] = useState("");
  const [ccDraft, setCcDraft] = useState("");
  const [bccDraft, setBccDraft] = useState("");
  const [showCcSection, setShowCcSection] = useState(false);
  const [showBccSection, setShowBccSection] = useState(false);

  const [subject, setSubject] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [composerKey, setComposerKey] = useState(0);
  const initialBodyRef = useRef("");
  const [savedDraftId, setSavedDraftId] = useState<string | null>(
    draftIdStable || null,
  );
  const [loadingPrefill, setLoadingPrefill] = useState(
    !!(replyToParam || replyAllParam || forwardParam || draftParam),
  );

  const [busy, setBusy] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savedLabelTick, setSavedLabelTick] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [isLockedInbox, setIsLockedInbox] = useState(
    readMailboxStatusCache()?.account?.quota_locked === true,
  );

  const editorRef = useRef<EmailRichEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const effectiveDraftId = savedDraftId;
  const demoMailbox = !!(
    selectedProjectId && isDemoMailboxProject(selectedProjectId)
  );

  useEffect(() => {
    setEmailMessageId(effectiveDraftId);
    return () => setEmailMessageId(null);
  }, [effectiveDraftId, setEmailMessageId]);

  useEffect(() => {
    let cancelled = false;
    const warm = readMailboxStatusCache();
    if (warm) setIsLockedInbox(warm.account?.quota_locked === true);
    void api.email.accounts
      .status()
      .then((status) => {
        if (!cancelled) {
          setIsLockedInbox((status as MailAccountStatus).account?.quota_locked === true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lastSavedAt) return;
    const id = window.setInterval(
      () => setSavedLabelTick((t) => t + 1),
      30_000,
    );
    return () => clearInterval(id);
  }, [lastSavedAt]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (ccIds.length > 0) setShowCcSection(true);
    if (bccIds.length > 0) setShowBccSection(true);
  }, [ccIds.length, bccIds.length]);

  const loadSourceEmail = useCallback(async (id: string) => {
    return fetchMailboxMessage(id);
  }, []);

  const resolveCommit = (
    draft: string,
    setDraft: (s: string) => void,
    setIds: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    if (isLockedInbox) return;
    const v = draft.trim();
    if (!v) return;
    const lower = v.toLowerCase();
    const u = users.find((x) => x.id === v || x.email.toLowerCase() === lower);
    const token = u ? u.email.toLowerCase() : isLikelyEmail(lower) ? lower : "";
    if (!token) {
      addToast("Enter a valid email address or select a teammate.", "warning");
      return;
    }
    setIds((prev) => (prev.includes(token) ? prev : [...prev, token]));
    setDraft("");
  };

  const chipsForIds = useCallback(
    (ids: string[]) =>
      ids.map((id) => {
        const u =
          findUser(users, id) ||
          users.find(
            (candidate) => candidate.email.toLowerCase() === id.toLowerCase(),
          );
        const fallbackLabel = isLikelyEmail(id) ? id : id.slice(0, 8) + "…";
        return {
          id,
          label: u?.name || fallbackLabel,
          initials: u
            ? initialsFromName(u.name)
            : initialsFromName(fallbackLabel),
          avatarUrl: u?.avatar || undefined,
        };
      }),
    [users],
  );

  useEffect(() => {
    let cancelled = false;
    async function prefill() {
      setLoadingPrefill(true);
      try {
        if (draftParam) {
          const email = await loadSourceEmail(draftParam);
          if (cancelled || !email || !email.is_draft) return;
          const { bodyHtml, meta } = parseStoredEmailContent(
            email.content || "",
          );
          const to = email.recipient_id?.trim() ? [email.recipient_id] : [];
          setToIds(to);
          setCcIds(meta.cc.filter(Boolean));
          setBccIds(meta.bcc.filter(Boolean));
          setShowCcSection(Boolean(meta.cc.length || meta.bcc.length));
          setShowBccSection(Boolean(meta.bcc.length));
          setSubject(email.subject || "");
          initialBodyRef.current = bodyHtml || "";
          setComposerKey((k) => k + 1);
          setAttachments(
            meta.attachments.map((a, i) => ({
              ...a,
              localId: `d-${i}-${a.name}`,
            })),
          );
          setSavedDraftId(email.id);
          return;
        }

        const srcId = replyToParam || replyAllParam || forwardParam;
        if (!srcId) {
          initialBodyRef.current = "";
          setComposerKey((k) => k + 1);
          return;
        }

        const email = await loadSourceEmail(srcId);
        if (cancelled || !email) return;

        if (forwardParam) {
          setToIds([]);
          const subj = email.subject || "";
          setSubject(subj.startsWith("Fwd:") ? subj : `Fwd: ${subj}`);
          initialBodyRef.current = buildQuoteHtml(email);
          setComposerKey((k) => k + 1);
          return;
        }

        if (replyAllParam) {
          const { meta } = parseStoredEmailContent(email.content || "");
          const to = [email.sender_id || ""].filter(Boolean);
          setToIds(to);
          const extra = [email.recipient_id, ...meta.cc.filter(Boolean)].filter(
            (id) => id && id !== currentUser.id,
          );
          setCcIds(Array.from(new Set(extra.filter(Boolean))));
          setShowCcSection(true);
          const sub = email.subject || "";
          setSubject(sub.startsWith("Re:") ? sub : `Re: ${sub}`);
          initialBodyRef.current = buildQuoteHtml(email);
          setComposerKey((k) => k + 1);
          return;
        }

        if (replyToParam) {
          setToIds([email.sender_id || ""].filter(Boolean));
          const sub = email.subject || "";
          setSubject(sub.startsWith("Re:") ? sub : `Re: ${sub}`);
          initialBodyRef.current = buildQuoteHtml(email);
          setComposerKey((k) => k + 1);
        }
      } catch (e) {
        console.error(e);
        addToast("Could not load message for compose.", "error");
      } finally {
        if (!cancelled) setLoadingPrefill(false);
      }
    }
    void prefill();
    return () => {
      cancelled = true;
    };
    // loadSourceEmail is stable (useCallback). addToast must stay referentially stable (UIProvider)
    // or this effect will re-run and reset the compose editor (composerKey / empty initial body).
  }, [
    draftParam,
    replyToParam,
    replyAllParam,
    forwardParam,
    loadSourceEmail,
    addToast,
    currentUser.id,
  ]);

  const primaryToId = toIds[0] || "";

  const buildPayloadContent = () => {
    const body = editorRef.current?.getHtml() || "";
    const attachmentMeta: StoredAttachmentMeta[] = attachments.map(
      ({ name, size, type }) => ({
        name,
        size,
        type,
      }),
    );
    return buildStoredContent(body || "<p></p>", {
      cc: ccIds,
      bcc: bccIds,
      attachments: attachmentMeta,
    });
  };

  const handleSend = async () => {
    if (isLockedInbox) {
      addToast("This inbox is read-only because your workspace is over its plan limit.", "warning");
      return;
    }
    if (demoMailbox) {
      addToast(
        "Sample data: send is disabled. Pick a non-demo project to use the API.",
        "info",
      );
      return;
    }
    if (!primaryToId) {
      addToast("Add at least one recipient in To.", "warning");
      return;
    }
    if (!subject.trim()) {
      addToast("Subject is required.", "warning");
      return;
    }
    setBusy(true);
    try {
      const primaryRecipient = primaryToId.trim().toLowerCase();
      const recipientUser = users.find(
        (u) =>
          u.id === primaryRecipient ||
          u.email.toLowerCase() === primaryRecipient,
      );
      const recipientEmail = isLikelyEmail(primaryRecipient)
        ? primaryRecipient
        : recipientUser?.email?.toLowerCase();
      if (!recipientEmail) {
        addToast("Please provide a valid recipient email.", "warning");
        setBusy(false);
        return;
      }

      const payload = {
        workspace_id: null,
        recipient_id: recipientUser?.id,
        recipient_email: recipientEmail,
        subject: subject.trim(),
        content: buildPayloadContent(),
        is_draft: false,
        is_read: false,
      };
      let response: EmailMessage;
      if (effectiveDraftId) {
        response = (await api.email.update(effectiveDraftId, {
          ...payload,
          is_draft: false,
        })) as EmailMessage;
      } else {
        response = (await api.email.send(payload)) as EmailMessage;
      }
      if (response.delivery_error) {
        addToast(
          `Saved to mailbox, but external delivery failed: ${response.delivery_error}`,
          "warning",
        );
      } else {
        addToast("Email sent.", "success");
      }
      router.push("/email");
      router.refresh();
    } catch (e) {
      console.error(e);
      addToast("Failed to send email.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  useEffect(() => {
    const onAssistantSend = () => {
      void handleSendRef.current();
    };
    window.addEventListener("assistant:send-email", onAssistantSend);
    return () =>
      window.removeEventListener("assistant:send-email", onAssistantSend);
  }, []);

  const handleSaveDraft = async () => {
    if (isLockedInbox) {
      addToast("This inbox is read-only because your workspace is over its plan limit.", "warning");
      setMoreOpen(false);
      return;
    }
    if (demoMailbox) {
      addToast(
        "Sample data: saving drafts is disabled for static mailboxes.",
        "info",
      );
      return;
    }
    setBusy(true);
    try {
      const recipientFallback = primaryToId || currentUser.id;
      const payload = {
        workspace_id: null,
        recipient_id: recipientFallback,
        subject: subject.trim() || "(no subject)",
        content: buildPayloadContent(),
        is_draft: true,
        is_read: true,
      };
      if (effectiveDraftId) {
        await api.email.update(effectiveDraftId, payload);
        setLastSavedAt(new Date());
        addToast("Draft saved.", "success");
      } else {
        const created = (await api.email.send(payload)) as EmailMessage;
        setSavedDraftId(created.id);
        setLastSavedAt(new Date());
        router.replace(`/email/compose?draft=${created.id}`);
        addToast("Draft saved.", "success");
      }
    } catch (e) {
      console.error(e);
      addToast("Could not save draft.", "error");
    } finally {
      setBusy(false);
      setMoreOpen(false);
    }
  };

  const handleDiscardNavigation = () => {
    router.push("/email");
  };

  const handleTrash = async () => {
    if (isLockedInbox && effectiveDraftId) return;
    if (!effectiveDraftId) {
      handleDiscardNavigation();
      return;
    }
    if (demoMailbox) {
      addToast("Sample mailbox: draft removed locally.", "info");
      router.push("/email");
      return;
    }
    setBusy(true);
    try {
      await api.email.delete(effectiveDraftId);
      addToast("Draft deleted.", "success");
      router.push("/email");
      router.refresh();
    } catch (e) {
      console.error(e);
      addToast("Could not delete draft.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLockedInbox) return;
    const files = e.target.files;
    if (!files?.length) return;
    const next: LocalAttachment[] = Array.from(files).map((file, idx) => ({
      localId: `f-${Date.now()}-${idx}-${file.name}`,
      name: file.name,
      size: formatFileSize(file.size),
      type: file.type || "application/octet-stream",
    }));
    setAttachments((prev) => [...prev, ...next]);
    addToast(
      `${next.length} file(s) attached (metadata stored with draft).`,
      "info",
    );
    e.target.value = "";
  };

  const removeAttachment = (localId: string) => {
    if (isLockedInbox) return;
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
  };

  const attachmentIsPdf = (name: string) => /\.pdf$/i.test(name);

  const savedLabel = formatSavedAgo(lastSavedAt);

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full min-w-0 bg-background-dark">
      <div className="flex-1 min-h-0 flex flex-col w-full min-w-0 px-4 sm:px-6 lg:px-8 py-5 gap-5">
        <header className="shrink-0 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/email"
              className="inline-flex items-center gap-2 rounded-xl border border-border-dark/80 bg-surface-dark/50 px-3 py-2 text-sm font-semibold text-text-secondary hover:text-main hover:bg-white/6 transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">
                arrow_back
              </span>
              <span className="hidden sm:inline">Inbox</span>
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-main tracking-tight truncate">
                Compose
              </h1>
              <p className="text-xs text-text-secondary mt-0.5">
                Write with formatting, attachments, and optional AI polish
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowAiPanel((v) => !v)}
              className="cursor-pointer lg:hidden inline-flex items-center gap-1.5 rounded-xl border border-border-dark/70 bg-surface-dark/50 px-3 py-2 text-sm font-semibold text-text-secondary hover:text-main hover:bg-white/6 transition-colors"
              title={showAiPanel ? "Hide AI assistant" : "Show AI assistant"}
            >
              <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
              <span className="hidden xs:inline">AI</span>
            </button>
            <button
              type="button"
              disabled={isLockedInbox || busy || loadingPrefill}
              onClick={() => void handleSaveDraft()}
              className="shrink-0 rounded-xl border border-border-dark bg-surface-dark/60 px-4 py-2 text-sm font-semibold text-main hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-dark/60 transition-colors"
            >
              Save draft
            </button>
          </div>
        </header>
        {isLockedInbox && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-200">
            This inbox is read-only because your workspace is over its plan limit. Upgrade to compose or edit messages.
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-stretch">
          <div className="flex flex-col min-h-0 rounded-2xl border border-border-dark/80 bg-surface-dark/20 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.55)] overflow-hidden">
            {loadingPrefill ? (
              <div className="py-24 flex justify-center shrink-0">
                <div className="size-8 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col">
                  <div className="shrink-0">
                    <div className="flex gap-3 px-5 py-3 border-b border-border-dark/90 bg-background-dark/15">
                      <span className="text-[13px] font-bold text-text-secondary w-10 shrink-0 pt-2">
                        To
                      </span>
                      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                        {chipsForIds(toIds).map((c) => (
                          <RecipientChip
                            key={c.id}
                            label={c.label}
                            initials={c.initials}
                            avatarUrl={c.avatarUrl}
                            onRemove={() =>
                              !isLockedInbox && setToIds((prev) => prev.filter((x) => x !== c.id))
                            }
                            disabled={isLockedInbox}
                          />
                        ))}
                        <input
                          list="compose-user-options-to-main"
                          value={toDraft}
                          disabled={isLockedInbox}
                          onChange={(e) => setToDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              resolveCommit(toDraft, setToDraft, setToIds);
                            }
                          }}
                          onBlur={() => {
                            if (toDraft.trim())
                              resolveCommit(toDraft, setToDraft, setToIds);
                          }}
                          placeholder="Add recipients…"
                          className="flex-1 min-w-[140px] max-w-[min(260px,100%)] bg-transparent border-0 py-2 text-sm text-main focus:ring-0 placeholder:text-text-secondary/55 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <datalist id="compose-user-options-to-main">
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} — {u.email}
                            </option>
                          ))}
                        </datalist>
                        <span className="ml-auto shrink-0 flex items-center gap-3 text-[12px] font-bold uppercase tracking-wide text-primary/90 pt-2">
                          <button
                            type="button"
                            disabled={isLockedInbox}
                            className={`hover:text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-primary/90 ${showCcSection ? "text-primary underline-offset-4" : ""}`}
                            onClick={() => { if (!isLockedInbox) setShowCcSection((x) => !x); }}
                          >
                            Cc
                          </button>
                          <button
                            type="button"
                            disabled={isLockedInbox}
                            className={`hover:text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-primary/90 ${showBccSection ? "text-primary underline-offset-4" : ""}`}
                            onClick={() => { if (!isLockedInbox) setShowBccSection((x) => !x); }}
                          >
                            Bcc
                          </button>
                        </span>
                      </div>
                    </div>

                    {showCcSection ? (
                      <RecipientRow
                        idPrefix="cc"
                        label="Cc"
                        chips={chipsForIds(ccIds)}
                        onRemove={(id) =>
                          setCcIds((p) => p.filter((x) => x !== id))
                        }
                        draft={ccDraft}
                        setDraft={setCcDraft}
                        onCommitDraft={() =>
                          resolveCommit(ccDraft, setCcDraft, setCcIds)
                        }
                        users={users}
                        disabled={isLockedInbox}
                      />
                    ) : null}

                    {showBccSection ? (
                      <RecipientRow
                        idPrefix="bcc"
                        label="Bcc"
                        chips={chipsForIds(bccIds)}
                        onRemove={(id) =>
                          setBccIds((p) => p.filter((x) => x !== id))
                        }
                        draft={bccDraft}
                        setDraft={setBccDraft}
                        onCommitDraft={() =>
                          resolveCommit(bccDraft, setBccDraft, setBccIds)
                        }
                        users={users}
                        disabled={isLockedInbox}
                      />
                    ) : null}

                    <div className="flex gap-3 px-5 py-3 border-b border-border-dark/90 bg-background-dark/15 items-center">
                      <span className="text-[13px] font-bold text-text-secondary w-14 sm:w-16 shrink-0 whitespace-nowrap">
                        Subject
                      </span>
                      <div className="flex-1 min-w-0 flex items-center rounded-xl border border-border-dark/70 bg-surface-dark/35 px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors focus-within:border-primary/50 focus-within:bg-surface-dark/50 focus-within:ring-2 focus-within:ring-primary/15">
                        <input
                          value={subject}
                          disabled={isLockedInbox}
                          onChange={(e) => setSubject(e.target.value)}
                          placeholder="Subject"
                          aria-label="Subject"
                          className="w-full min-w-0 bg-transparent border-0 py-1.5 text-sm font-semibold text-main leading-snug placeholder:text-text-secondary/45 placeholder:font-medium focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>
                    </div>
                  </div>

                  <EmailRichEditor
                    ref={editorRef}
                    resetKey={composerKey}
                    initialHtml={initialBodyRef.current}
                    placeholder="Write your message…"
                    embedded
                    disabled={isLockedInbox}
                  />

                  {attachments.length > 0 ? (
                    <div className="shrink-0 px-5 py-4 space-y-3 border-t border-border-dark/80 bg-background-dark/15">
                      {attachments.map((file) => (
                        <div
                          key={file.localId}
                          className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border-dark bg-surface-highlight/55"
                        >
                          {attachmentIsPdf(file.name) ? (
                            <span className="material-symbols-outlined text-[34px] text-red-400 shrink-0">
                              picture_as_pdf
                            </span>
                          ) : (
                            <span className="material-symbols-outlined text-[34px] text-text-secondary shrink-0">
                              draft
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-main truncate">
                              {file.name}
                            </p>
                            <p className="text-xs text-text-secondary mt-0.5">
                              {typeof file.size === "string"
                                ? file.size
                                : (file.size ?? "—")}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={isLockedInbox}
                            onClick={() => removeAttachment(file.localId)}
                            className="shrink-0 p-2 rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                            aria-label="Remove attachment"
                          >
                            <span className="material-symbols-outlined text-[22px]">
                              close
                            </span>
                          </button>
                        </div>
                      ))}
                      <p className="text-[10px] text-text-secondary/70">
                        Attachments travel as metadata until file storage is
                        connected.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            <footer className="shrink-0 border-t border-border-dark/80 bg-background-dark/60 backdrop-blur-md px-4 sm:px-5 py-3.5 flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFiles}
                disabled={isLockedInbox}
              />
              <button
                type="button"
                disabled={isLockedInbox || busy || loadingPrefill}
                onClick={handleSend}
                className="inline-flex items-center gap-2 px-4 sm:px-7 py-2 sm:py-2.5 rounded-xl bg-primary text-white text-[13px] font-black uppercase tracking-wide shadow-[0_8px_24px_-8px_rgba(25,93,230,0.55)] hover:brightness-110 transition-all disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:brightness-100"
              >
                <span className="material-symbols-outlined text-[20px]">
                  send
                </span>
                Send
              </button>
              <div className="flex items-center gap-1 border-l border-border-dark pl-4">
                <button
                  type="button"
                  disabled={isLockedInbox}
                  onClick={() => { if (!isLockedInbox) fileInputRef.current?.click(); }}
                  className="p-2.5 rounded-xl text-text-secondary hover:text-main hover:bg-white/6 transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                  title="Attach files"
                >
                  <span className="material-symbols-outlined text-[22px]">
                    attach_file
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isLockedInbox}
                  onClick={() =>
                    !isLockedInbox && addToast(
                        "Drive uploads can be wired to your storage provider later.",
                        "info",
                      )
                  }
                  className="hidden sm:flex p-2.5 rounded-xl text-text-secondary hover:text-main hover:bg-white/6 transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                  title="Insert from Drive"
                >
                  <span className="material-symbols-outlined text-[22px]">
                    add_to_drive
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isLockedInbox}
                  onClick={() =>
                    !isLockedInbox && addToast(
                        "Confidential mode is not configured for this mailbox.",
                        "info",
                      )
                  }
                  className="hidden sm:flex p-2.5 rounded-xl text-text-secondary hover:text-main hover:bg-white/6 transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                  title="Confidential mode"
                >
                  <span className="material-symbols-outlined text-[22px]">
                    lock
                  </span>
                </button>
              </div>

              <div className="ml-auto flex items-center gap-2 sm:gap-3">
                {savedLabel ? (
                  <span
                    className="text-xs font-semibold text-text-secondary whitespace-nowrap hidden sm:inline"
                    data-saved-relative-tick={savedLabelTick}
                  >
                    {savedLabel}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={handleTrash}
                  disabled={isLockedInbox || busy || loadingPrefill}
                  className="p-2.5 rounded-xl text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                  title={effectiveDraftId ? "Delete draft" : "Close"}
                >
                  <span className="material-symbols-outlined text-[22px]">
                    delete
                  </span>
                </button>
                <div className="relative" ref={moreRef}>
                  <button
                    type="button"
                    onClick={() => setMoreOpen((o) => !o)}
                    className="cursor-pointer p-2.5 rounded-xl text-text-secondary hover:text-main hover:bg-white/6 transition-colors"
                    title="More"
                  >
                    <span className="material-symbols-outlined text-[22px]">
                      more_vert
                    </span>
                  </button>
                  {moreOpen ? (
                    <div className="absolute bottom-full right-0 mb-2 w-48 py-1 rounded-xl border border-border-dark bg-surface-dark shadow-xl z-20">
                      <button
                        type="button"
                        disabled={isLockedInbox || busy || loadingPrefill}
                        onClick={() => void handleSaveDraft()}
                        className="w-full text-left px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                      >
                        Save draft
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          handleDiscardNavigation();
                        }}
                        className="cursor-pointer w-full text-left px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-white/5 hover:text-main"
                      >
                        Discard
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </footer>
          </div>

          <aside className={`min-h-0 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto custom-scrollbar${showAiPanel ? "" : " hidden lg:block"}`}>
            <ComposeWritingAssistant
              demoMailbox={demoMailbox}
              readOnly={isLockedInbox}
              subject={subject}
              setSubject={setSubject}
              editorRef={editorRef}
              onBodyHtmlCommitted={(html) => {
                initialBodyRef.current = html;
              }}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function EmailComposeView() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <div className="size-8 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <ComposeContent />
    </Suspense>
  );
}
