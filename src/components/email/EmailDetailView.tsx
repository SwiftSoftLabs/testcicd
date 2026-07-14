"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { CalendarDTO } from "@/types/calendar";
import type { EmailMessage, MailAccountStatus, Project } from "@/types";
import { useAppContext } from "@/context/AppContext";
import { useAssistantPageContextBridge } from "@/context/AssistantPageContextBridge";
import { useUIContext } from "@/context/UIContext";
import {
  parseStoredEmailContent,
  StoredAttachmentMeta,
} from "@/lib/email/contentMeta";
import { parseIcsEvent } from "@/lib/email/ics-parser";
import { sanitizeEmailBodyHtml } from "@/lib/email/sanitizeEmailHtml";
import {
  bustMailboxListCache,
  fetchMailboxMessage,
  fetchMailboxList,
  isDemoMailboxProject,
} from "@/lib/email/demoMailbox";
import { readMailboxStatusCache, notifyEmailUnreadChanged } from "@/lib/email/mailboxSessionCache";
import { EmailBodyIframe } from "@/components/email/EmailBodyIframe";
import { EmailAiWorkspace } from "@/components/email/EmailAiWorkspace";
import { SnoozeMenu, type SnoozeSyncStatus } from "@/components/email/SnoozeMenu";
import { formatSnoozedUntil, isCurrentlySnoozed } from "@/lib/email/snooze";

const MAIL_FOLDERS = new Set(["inbox", "starred", "snoozed", "sent", "drafts"]);

const FOLDER_BADGE: Record<string, string> = {
  inbox: "INBOX",
  starred: "STARRED",
  snoozed: "SNOOZED",
  sent: "SENT",
  drafts: "DRAFTS",
};

function normalizeFolder(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.toLowerCase();
  return MAIL_FOLDERS.has(k) ? k : null;
}

function inferMailboxFolder(
  msg: EmailMessage,
  meId: string,
): keyof typeof FOLDER_BADGE {
  if (msg.is_draft) return "drafts";
  if (msg.sender_id === meId && !msg.is_draft) return "sent";
  return "inbox";
}

function parseSizeBytes(s?: string): number | null {
  if (!s) return null;
  const m = String(s)
    .trim()
    .match(/^([\d.]+)\s*(B|KB|MB|GB)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || "B").toUpperCase();
  const mult =
    u === "GB" ? 1024 ** 3 : u === "MB" ? 1024 ** 2 : u === "KB" ? 1024 : 1;
  return Math.round(n * mult);
}

function formatTotalAttachmentSize(meta: StoredAttachmentMeta[]): string {
  let sum = 0;
  let any = false;
  for (const a of meta) {
    const b = parseSizeBytes(typeof a.size === "string" ? a.size : undefined);
    if (b !== null) {
      sum += b;
      any = true;
    }
  }
  if (!any) return "";
  const mb = sum / 1024 ** 2;
  if (mb >= 0.05) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const kb = sum / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

function attachmentGlyph(type?: string, filename?: string): string {
  const j = `${type || ""} ${filename || ""}`.toLowerCase();
  if (j.includes("pdf")) return "picture_as_pdf";
  if (j.includes("image") || /\.(png|jpg|jpeg|gif|webp|svg)\b/.test(j))
    return "image";
  if (j.includes("word") || /\.docx?\b/.test(j)) return "draft";
  if (j.includes("sheet") || /\.xlsx?\b/.test(j)) return "table_chart";
  return "draft";
}

function formatHeaderTs(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sod = (t: Date) =>
    new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();

  let dayLead: string;
  if (sod(d) === sod(now)) dayLead = "Today";
  else if (sod(d) === sod(now) - 86400000) dayLead = "Yesterday";
  else
    dayLead = d.toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
    });

  const timePart = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const diffSec = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  let rel: string;
  if (diffSec < 120) rel = "just now";
  else if (diffSec < 3600) rel = `${Math.floor(diffSec / 60)} minutes ago`;
  else if (diffSec < 86400)
    rel = `${Math.floor(diffSec / 3600)} hour${diffSec >= 7200 ? "s" : ""} ago`;
  else if (diffSec < 86400 * 14)
    rel = `${Math.floor(diffSec / 86400)} days ago`;
  else rel = "";

  return rel ? `${dayLead}, ${timePart} (${rel})` : `${dayLead}, ${timePart}`;
}

function getNextRoundedHour(date = new Date()): Date {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  if (next.getTime() <= date.getTime()) {
    next.setHours(next.getHours() + 1);
  }
  return next;
}

function findIcsAttachment(
  items: StoredAttachmentMeta[],
): StoredAttachmentMeta | null {
  return (
    items.find(
      (item) =>
        /\.ics$/i.test(item.name || "") ||
        (item.type || "").toLowerCase().includes("calendar"),
    ) ?? null
  );
}

function ToolbarIconBtn({
  title,
  icon,
  onClick,
  disabled,
  destructive,
}: {
  title: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-2.5 rounded-xl transition-colors disabled:opacity-35 disabled:pointer-events-none ${
        destructive
          ? "text-red-400/90 hover:bg-red-500/10 hover:text-red-400"
          : "text-text-secondary hover:text-main hover:bg-white/[0.06]"
      } cursor-pointer`}
    >
      <span className="material-symbols-outlined text-[22px]">{icon}</span>
    </button>
  );
}

function DetailAttachmentCards({
  items,
  onPromptDownload,
}: {
  items: StoredAttachmentMeta[];
  onPromptDownload: (filename: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {items.map((item, i) => {
        const isPdf =
          /\.pdf$/i.test(item.name || "") ||
          (item.type || "").toLowerCase().includes("pdf");
        const isImg =
          (item.type || "").toLowerCase().includes("image") ||
          /\.(png|jpg|jpeg|gif|webp)$/i.test(item.name || "");
        const g = attachmentGlyph(item.type, item.name);
        return (
          <div
            key={`${item.name}-${i}`}
            className="rounded-xl border border-border-dark bg-surface-highlight/50 overflow-hidden flex min-h-[120px]"
          >
            <div className="w-[132px] shrink-0 bg-background-dark/50 flex flex-col items-center justify-center gap-2 border-r border-border-dark py-6">
              {isPdf ? (
                <span className="material-symbols-outlined text-[48px] text-red-500">
                  picture_as_pdf
                </span>
              ) : isImg ? (
                <div className="size-[72px] rounded-lg bg-gradient-to-br from-slate-600/40 to-primary/35 border border-border-dark flex items-center justify-center overflow-hidden relative">
                  <span className="material-symbols-outlined text-[40px] text-white/85">
                    image
                  </span>
                </div>
              ) : (
                <span className="material-symbols-outlined text-[48px] text-primary">
                  {g}
                </span>
              )}
              {item.size ? (
                <span className="text-[10px] font-bold text-text-secondary tabular-nums">
                  {item.size}
                </span>
              ) : null}
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center px-4 py-4">
              <p
                className="text-sm font-bold text-main truncate"
                title={item.name}
              >
                {item.name || "attachment"}
              </p>
              {item.type ? (
                <p className="text-[10px] text-text-secondary/80 uppercase truncate mt-1">
                  {(item.type || "").split("/").pop()}
                </p>
              ) : null}
              <button
                type="button"
                title="Download (preview only until storage is wired)"
                onClick={() => onPromptDownload(item.name || "attachment")}
                className="cursor-pointer mt-auto pt-4 text-left text-xs font-bold text-primary hover:underline w-fit"
              >
                Download
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmailDetailInner({ emailId }: { emailId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderFromQuery = normalizeFolder(searchParams.get("folder"));

  const {
    selectedProjectId,
    selectedWorkspaceId,
    currentUser,
    users,
    fetchNativeEvents,
  } = useAppContext();
  const { addToast, openModal } = useUIContext();
  const { setEmailMessageId } = useAssistantPageContextBridge();

  const [email, setEmail] = useState<EmailMessage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [folderEmails, setFolderEmails] = useState<EmailMessage[]>([]);
  const [eventCalendars, setEventCalendars] = useState<CalendarDTO[]>([]);
  const [eventProjects, setEventProjects] = useState<Project[]>([]);
  const [eventDataWorkspaceId, setEventDataWorkspaceId] = useState<
    string | null
  >(null);
  const [isPreparingEventModal, setIsPreparingEventModal] = useState(false);
  const [isLockedInbox, setIsLockedInbox] = useState(
    readMailboxStatusCache()?.account?.quota_locked === true,
  );

  const [recipientsExpanded, setRecipientsExpanded] = useState(false);
  const [moreToolbarOpen, setMoreToolbarOpen] = useState(false);
  const [snoozeSync, setSnoozeSync] = useState<SnoozeSyncStatus | null>(null);
  const moreToolbarRef = useRef<HTMLDivElement>(null);
  const demoMailbox = !!(
    selectedProjectId && isDemoMailboxProject(selectedProjectId)
  );

  useEffect(() => {
    setEmailMessageId(emailId);
    return () => setEmailMessageId(null);
  }, [emailId, setEmailMessageId]);

  const load = useCallback(async () => {
    if (!emailId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const row = await fetchMailboxMessage(emailId);
      if (!row) {
        setLoadError("Unable to load this message.");
        setEmail(null);
        return;
      }
      setEmail(row);
      const messageFolder = inferMailboxFolder(row, currentUser.id);
      if (
        !demoMailbox &&
        !row.is_draft &&
        messageFolder === "inbox" &&
        !row.is_read
      ) {
        const readRow = { ...row, is_read: true };
        setEmail(readRow);
        try {
          await api.email.update(emailId, { is_read: true });
          bustMailboxListCache("inbox");
          notifyEmailUnreadChanged();
        } catch {
          setEmail(row);
        }
      }
    } catch {
      setLoadError("Unable to load this message.");
      setEmail(null);
    } finally {
      setLoading(false);
    }
  }, [demoMailbox, emailId, currentUser.id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const listFolder =
    folderFromQuery ??
    (email ? inferMailboxFolder(email, currentUser.id) : "inbox");

  useEffect(() => {
    let cancelled = false;
    fetchMailboxList(listFolder)
      .then((rows) => {
        if (!cancelled) setFolderEmails(rows);
      })
      .catch(() => {
        if (!cancelled) setFolderEmails([]);
      });
    return () => {
      cancelled = true;
    };
  }, [listFolder]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!moreToolbarRef.current?.contains(e.target as Node))
        setMoreToolbarOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const parsed = useMemo(
    () => parseStoredEmailContent(email?.content || ""),
    [email?.content],
  );
  const { bodyHtml, meta } = parsed;
  const sanitizedBodyHtml = useMemo(
    () => sanitizeEmailBodyHtml(bodyHtml || ""),
    [bodyHtml],
  );

  const resolveName = useCallback(
    (id: string) => {
      if (id === currentUser.id) return "Me";
      const recipientMatch =
        email?.recipient_id === id ? email.recipient?.full_name : undefined;
      if (recipientMatch) return recipientMatch;
      const senderMatch =
        email?.sender_id === id ? email.sender?.full_name : undefined;
      if (senderMatch) return senderMatch;
      return users.find((u) => u.id === id)?.name || `${id.slice(0, 6)}…`;
    },
    [currentUser.id, users, email],
  );

  const senderEmailDisp = useMemo(() => {
    if (!email) return "";
    return (
      users.find((u) => u.id === email.sender_id)?.email || email.sender_id
    );
  }, [email, users]);

  const toSummary = useMemo(() => {
    if (!email) return "";
    const main = resolveName(email.recipient_id);
    const extras = [...meta.cc]
      .filter((id) => id && id !== email.recipient_id)
      .map((id) => resolveName(id));
    const uniqExtra = [...new Set(extras)].filter(Boolean);
    if (uniqExtra.length === 0) return main;
    return `${main}, ${uniqExtra.join(", ")}`;
  }, [email, meta.cc, resolveName]);

  const idx = folderEmails.findIndex((e) => e.id === email?.id);
  const totalNav = folderEmails.length;
  const posLabel = idx >= 0 && totalNav ? `${idx + 1}` : "—";
  const navTotalLabel = totalNav || "—";
  const prevId = idx > 0 ? folderEmails[idx - 1]?.id : null;
  const nextId =
    idx >= 0 && idx < folderEmails.length - 1
      ? folderEmails[idx + 1]?.id
      : null;

  const folderBadgeKey =
    folderFromQuery ??
    (email ? inferMailboxFolder(email, currentUser.id) : "inbox");
  const folderBadgeLabel = email?.is_draft
    ? "DRAFT"
    : FOLDER_BADGE[folderBadgeKey] || "INBOX";

  const qsFolder = folderFromQuery ?? listFolder;

  const navHref = (id: string) =>
    `/email/${id}?folder=${encodeURIComponent(qsFolder)}`;
  const backHref =
    qsFolder !== "inbox"
      ? `/email?folder=${encodeURIComponent(qsFolder)}`
      : "/email";

  const editDraftHref = email?.is_draft
    ? `/email/compose?draft=${email.id}`
    : null;
  const eventWorkspaceId = selectedWorkspaceId ?? email?.workspace_id ?? null;

  const handleDelete = async () => {
    if (isLockedInbox) return;
    if (!email) return;
    const msg = email?.is_draft
      ? "Delete this draft permanently?"
      : "Delete this message permanently?";
    if (!confirm(msg)) return;
    try {
      if (demoMailbox) {
        addToast("Sample data: delete is simulated.", "info");
        router.push(backHref);
        return;
      }
      await api.email.delete(emailId);
      bustMailboxListCache();
      addToast("Message deleted.", "success");
      router.push(backHref);
      router.refresh();
    } catch (e) {
      console.error(e);
      addToast("Failed to delete message.", "error");
    }
  };

  const archiveMessage = async () => {
    if (isLockedInbox) return;
    if (!email || demoMailbox) {
      addToast(
        demoMailbox
          ? "Sample mailbox: archive is simulated."
          : "Unable to archive.",
        "info",
      );
      router.push(backHref);
      return;
    }
    try {
      await api.email.update(emailId, { is_archived: true });
      bustMailboxListCache();
      addToast("Archived.", "success");
      router.push(backHref);
      router.refresh();
    } catch (e) {
      console.error(e);
      addToast("Could not archive.", "error");
    }
  };

  const toggleRead = async () => {
    if (!email) return;
    if (isLockedInbox) return;
    if (demoMailbox) {
      addToast("Sample data: read state is disabled.", "info");
      return;
    }
    if (inferMailboxFolder(email, currentUser.id) !== "inbox") return;

    const next = !email.is_read;
    setEmail({ ...email, is_read: next });
    try {
      await api.email.update(emailId, { is_read: next });
      bustMailboxListCache("inbox");
      notifyEmailUnreadChanged();
    } catch (e) {
      console.error(e);
      setEmail({ ...email, is_read: !next });
      addToast("Could not update read state.", "error");
    }
  };

  const toggleStar = async () => {
    if (!email) return;
    if (isLockedInbox) return;
    if (demoMailbox) {
      addToast("Sample data: starring is disabled.", "info");
      return;
    }
    const next = !email.is_starred;
    setEmail({ ...email, is_starred: next });
    try {
      await api.email.update(emailId, { is_starred: next });
      bustMailboxListCache("inbox");
      bustMailboxListCache("starred");
    } catch (e) {
      console.error(e);
      setEmail({ ...email, is_starred: !next });
    }
  };

  const handleSnooze = async (until: string | null) => {
    if (!email) return;
    if (isLockedInbox) return;
    if (demoMailbox) {
      addToast("Sample data: snooze is disabled.", "info");
      return;
    }

    const previous = email.snoozed_until ?? null;
    setEmail({ ...email, snoozed_until: until });
    setSnoozeSync("syncing");

    try {
      await api.email.update(emailId, { snoozed_until: until });
      bustMailboxListCache("inbox");
      bustMailboxListCache("snoozed");
      setSnoozeSync("saved");
      window.setTimeout(() => setSnoozeSync(null), 1200);
    } catch (e) {
      console.error(e);
      setEmail({ ...email, snoozed_until: previous });
      setSnoozeSync("error");
      addToast("Could not update snooze.", "error");
      window.setTimeout(() => setSnoozeSync(null), 2500);
    }
  };

  const showSnoozeControl = qsFolder === "inbox" || qsFolder === "snoozed";
  const snoozedActive = email ? isCurrentlySnoozed(email) : false;

  const retryDelivery = async () => {
    if (!email) return;
    if (isLockedInbox) return;
    try {
      const updated = (await api.email.update(email.id, {
        retry_delivery: true,
      })) as EmailMessage;
      setEmail(updated);
      if (updated.delivery_error) {
        addToast(`Retry failed: ${updated.delivery_error}`, "warning");
      } else {
        addToast("External delivery retried successfully.", "success");
      }
    } catch (e) {
      console.error(e);
      addToast("Could not retry external delivery.", "error");
    }
  };

  const totalAttachStr = meta.attachments.length
    ? formatTotalAttachmentSize(meta.attachments)
    : "";

  const openPrintable = () => {
    window.print();
  };

  const openStandalone = () => {
    window.open(
      `${window.location.origin}/email/${emailId}?folder=${encodeURIComponent(qsFolder)}`,
      "_blank",
    );
  };

  const openCreateEventModal = useCallback(async () => {
    if (!email) return;
    if (isLockedInbox) {
      addToast("This inbox is read-only because your workspace is over its plan limit.", "warning");
      return;
    }

    setIsPreparingEventModal(true);
    let calendarsForModal = eventCalendars;
    let projectsForModal = eventProjects;

    try {
      if (eventWorkspaceId && eventDataWorkspaceId !== eventWorkspaceId) {
        const [calendarResponse, projectsResponse] = await Promise.all([
          api.calendars.getAll(eventWorkspaceId),
          api.projects.getAll(eventWorkspaceId),
        ]);
        calendarsForModal = calendarResponse.calendars;
        projectsForModal = projectsResponse;
        setEventCalendars(calendarsForModal);
        setEventProjects(projectsForModal);
        setEventDataWorkspaceId(eventWorkspaceId);
      }
    } catch (error) {
      console.error(error);
      addToast(
        "Could not load workspace calendar data. Creating a personal email event instead.",
        "warning",
      );
      calendarsForModal = [];
      projectsForModal = [];
    } finally {
      setIsPreparingEventModal(false);
    }

    const initialStart = getNextRoundedHour();
    const initialEnd = new Date(initialStart);
    initialEnd.setHours(initialEnd.getHours() + 1);
    const icsAttachment = findIcsAttachment(meta.attachments);
    const icsEvent = icsAttachment?.icsContent
      ? parseIcsEvent(icsAttachment.icsContent)
      : null;

    openModal("calendar-event", {
      calendars: calendarsForModal,
      projects: projectsForModal,
      workspaceId: eventWorkspaceId,
      mailMessageId: email.id,
      emailPreview: {
        subject: email.subject || "Email event",
        from: email.sender?.full_name
          ? `${email.sender.full_name} <${senderEmailDisp}>`
          : senderEmailDisp,
        date: formatHeaderTs(email.created_at),
      },
      initialTitle: icsEvent?.title || email.subject || "Email event",
      initialStart: icsEvent?.startTime || initialStart.toISOString(),
      initialEnd: icsEvent?.endTime || initialEnd.toISOString(),
      initialDescription: icsEvent?.description ?? null,
      initialLocation: icsEvent?.location ?? null,
      initialTimezone: icsEvent?.timezone ?? null,
      initialIsAllDay: icsEvent?.isAllDay ?? false,
      onSaved: fetchNativeEvents,
      ariaLabel: "Create event from email",
    });
  }, [
    addToast,
    email,
    eventCalendars,
    eventDataWorkspaceId,
    eventProjects,
    eventWorkspaceId,
    fetchNativeEvents,
    meta.attachments,
    openModal,
    isLockedInbox,
  ]);

  const downloadAll = () => {
    addToast(
      meta.attachments.length
        ? "Files are preview-only until storage-backed downloads are wired."
        : "No attachments.",
      meta.attachments.length ? "info" : "warning",
    );
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-28">
        <div className="size-10 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError || !email) {
    return (
      <div className="flex-1 p-10 text-center max-w-md mx-auto">
        <p className="text-main font-bold">
          {loadError || "Message not found"}
        </p>
        <Link
          href="/email"
          className="inline-block mt-6 text-primary font-bold hover:underline"
        >
          Back to Inbox
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full min-w-0 bg-background-dark">
      <div className="shrink-0 border-b border-border-dark bg-background-dark/80 px-3 sm:px-6 py-2 flex flex-wrap items-center gap-1 gap-y-2">
        <ToolbarIconBtn
          title="Back"
          icon="arrow_back"
          onClick={() => router.push(backHref)}
            />
        <span className="hidden sm:contents">
          <ToolbarIconBtn
            title="Archive"
            icon="archive"
            disabled={isLockedInbox}
            onClick={() => void archiveMessage()}
            />
          <ToolbarIconBtn
            title={email?.is_read ? "Mark as unread" : "Mark as read"}
            icon={email?.is_read ? "mark_email_unread" : "mark_email_read"}
            disabled={
              isLockedInbox ||
              !email ||
              inferMailboxFolder(email, currentUser.id) !== "inbox"
            }
            onClick={() => void toggleRead()}
          />
          <ToolbarIconBtn
            title="Create event"
            icon="event"
            disabled={isLockedInbox || isPreparingEventModal}
            onClick={() => void openCreateEventModal()}
            />
          <ToolbarIconBtn
            title="Report spam"
            icon="report"
            onClick={() =>
              addToast("Spam reporting is not connected yet.", "info")
            }
            />
        </span>
        <ToolbarIconBtn
          title="Delete"
          icon="delete"
          destructive
          disabled={isLockedInbox}
          onClick={() => void handleDelete()}
            />
        <span className="hidden sm:contents">
          <div className="w-px h-7 bg-border-dark/90 mx-1 shrink-0" />
          <ToolbarIconBtn
            title="Move to folder"
            icon="drive_file_move"
            disabled={isLockedInbox}
            onClick={() => addToast("Move to folder coming soon.", "info")}
            />
          <ToolbarIconBtn
            title="Label"
            icon="label"
            disabled={isLockedInbox}
            onClick={() => addToast("Labels coming soon.", "info")}
            />
        </span>
        <div className="relative" ref={moreToolbarRef}>
          <ToolbarIconBtn
            title="More"
            icon="more_vert"
            onClick={() => setMoreToolbarOpen((o) => !o)}
            />
          {moreToolbarOpen ? (
            <div
              className="absolute left-0 top-full mt-1 z-30 py-1 w-56 rounded-xl border border-border-dark bg-surface-dark shadow-xl"
              role="menu"
            >
              {/* Mobile-only: actions hidden from toolbar on small screens */}
              <div className="sm:hidden border-b border-border-dark/60 pb-1 mb-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { void archiveMessage(); setMoreToolbarOpen(false); }}
                  className="cursor-pointer flex items-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05]"
                >
                  <span className="material-symbols-outlined text-[20px]">archive</span>
                  Archive
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isPreparingEventModal}
                  onClick={() => { void openCreateEventModal(); setMoreToolbarOpen(false); }}
                  className="cursor-pointer flex items-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05] disabled:opacity-35"
                >
                  <span className="material-symbols-outlined text-[20px]">event</span>
                  Create event
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { addToast("Spam reporting is not connected yet.", "info"); setMoreToolbarOpen(false); }}
                  className="cursor-pointer flex items-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05]"
                >
                  <span className="material-symbols-outlined text-[20px]">report</span>
                  Report spam
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { addToast("Move to folder coming soon.", "info"); setMoreToolbarOpen(false); }}
                  className="cursor-pointer flex items-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05]"
                >
                  <span className="material-symbols-outlined text-[20px]">drive_file_move</span>
                  Move to folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { addToast("Labels coming soon.", "info"); setMoreToolbarOpen(false); }}
                  className="cursor-pointer flex items-center gap-2 w-full px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05]"
                >
                  <span className="material-symbols-outlined text-[20px]">label</span>
                  Label
                </button>
              </div>
              <Link
                href={isLockedInbox ? "#" : `/email/compose?replyTo=${email.id}`}
                aria-disabled={isLockedInbox}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05] ${isLockedInbox ? "pointer-events-none cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
                onClick={() => { if (!isLockedInbox) setMoreToolbarOpen(false); }}
              >
                <span className="material-symbols-outlined text-[20px]">
                  reply
                </span>
                Reply
              </Link>
              <Link
                href={isLockedInbox ? "#" : `/email/compose?replyAll=${email.id}`}
                aria-disabled={isLockedInbox}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05] ${isLockedInbox ? "pointer-events-none cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
                onClick={() => { if (!isLockedInbox) setMoreToolbarOpen(false); }}
              >
                <span className="material-symbols-outlined text-[20px]">
                  reply_all
                </span>
                Reply all
              </Link>
              <Link
                href={isLockedInbox ? "#" : `/email/compose?forward=${email.id}`}
                aria-disabled={isLockedInbox}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-main hover:bg-white/[0.05] ${isLockedInbox ? "pointer-events-none cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
                onClick={() => { if (!isLockedInbox) setMoreToolbarOpen(false); }}
              >
                <span className="material-symbols-outlined text-[20px]">
                  forward
                </span>
                Forward
              </Link>
              {editDraftHref ? (
                <Link
                  href={isLockedInbox ? "#" : editDraftHref}
                  aria-disabled={isLockedInbox}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 border-t border-border-dark ${isLockedInbox ? "pointer-events-none cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
                  onClick={() => { if (!isLockedInbox) setMoreToolbarOpen(false); }}
                >
                  <span className="material-symbols-outlined text-[20px]">
                    edit_square
                  </span>
                  Continue draft
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex-1 min-w-[8px]" />

        <div className="flex items-center gap-1 text-[13px] font-semibold text-text-secondary tabular-nums ml-auto border-l border-transparent sm:border-border-dark sm:pl-4">
          <span className="hidden sm:inline text-main/90">{posLabel}</span>
          <span className="hidden sm:inline opacity-60">of</span>
          <span className="hidden sm:inline text-main/90">{navTotalLabel}</span>
          <button
            type="button"
            title="Older"
            disabled={!prevId}
            onClick={() => prevId && router.push(navHref(prevId))}
            className="cursor-pointer p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined text-[22px]">
              chevron_left
            </span>
          </button>
          <button
            type="button"
            title="Newer"
            disabled={!nextId}
            onClick={() => nextId && router.push(navHref(nextId))}
            className="cursor-pointer p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none"
          >
            <span className="material-symbols-outlined text-[22px]">
              chevron_right
            </span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="w-full max-w-none min-w-0 px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          {isLockedInbox && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-200">
              This inbox is read-only because your workspace is over its plan limit. Upgrade to restore editing.
            </div>
          )}
          <div className="flex flex-wrap items-start justify-between gap-4 gap-y-6">
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-3 gap-y-2">
                <h1 className="text-xl sm:text-2xl md:text-[1.65rem] font-black text-main tracking-tight wrap-break-word">
                  {email.subject || "(no subject)"}
                </h1>
                <span className="shrink-0 px-2.5 py-1 rounded-md bg-primary/14 text-[10px] font-black tracking-widest text-primary border border-primary/25">
                  {folderBadgeLabel}
                </span>
                {snoozedActive && email.snoozed_until ? (
                  <span className="shrink-0 px-2.5 py-1 rounded-md bg-white/[0.04] text-[10px] font-black tracking-widest text-text-secondary border border-border-dark">
                    SNOOZE · {formatSnoozedUntil(email.snoozed_until).toUpperCase()}
                  </span>
                ) : null}
                {editDraftHref ? (
                  <Link
                    href={editDraftHref}
                    className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-wide text-primary hover:underline"
                  >
                    Continue editing
                    <span className="material-symbols-outlined text-[16px]">
                      arrow_forward
                    </span>
                  </Link>
                ) : null}
              </div>
              {meta.delivery ? (
                <div
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${
                    meta.delivery.status === "failed"
                      ? "border-red-500/30 bg-red-500/10 text-red-300"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {meta.delivery.status === "failed"
                      ? "error"
                      : "check_circle"}
                  </span>
                  <span>
                    {meta.delivery.status === "failed"
                      ? `External delivery failed${meta.delivery.error ? `: ${meta.delivery.error}` : ""}`
                      : "Externally delivered"}
                  </span>
                  {meta.delivery.status === "failed" &&
                  email.sender_id === currentUser.id ? (
                    <button
                      type="button"
                      onClick={() => void retryDelivery()}
                      className="cursor-pointer ml-1 rounded-md bg-red-500/20 hover:bg-red-500/30 px-2 py-1 text-[10px] uppercase tracking-wide"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ToolbarIconBtn
                title="Print"
                icon="print"
                onClick={openPrintable}
            />
              <ToolbarIconBtn
                title="Open in new window"
                icon="open_in_new"
                onClick={openStandalone}
            />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-start border-b border-border-dark/85 pb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                email.sender?.avatar_url ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(email.sender?.full_name || "?")}&background=334155&color=e2e8f0`
              }
              alt=""
              className="size-14 sm:size-16 rounded-full border border-border-dark object-cover bg-surface-highlight shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-main">
                {email.sender?.full_name || "Unknown sender"}{" "}
                <span className="font-semibold text-text-secondary text-sm">{`<${senderEmailDisp}>`}</span>
              </p>
              <button
                type="button"
                className="cursor-pointer mt-3 flex flex-wrap items-center gap-2 text-left text-sm text-main group"
                onClick={() => setRecipientsExpanded((e) => !e)}
              >
                <span className="text-text-secondary font-semibold">
                  To:{" "}
                  <span className="text-main font-semibold">{toSummary}</span>
                </span>
                <span className="material-symbols-outlined text-[18px] text-text-secondary group-hover:text-main transition-colors">
                  {recipientsExpanded ? "expand_less" : "expand_more"}
                </span>
              </button>

              {recipientsExpanded && meta.cc.length ? (
                <p className="mt-2 text-sm">
                  <span className="text-text-secondary font-bold mr-2">
                    Cc:
                  </span>
                  <span className="text-main">
                    {[...new Set(meta.cc)].map(resolveName).join(", ")}
                  </span>
                </p>
              ) : null}
              {recipientsExpanded && meta.bcc.length ? (
                <p className="mt-1 text-sm">
                  <span className="text-text-secondary font-bold mr-2">
                    Bcc:
                  </span>
                  <span className="text-main">
                    {[...new Set(meta.bcc)].map(resolveName).join(", ")}
                  </span>
                </p>
              ) : null}
            </div>

            <div className="w-full sm:w-auto sm:text-right shrink-0 flex flex-row sm:flex-col items-center sm:items-end gap-4 sm:gap-3">
              <div className="flex items-center gap-2 order-2 sm:order-none">
                <button
                  type="button"
                  title={email.is_starred ? "Unstar" : "Star"}
                  onClick={() => void toggleStar()}
                  disabled={isLockedInbox}
                  className="p-2 rounded-xl text-text-secondary hover:text-amber-400 hover:bg-white/[0.05] transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                >
                  <span
                    className="material-symbols-outlined text-[24px]"
                    style={{
                      fontVariationSettings: email.is_starred
                        ? "'FILL' 1"
                        : "'FILL' 0",
                    }}
                  >
                    star
                  </span>
                </button>
                {showSnoozeControl ? (
                  <SnoozeMenu
                    menuId={emailId}
                    disabled={isLockedInbox}
                    snoozedUntil={email.snoozed_until}
                    syncStatus={snoozeSync ?? undefined}
                    onSnooze={(until) => handleSnooze(until)}
                  />
                ) : null}
                <Link
                  href={isLockedInbox ? "#" : `/email/compose?replyTo=${email.id}`}
                  aria-disabled={isLockedInbox}
                  title="Reply"
                  className={`p-2 rounded-xl text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors ${isLockedInbox ? "pointer-events-none cursor-not-allowed opacity-35 hover:bg-transparent hover:text-text-secondary" : ""}`}
                >
                  <span className="material-symbols-outlined text-[24px]">
                    reply
                  </span>
                </Link>
              </div>
              <time
                className="text-xs font-semibold text-text-secondary whitespace-nowrap order-1 sm:order-none"
                dateTime={email.created_at}
              >
                {formatHeaderTs(email.created_at)}
              </time>
            </div>
          </div>

          <EmailAiWorkspace
            emailId={emailId}
            qsFolder={qsFolder}
            demoMailbox={demoMailbox}
            compareCandidates={folderEmails.map((e) => ({
              id: e.id,
              subject: e.subject || "",
            }))}
          />

          <article
            className="email-reader-frame rounded-2xl border border-slate-400/40 shadow-lg shadow-black/25 overflow-hidden bg-slate-200/85"
            lang="en"
          >
            <EmailBodyIframe html={sanitizedBodyHtml} />
          </article>

          {meta.attachments.length > 0 ? (
            <section className="pt-6 border-t border-border-dark space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-main">
                  <span className="material-symbols-outlined text-[22px] text-text-secondary">
                    attach_file
                  </span>
                  <span className="font-bold text-[15px]">
                    {meta.attachments.length} Attachment
                    {meta.attachments.length === 1 ? "" : "s"}
                    {totalAttachStr ? (
                      <span className="text-text-secondary font-semibold">{` (${totalAttachStr})`}</span>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  className="cursor-pointer text-sm font-black text-primary hover:underline uppercase tracking-wide"
                  onClick={downloadAll}
                >
                  Download all
                </button>
              </div>
              <DetailAttachmentCards
                items={meta.attachments}
                onPromptDownload={(name) =>
                  addToast(
                    `${name}: connect object storage for real downloads.`,
                    "info",
                  )
                }
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function EmailDetailView({ emailId }: { emailId: string }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center py-28">
          <div className="size-10 border-2 border-primary/25 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <EmailDetailInner emailId={emailId} />
    </Suspense>
  );
}
