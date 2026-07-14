"use client";

import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { EmailMessage } from "@/types";
import { api } from "@/lib/api";
import {
  parseStoredEmailContent,
  stripStoredMetaForPreview,
} from "@/lib/email/contentMeta";
import { isDemoMailboxProject, bustMailboxListCache } from "@/lib/email/demoMailbox";
import { writeMailboxListCache, notifyEmailUnreadChanged } from "@/lib/email/mailboxSessionCache";
import { formatSnoozedUntil, isCurrentlySnoozed, snoozePresetUntil } from "@/lib/email/snooze";
import { SnoozeMenu, type SnoozeSyncStatus } from "@/components/email/SnoozeMenu";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";

const PAGE_SIZE = 50;

import { stripHtmlToPlainText } from "@/lib/email/stripHtmlPreview";

function stripHtml(html: string): string {
  return stripHtmlToPlainText(html);
}

function formatEmailListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfMsg.getTime()) / 86400000,
  );

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function looksLikeMention(email: EmailMessage): boolean {
  const blob = `${email.subject || ""} ${stripHtml(stripStoredMetaForPreview(email.content || ""))}`;
  return /@\w/.test(blob);
}

function attachmentLabel(email: EmailMessage): string | null {
  const { meta } = parseStoredEmailContent(email.content || "");
  const a = meta.attachments[0];
  if (a) {
    const hint = `${a.name} ${a.type || ""}`.toLowerCase();
    if (hint.includes("pdf")) return "PDF";
    if (/\.docx?\b|\bword\b/.test(hint)) return "DOC";
    if (/\.xlsx?\b|spreadsheet/.test(hint)) return "XLS";
    return meta.attachments.length > 1 ? `${meta.attachments.length}` : "FILE";
  }
  const blob =
    `${email.subject || ""} ${stripStoredMetaForPreview(email.content || "")}`.toLowerCase();
  if (/\.pdf\b|application\/pdf/.test(blob)) return "PDF";
  if (/\.docx?\b|word/.test(blob)) return "DOC";
  if (/\.xlsx?\b|spreadsheet/.test(blob)) return "XLS";
  return null;
}

function deliveryLabel(
  email: EmailMessage,
): { text: string; tone: "ok" | "warn" } | null {
  const { meta } = parseStoredEmailContent(email.content || "");
  if (!meta.delivery) return null;
  if (meta.delivery.status === "sent") return { text: "DELIVERED", tone: "ok" };
  if (meta.delivery.status === "failed")
    return { text: "DELIVERY FAILED", tone: "warn" };
  return { text: "QUEUED", tone: "ok" };
}

function needsFollowupAttention(email: EmailMessage, folder: string): boolean {
  if (folder !== "inbox") return false;
  const age = Date.now() - new Date(email.created_at).getTime();
  const fiveDays = 5 * 86400000;
  if (age < fiveDays) return false;
  return !email.is_read || looksLikeMention(email);
}

export type ListFilter = "all" | "unread" | "mentioned" | "followups";

type StarSyncStatus = "syncing" | "saved" | "error";

type RowActionSyncStatus = StarSyncStatus;

type BulkActionState = {
  actionId: string;
  status: RowActionSyncStatus;
  message?: string;
} | null;

const BULK_ACTION_PROGRESS: Record<string, string> = {
  read: "Marking as read…",
  unread: "Marking as unread…",
  star: "Adding star…",
  unstar: "Removing star…",
  snooze: "Snoozing…",
  unsnooze: "Unsnoozing…",
  delete: "Deleting…",
};

function ActionStatusIcon({
  status,
  className = "text-[18px]",
}: {
  status?: RowActionSyncStatus;
  className?: string;
}) {
  if (status === "syncing") {
    return (
      <span
        className={`material-symbols-outlined ${className} animate-spin text-text-secondary`}
      >
        progress_activity
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className={`material-symbols-outlined ${className} text-emerald-400`}>
        check
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={`material-symbols-outlined ${className} text-red-400`}>
        error
      </span>
    );
  }
  return null;
}

const SAVED_SEARCHES_KEY = "onework-email-saved-searches";

const FOLDER_TITLES: Record<string, string> = {
  inbox: "Inbox",
  starred: "Starred",
  snoozed: "Snoozed",
  sent: "Sent",
  drafts: "Drafts",
};

interface EmailListProps {
  emails: EmailMessage[];
  isLoading?: boolean;
  activeFolder: string;
  onRefresh: () => void;
  /** When true, start with the follow-up smart filter (inbox only). */
  initialFollowups?: boolean;
  isLockedInbox?: boolean;
}

function blockRowNavigation(event: React.SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export const EmailList: React.FC<EmailListProps> = ({
  emails,
  isLoading,
  activeFolder,
  onRefresh,
  initialFollowups,
  isLockedInbox = false,
}) => {
  const { selectedProjectId } = useAppContext();
  const { addToast } = useUIContext();
  const router = useRouter();
  const [listFilter, setListFilter] = useState<ListFilter>(() =>
    initialFollowups && activeFolder === "inbox" ? "followups" : "all",
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [savedSearches, setSavedSearches] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((x): x is string => typeof x === "string")
        .slice(0, 8);
    } catch {
      return [];
    }
  });
  const [listEmails, setListEmails] = useState(emails);
  const [starSync, setStarSync] = useState<Record<string, RowActionSyncStatus>>({});
  const [snoozeSync, setSnoozeSync] = useState<Record<string, SnoozeSyncStatus>>({});
  const [readSync, setReadSync] = useState<Record<string, RowActionSyncStatus>>({});
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [bulkActionState, setBulkActionState] = useState<BulkActionState>(null);
  const bulkMenuRef = useRef<HTMLDivElement>(null);
  const starSyncTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const snoozeSyncTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const readSyncTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const bulkStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optimisticLockRef = useRef(0);

  useEffect(() => {
    if (optimisticLockRef.current > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync list when folder fetch completes
    setListEmails(emails);
    setStarSync({});
    setSnoozeSync({});
    setReadSync({});
  }, [emails, activeFolder]);

  useEffect(() => {
    const starTimers = starSyncTimers.current;
    const snoozeTimers = snoozeSyncTimers.current;
    const readTimers = readSyncTimers.current;
    return () => {
      starTimers.forEach((timer) => clearTimeout(timer));
      starTimers.clear();
      snoozeTimers.forEach((timer) => clearTimeout(timer));
      snoozeTimers.clear();
      readTimers.forEach((timer) => clearTimeout(timer));
      readTimers.clear();
      if (bulkStatusTimer.current) clearTimeout(bulkStatusTimer.current);
    };
  }, []);

  const setBulkActionStatus = useCallback(
    (
      actionId: string,
      status: RowActionSyncStatus | null,
      message?: string,
    ) => {
      if (bulkStatusTimer.current) {
        clearTimeout(bulkStatusTimer.current);
        bulkStatusTimer.current = null;
      }

      if (status === null) {
        setBulkActionState(null);
        return;
      }

      setBulkActionState({ actionId, status, message });
      if (status === "saved" || status === "error") {
        bulkStatusTimer.current = setTimeout(
          () => setBulkActionStatus(actionId, null),
          status === "saved" ? 1800 : 2800,
        );
      }
    },
    [],
  );

  const setRowActionSyncStatus = useCallback(
    (
      kind: "star" | "snooze" | "read",
      id: string,
      status: RowActionSyncStatus | null,
    ) => {
      const timers =
        kind === "star"
          ? starSyncTimers.current
          : kind === "snooze"
            ? snoozeSyncTimers.current
            : readSyncTimers.current;
      const existing = timers.get(id);
      if (existing) clearTimeout(existing);

      const apply = (
        setter: React.Dispatch<
          React.SetStateAction<Record<string, RowActionSyncStatus>>
        >,
      ) => {
        if (status === null) {
          setter((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          timers.delete(id);
          return;
        }

        setter((prev) => ({ ...prev, [id]: status }));
        if (status === "saved" || status === "error") {
          timers.set(
            id,
            setTimeout(
              () => setRowActionSyncStatus(kind, id, null),
              status === "saved" ? 1200 : 2500,
            ),
          );
        }
      };

      if (kind === "star") apply(setStarSync);
      else if (kind === "snooze") apply(setSnoozeSync);
      else apply(setReadSync);
    },
    [],
  );

  const setStarSyncStatus = useCallback(
    (id: string, status: RowActionSyncStatus | null) => {
      setRowActionSyncStatus("star", id, status);
    },
    [setRowActionSyncStatus],
  );

  const setSnoozeSyncStatus = useCallback(
    (id: string, status: SnoozeSyncStatus | null) => {
      setRowActionSyncStatus("snooze", id, status);
    },
    [setRowActionSyncStatus],
  );

  const setReadSyncStatus = useCallback(
    (id: string, status: RowActionSyncStatus | null) => {
      setRowActionSyncStatus("read", id, status);
    },
    [setRowActionSyncStatus],
  );

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkMenuOpen(false);
    setBulkActionState(null);
  }, [activeFolder]);

  useEffect(() => {
    if (!bulkMenuOpen) return;
    const onDocPointerDown = (event: MouseEvent) => {
      if (bulkMenuRef.current?.contains(event.target as Node)) return;
      setBulkMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [bulkMenuOpen]);

  const selectedEmails = useMemo(
    () => listEmails.filter((email) => selectedIds.has(email.id)),
    [listEmails, selectedIds],
  );

  useEffect(() => {
    if (listFilter !== "followups") return;
    if (activeFolder !== "inbox") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset invalid filter when folder changes
      setListFilter("all");
    }
  }, [activeFolder, listFilter]);

  const applyBulkPatch = useCallback(
    async (
      actionId: string,
      targets: EmailMessage[],
      buildPatch: (email: EmailMessage) => Record<string, unknown> | null,
      buildNextList: (current: EmailMessage[]) => EmailMessage[],
      getSuccessMessage: (count: number) => string,
    ) => {
      if (isLockedInbox) return;
      if (selectedProjectId && isDemoMailboxProject(selectedProjectId)) {
        addToast("Sample data: bulk actions are disabled.", "info");
        return;
      }

      const actionable = targets.filter((email) => buildPatch(email) !== null);
      if (actionable.length === 0) {
        addToast("No selected messages can be updated.", "info");
        return;
      }

      const previousEmails = listEmails;
      const nextEmails = buildNextList(listEmails);
      setListEmails(nextEmails);
      setBulkActionStatus(
        actionId,
        "syncing",
        BULK_ACTION_PROGRESS[actionId] ?? "Updating…",
      );
      optimisticLockRef.current += 1;

      try {
        await Promise.all(
          actionable.map((email) =>
            api.email.update(email.id, buildPatch(email)!),
          ),
        );
        writeMailboxListCache(activeFolder, nextEmails);
        bustMailboxListCache("inbox");
        bustMailboxListCache("starred");
        bustMailboxListCache("snoozed");
        setSelectedIds(new Set());
        setBulkActionStatus(
          actionId,
          "saved",
          getSuccessMessage(actionable.length),
        );
        notifyEmailUnreadChanged();
        window.setTimeout(() => setBulkMenuOpen(false), 900);
      } catch (err) {
        console.error(err);
        setListEmails(previousEmails);
        setBulkActionStatus(actionId, "error", "Update failed");
        addToast("Some messages could not be updated.", "error");
      } finally {
        optimisticLockRef.current = Math.max(0, optimisticLockRef.current - 1);
      }
    },
    [
      activeFolder,
      addToast,
      isLockedInbox,
      listEmails,
      selectedProjectId,
      setBulkActionStatus,
    ],
  );

  const bulkMarkRead = () => {
    void applyBulkPatch(
      "read",
      selectedEmails,
      (email) => (email.is_read ? null : { is_read: true }),
      (current) =>
        current.map((email) =>
          selectedIds.has(email.id) ? { ...email, is_read: true } : email,
        ),
      (count) => `Marked ${count} as read`,
    );
  };

  const bulkMarkUnread = () => {
    void applyBulkPatch(
      "unread",
      selectedEmails,
      (email) => (!email.is_read ? null : { is_read: false }),
      (current) =>
        current.map((email) =>
          selectedIds.has(email.id) ? { ...email, is_read: false } : email,
        ),
      (count) => `Marked ${count} as unread`,
    );
  };

  const bulkStar = () => {
    void applyBulkPatch(
      "star",
      selectedEmails,
      (email) => (email.is_starred ? null : { is_starred: true }),
      (current) =>
        current.map((email) =>
          selectedIds.has(email.id) ? { ...email, is_starred: true } : email,
        ),
      (count) =>
        `Starred ${count} message${count === 1 ? "" : "s"}`,
    );
  };

  const bulkUnstar = () => {
    void applyBulkPatch(
      "unstar",
      selectedEmails,
      (email) => (!email.is_starred ? null : { is_starred: false }),
      (current) =>
        current
          .map((email) =>
            selectedIds.has(email.id) ? { ...email, is_starred: false } : email,
          )
          .filter((email) =>
            activeFolder === "starred" && selectedIds.has(email.id)
              ? false
              : true,
          ),
      (count) =>
        `Removed star from ${count} message${count === 1 ? "" : "s"}`,
    );
  };

  const bulkSnoozeUntilTomorrow = () => {
    const until = snoozePresetUntil("tomorrow").toISOString();
    void applyBulkPatch(
      "snooze",
      selectedEmails,
      () => ({ snoozed_until: until }),
      (current) =>
        current
          .map((email) =>
            selectedIds.has(email.id) ? { ...email, snoozed_until: until } : email,
          )
          .filter((email) =>
            activeFolder === "inbox" && selectedIds.has(email.id) ? false : true,
          ),
      (count) => `Snoozed ${count} until ${formatSnoozedUntil(until)}`,
    );
  };

  const bulkUnsnooze = () => {
    void applyBulkPatch(
      "unsnooze",
      selectedEmails,
      () => ({ snoozed_until: null }),
      (current) =>
        current
          .map((email) =>
            selectedIds.has(email.id) ? { ...email, snoozed_until: null } : email,
          )
          .filter((email) =>
            activeFolder === "snoozed" && selectedIds.has(email.id)
              ? false
              : true,
          ),
      (count) => `Unsnoozed ${count} message${count === 1 ? "" : "s"}`,
    );
  };

  const bulkDelete = async () => {
    if (isLockedInbox) return;
    if (selectedEmails.length === 0) {
      addToast("Select messages first.", "info");
      return;
    }
    if (selectedProjectId && isDemoMailboxProject(selectedProjectId)) {
      addToast("Sample data: delete is disabled.", "info");
      return;
    }

    const count = selectedEmails.length;
    if (
      !confirm(
        `Delete ${count} message${count === 1 ? "" : "s"} permanently?`,
      )
    ) {
      return;
    }

    const ids = new Set(selectedEmails.map((email) => email.id));
    const previousEmails = listEmails;
    const nextEmails = listEmails.filter((email) => !ids.has(email.id));
    setListEmails(nextEmails);
    setBulkActionStatus(
      "delete",
      "syncing",
      BULK_ACTION_PROGRESS.delete,
    );
    optimisticLockRef.current += 1;

    try {
      await Promise.all(selectedEmails.map((email) => api.email.delete(email.id)));
      writeMailboxListCache(activeFolder, nextEmails);
      bustMailboxListCache();
      setSelectedIds(new Set());
      setBulkActionStatus(
        "delete",
        "saved",
        `Deleted ${count} message${count === 1 ? "" : "s"}`,
      );
      window.setTimeout(() => setBulkMenuOpen(false), 900);
    } catch (err) {
      console.error(err);
      setListEmails(previousEmails);
      setBulkActionStatus("delete", "error", "Delete failed");
      addToast("Some messages could not be deleted.", "error");
    } finally {
      optimisticLockRef.current = Math.max(0, optimisticLockRef.current - 1);
    }
  };

  const title = FOLDER_TITLES[activeFolder] || "Inbox";

  const filtered = useMemo(() => {
    let list = listEmails;
    const effectiveFilter =
      listFilter === "followups" && activeFolder !== "inbox"
        ? "all"
        : listFilter;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const sender = e.sender?.full_name?.toLowerCase() || "";
        const sub = (e.subject || "").toLowerCase();
        const body = stripHtml(
          stripStoredMetaForPreview(e.content || ""),
        ).toLowerCase();
        return sender.includes(q) || sub.includes(q) || body.includes(q);
      });
    }
    if (effectiveFilter === "unread") list = list.filter((e) => !e.is_read);
    if (effectiveFilter === "mentioned") list = list.filter(looksLikeMention);
    if (effectiveFilter === "followups")
      list = list.filter((e) => needsFollowupAttention(e, activeFolder));
    if (activeFolder === "snoozed") {
      list = [...list].sort((a, b) => {
        const aUntil = a.snoozed_until
          ? new Date(a.snoozed_until).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bUntil = b.snoozed_until
          ? new Date(b.snoozed_until).getTime()
          : Number.MAX_SAFE_INTEGER;
        return aUntil - bUntil;
      });
    }
    return list;
  }, [listEmails, search, listFilter, activeFolder]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    queueMicrotask(() => {
      setPage((p) => Math.min(p, Math.max(0, pageCount - 1)));
    });
  }, [pageCount, filtered.length]);

  const safePage = Math.min(page, pageCount - 1);
  const paged = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE);

  const allOnPageSelected =
    paged.length > 0 && paged.every((e) => selectedIds.has(e.id));
  const someOnPageSelected = paged.some((e) => selectedIds.has(e.id));

  const toggleSelectAllOnPage = useCallback(() => {
    if (isLockedInbox) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        paged.forEach((e) => next.delete(e.id));
      } else {
        paged.forEach((e) => next.add(e.id));
      }
      return next;
    });
  }, [allOnPageSelected, isLockedInbox, paged]);

  const toggleRowSelected = useCallback((id: string, checked: boolean) => {
    if (isLockedInbox) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, [isLockedInbox]);

  const openEmailRow = useCallback(
    (emailId: string) => {
      router.push(
        `/email/${emailId}?folder=${encodeURIComponent(activeFolder)}`,
      );
    },
    [router, activeFolder],
  );

  const handleStar = async (e: React.MouseEvent, email: EmailMessage) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLockedInbox) return;
    if (selectedProjectId && isDemoMailboxProject(selectedProjectId)) {
      addToast("Sample data: starring is disabled.", "info");
      return;
    }

    const nextStarred = !email.is_starred;
    const previousEmails = listEmails;
    const nextEmails = previousEmails
      .map((item) =>
        item.id === email.id ? { ...item, is_starred: nextStarred } : item,
      )
      .filter((item) =>
        activeFolder === "starred" && !nextStarred
          ? item.id !== email.id
          : true,
      );

    setListEmails(nextEmails);
    setStarSyncStatus(email.id, "syncing");
    optimisticLockRef.current += 1;

    try {
      await api.email.update(email.id, { is_starred: nextStarred });
      writeMailboxListCache(activeFolder, nextEmails);
      bustMailboxListCache("inbox");
      bustMailboxListCache("starred");
      setStarSyncStatus(email.id, "saved");
    } catch (err) {
      console.error(err);
      setListEmails(previousEmails);
      setStarSyncStatus(email.id, "error");
      addToast("Could not update star.", "error");
    } finally {
      optimisticLockRef.current = Math.max(0, optimisticLockRef.current - 1);
    }
  };

  const handleSnooze = async (email: EmailMessage, until: string | null) => {
    if (isLockedInbox) return;
    if (selectedProjectId && isDemoMailboxProject(selectedProjectId)) {
      addToast("Sample data: snooze is disabled.", "info");
      return;
    }

    const previousEmails = listEmails;
    const willHideFromInbox =
      activeFolder === "inbox" &&
      until !== null &&
      new Date(until).getTime() > Date.now();
    const willHideFromSnoozed =
      activeFolder === "snoozed" &&
      (until === null || new Date(until).getTime() <= Date.now());

    const nextEmails = previousEmails
      .map((item) =>
        item.id === email.id ? { ...item, snoozed_until: until } : item,
      )
      .filter((item) => {
        if (willHideFromInbox && item.id === email.id) return false;
        if (willHideFromSnoozed && item.id === email.id) return false;
        return true;
      });

    setListEmails(nextEmails);
    setSnoozeSyncStatus(email.id, "syncing");
    optimisticLockRef.current += 1;

    try {
      await api.email.update(email.id, { snoozed_until: until });
      writeMailboxListCache(activeFolder, nextEmails);
      bustMailboxListCache("inbox");
      bustMailboxListCache("snoozed");
      setSnoozeSyncStatus(email.id, "saved");
      notifyEmailUnreadChanged();
    } catch (err) {
      console.error(err);
      setListEmails(previousEmails);
      setSnoozeSyncStatus(email.id, "error");
      addToast("Could not update snooze.", "error");
    } finally {
      optimisticLockRef.current = Math.max(0, optimisticLockRef.current - 1);
    }
  };

  const handleReadToggle = async (
    event: React.MouseEvent,
    email: EmailMessage,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (isLockedInbox) return;
    if (activeFolder === "sent" || activeFolder === "drafts") return;
    if (selectedProjectId && isDemoMailboxProject(selectedProjectId)) {
      addToast("Sample data: read state is disabled.", "info");
      return;
    }

    const nextRead = !email.is_read;
    const previousEmails = listEmails;
    const nextEmails = previousEmails.map((item) =>
      item.id === email.id ? { ...item, is_read: nextRead } : item,
    );

    setListEmails(nextEmails);
    setReadSyncStatus(email.id, "syncing");
    optimisticLockRef.current += 1;

    try {
      await api.email.update(email.id, { is_read: nextRead });
      writeMailboxListCache(activeFolder, nextEmails);
      bustMailboxListCache("inbox");
      setReadSyncStatus(email.id, "saved");
      notifyEmailUnreadChanged();
    } catch (err) {
      console.error(err);
      setListEmails(previousEmails);
      setReadSyncStatus(email.id, "error");
      addToast("Could not update read state.", "error");
    } finally {
      optimisticLockRef.current = Math.max(0, optimisticLockRef.current - 1);
    }
  };

  const saveCurrentSearch = () => {
    const s = search.trim();
    if (!s) return;
    if (savedSearches.includes(s)) {
      addToast("Already saved", "info");
      return;
    }
    const next = [s, ...savedSearches].slice(0, 8);
    setSavedSearches(next);
    try {
      localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    addToast("Search saved", "success");
  };

  const showSnoozeControl =
    activeFolder === "inbox" || activeFolder === "snoozed";
  const showReadControl =
    activeFolder === "inbox" ||
    activeFolder === "starred" ||
    activeFolder === "snoozed";
  const selectionCount = selectedEmails.length;
  const bulkActionBusy = bulkActionState?.status === "syncing";
  const bulkActionsDisabled =
    isLockedInbox || bulkActionBusy || selectionCount === 0;

  const bulkMenuItems: Array<{
    id: string;
    label: string;
    icon: string;
    destructive?: boolean;
    hidden?: boolean;
    onClick: () => void;
  }> = [
      {
        id: "read",
        label: "Mark as read",
        icon: "mark_email_read",
        hidden: !showReadControl,
        onClick: bulkMarkRead,
      },
      {
        id: "unread",
        label: "Mark as unread",
        icon: "mark_email_unread",
        hidden: !showReadControl,
        onClick: bulkMarkUnread,
      },
      {
        id: "star",
        label: "Add star",
        icon: "star",
        onClick: bulkStar,
      },
      {
        id: "unstar",
        label: "Remove star",
        icon: "star",
        onClick: bulkUnstar,
      },
      {
        id: "snooze",
        label: "Snooze until tomorrow",
        icon: "schedule",
        hidden: activeFolder !== "inbox",
        onClick: bulkSnoozeUntilTomorrow,
      },
      {
        id: "unsnooze",
        label: "Unsnooze",
        icon: "notifications_active",
        hidden: activeFolder !== "snoozed",
        onClick: bulkUnsnooze,
      },
      {
        id: "delete",
        label: "Delete",
        icon: "delete",
        destructive: true,
        onClick: () => void bulkDelete(),
      },
    ];

  const filterBtn = (id: ListFilter, label: string) => (
    <button
      type="button"
      key={id}
      onClick={() => {
        setListFilter(id);
        setPage(0);
      }}
      className={`cursor-pointer px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 ${listFilter === id
          ? "bg-primary text-white shadow-sm shadow-primary/20"
          : "text-text-secondary hover:text-main hover:bg-white/6"
        }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-background-dark overflow-hidden">
      <div className="shrink-0 px-3 sm:px-5 lg:px-6 pt-5 lg:pt-6 pb-4 lg:pb-5 w-full">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-2xl font-bold text-main tracking-tight">
              {title}
            </h1>
            <p className="text-sm text-text-secondary mt-0.5 tabular-nums">
              {filtered.length === emails.length
                ? `${emails.length.toLocaleString()} conversation${emails.length === 1 ? "" : "s"}`
                : `${filtered.length.toLocaleString()} of ${emails.length.toLocaleString()} shown`}
            </p>
          </div>
          {isLockedInbox ? (
            <button
              type="button"
              disabled
              className="shrink-0 inline-flex items-center justify-center gap-2 bg-primary text-white rounded-xl px-4 py-2.5 text-sm font-semibold shadow-md shadow-primary/15 transition-all mt-3 sm:mt-0 opacity-45 cursor-not-allowed"
              title="This inbox is read-only because your workspace is over its plan limit."
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: "'FILL' 0" }}
              >
                edit_square
              </span>
              Compose
            </button>
          ) : (
            <Link
              href="/email/compose"
              className="shrink-0 inline-flex items-center justify-center gap-2 bg-primary hover:brightness-110 text-white rounded-xl px-4 py-2.5 text-sm font-semibold shadow-md shadow-primary/15 transition-all mt-3 sm:mt-0"
            >
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ fontVariationSettings: "'FILL' 0" }}
              >
                edit_square
              </span>
              Compose
            </Link>
          )}
        </div>

        <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative flex-1 min-w-0">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary/80 text-[20px]">
              search
            </span>
            <input
              type="search"
              value={search}
              onChange={(ev) => {
                setSearch(ev.target.value);
                setPage(0);
              }}
              placeholder="Search subject, sender, or body…"
              className="w-full bg-surface-dark/80 border border-border-dark/80 rounded-xl pl-11 pr-3.5 py-2.5 text-sm text-main placeholder:text-text-secondary/50 outline-none focus:ring-2 focus:ring-primary/35 focus:border-primary/60 transition-shadow"
            />
          </div>
          <div
            className="flex items-center gap-0.5 p-1 rounded-full bg-surface-dark/60 border border-border-dark/80 shrink-0 overflow-x-auto"
            role="group"
            aria-label="Filter messages"
          >
            {filterBtn("all", "All")}
            {filterBtn("unread", "Unread")}
            {filterBtn("mentioned", "Mentioned")}
            {activeFolder === "inbox"
              ? filterBtn("followups", "Follow-ups")
              : null}
          </div>
        </div>
        {savedSearches.length > 0 || search.trim() ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {savedSearches.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSearch(s);
                  setPage(0);
                }}
                className="cursor-pointer rounded-full border border-border-dark/70 bg-surface-dark/50 px-3 py-1 text-xs font-medium text-text-secondary hover:text-main hover:bg-white/6 transition-colors max-w-[200px] truncate"
                title={s}
              >
                {s}
              </button>
            ))}
            {search.trim() ? (
              <button
                type="button"
                onClick={saveCurrentSearch}
                className="cursor-pointer rounded-full border border-primary/35 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors"
              >
                Save search
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-3 sm:px-5 lg:px-6 pb-4 lg:pb-6 w-full min-w-0">
        <div className="shrink-0 flex items-center justify-between gap-3 py-2.5 px-1 border-b border-border-dark/50">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={toggleSelectAllOnPage}
              disabled={isLockedInbox}
              className="flex items-center gap-0.5 p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/6 transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              title="Select all on page"
            >
              <span
                className={`material-symbols-outlined text-[20px] ${allOnPageSelected ? "text-primary" : someOnPageSelected ? "text-primary/70" : ""}`}
                style={{
                  fontVariationSettings: allOnPageSelected
                    ? "'FILL' 1"
                    : "'FILL' 0",
                }}
              >
                {allOnPageSelected
                  ? "check_box"
                  : someOnPageSelected
                    ? "indeterminate_check_box"
                    : "check_box_outline_blank"}
              </span>
              <span className="material-symbols-outlined text-[18px] opacity-50">
                arrow_drop_down
              </span>
            </button>
            <button
              type="button"
              onClick={() => onRefresh()}
              className="cursor-pointer p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/6 transition-colors"
              title="Refresh"
            >
              <span className="material-symbols-outlined text-[20px]">
                refresh
              </span>
            </button>
            <div className="relative" ref={bulkMenuRef}>
              <button
                type="button"
                disabled={isLockedInbox || bulkActionBusy}
                onClick={() => setBulkMenuOpen((open) => !open)}
                className={`p-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${bulkMenuOpen || selectionCount > 0 || bulkActionState
                    ? "text-primary bg-primary/10 hover:bg-primary/15"
                    : "text-text-secondary hover:text-main hover:bg-white/6"
                  }`}
                title={
                  bulkActionState?.message ||
                  (selectionCount > 0
                    ? `${selectionCount} selected — bulk actions`
                    : "Bulk actions")
                }
                aria-expanded={bulkMenuOpen}
                aria-haspopup="menu"
                aria-busy={bulkActionBusy}
              >
                {bulkActionState ? (
                  <ActionStatusIcon
                    status={bulkActionState.status}
                    className="text-[20px]"
                  />
                ) : (
                  <span className="material-symbols-outlined text-[20px]">
                    more_vert
                  </span>
                )}
              </button>
              {bulkMenuOpen ? (
                <div
                  className="absolute left-0 top-full mt-1 z-50 w-60 rounded-xl border border-border-dark bg-surface-dark shadow-xl py-1"
                  role="menu"
                >
                  <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary border-b border-border-dark/60">
                    {bulkActionState?.message
                      ? bulkActionState.message
                      : selectionCount > 0
                        ? `${selectionCount} selected`
                        : "Select messages"}
                  </p>
                  {bulkMenuItems
                    .filter((item) => !item.hidden)
                    .map((item) => {
                      const itemStatus =
                        bulkActionState?.actionId === item.id
                          ? bulkActionState.status
                          : undefined;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          disabled={bulkActionsDisabled && !itemStatus}
                          onClick={item.onClick}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${item.destructive
                              ? "text-red-400 hover:bg-red-500/10"
                              : "text-main hover:bg-white/[0.05]"
                            }`}
                        >
                          <span
                            className={`material-symbols-outlined text-[18px] ${item.destructive
                                ? "text-red-400"
                                : "text-text-secondary"
                              }`}
                          >
                            {item.icon}
                          </span>
                          <span className="min-w-0 flex-1">{item.label}</span>
                          <ActionStatusIcon status={itemStatus} />
                        </button>
                      );
                    })}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-secondary font-medium tabular-nums">
            <span className="hidden sm:inline">
              {filtered.length === 0 ? "0" : `${rangeStart}–${rangeEnd}`} of{" "}
              {filtered.length.toLocaleString()}
            </span>
            <div className="flex items-center rounded-lg border border-border-dark/60 bg-surface-dark/30 p-0.5">
              <button
                type="button"
                disabled={safePage <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="cursor-pointer p-1 rounded-md hover:bg-white/6 disabled:opacity-25 disabled:pointer-events-none text-main transition-colors"
                aria-label="Previous page"
              >
                <span className="material-symbols-outlined text-[20px]">
                  chevron_left
                </span>
              </button>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="cursor-pointer p-1 rounded-md hover:bg-white/6 disabled:opacity-25 disabled:pointer-events-none text-main transition-colors"
                aria-label="Next page"
              >
                <span className="material-symbols-outlined text-[20px]">
                  chevron_right
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar rounded-2xl border border-border-dark/50 bg-surface-dark/20 mt-2">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-2 sm:p-3">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div
                  key={i}
                  className="h-[4.25rem] rounded-xl bg-surface-highlight/30 animate-pulse"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[14rem] text-text-secondary px-6 text-center">
              <div className="size-14 rounded-2xl bg-surface-highlight/50 border border-border-dark/60 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl text-text-secondary/40">
                  mail
                </span>
              </div>
              <p className="text-sm font-semibold text-main">Nothing here</p>
              <p className="text-xs mt-1.5 text-text-secondary max-w-[240px] leading-relaxed">
                Adjust your search or filters, or pick another folder.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1 p-2 sm:p-3 list-none m-0">
              {paged.map((email) => {
                const snippet = stripHtml(
                  stripStoredMetaForPreview(email.content || ""),
                );
                const mention = looksLikeMention(email);
                const attach = attachmentLabel(email);
                const delivery = deliveryLabel(email);
                const unread = !email.is_read;
                const starSyncStatus = starSync[email.id];
                const snoozeSyncStatus = snoozeSync[email.id];
                const readSyncStatus = readSync[email.id];
                const snoozedActive = isCurrentlySnoozed(email);

                const subjectText = email.subject || "(No subject)";
                const previewText = snippet || "No preview";

                return (
                  <li key={email.id} className="m-0 p-0">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openEmailRow(email.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openEmailRow(email.id);
                        }
                      }}
                      className={`
                                                group flex flex-col gap-1.5 rounded-xl px-2.5 py-2.5 text-inherit outline-none transition-colors cursor-pointer
                                                border border-transparent
                                                hover:bg-surface-highlight/35 hover:border-border-dark/40
                                                focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/30
                                                ${unread ? "bg-primary/4" : ""}
                                                sm:px-3
                                                md:grid md:grid-cols-[auto_minmax(0,11rem)_minmax(0,1fr)_3.5rem]
                                                md:items-center md:gap-x-3 md:gap-y-0
                                                lg:grid-cols-[auto_minmax(9rem,14rem)_minmax(0,0.36fr)_minmax(0,1fr)_4.5rem]
                                            `}
                    >
                      {/* Col 1 — controls + avatar (Gmail-style gutter) */}
                      <div className="flex items-center justify-between gap-2 md:contents">
                        <div
                          className="relative z-20 flex items-center gap-1.5 shrink-0"
                          onMouseDown={blockRowNavigation}
                          onClick={blockRowNavigation}
                        >
                          <input
                            type="checkbox"
                            className="size-[15px] rounded border-border-dark bg-background-dark text-primary focus:ring-primary focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-35"
                            checked={selectedIds.has(email.id)}
                            disabled={isLockedInbox}
                            onMouseDown={blockRowNavigation}
                            onClick={blockRowNavigation}
                            onChange={(ev) =>
                              toggleRowSelected(email.id, ev.target.checked)
                            }
                            aria-label={`Select ${email.subject || "message"}`}
                          />
                          <button
                            type="button"
                            disabled={
                              isLockedInbox || starSyncStatus === "syncing"
                            }
                            className={`relative rounded-md p-0.5 transition-colors opacity-70 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35 ${email.is_starred ? "text-amber-400" : isLockedInbox ? "text-text-secondary" : "text-text-secondary hover:text-amber-400/90"}`}
                            onMouseDown={blockRowNavigation}
                            onClick={(ev) => handleStar(ev, email)}
                            aria-label={email.is_starred ? "Unstar" : "Star"}
                            aria-busy={starSyncStatus === "syncing"}
                          >
                            {starSyncStatus === "syncing" ? (
                              <span className="material-symbols-outlined text-[18px] animate-spin text-text-secondary">
                                progress_activity
                              </span>
                            ) : starSyncStatus === "saved" ? (
                              <span className="material-symbols-outlined text-[18px] text-emerald-400">
                                check
                              </span>
                            ) : starSyncStatus === "error" ? (
                              <span className="material-symbols-outlined text-[18px] text-red-400">
                                error
                              </span>
                            ) : (
                              <span
                                className="material-symbols-outlined text-[18px]"
                                style={{
                                  fontVariationSettings: email.is_starred
                                    ? "'FILL' 1"
                                    : "'FILL' 0",
                                }}
                              >
                                star
                              </span>
                            )}
                          </button>
                          {showSnoozeControl ? (
                            <SnoozeMenu
                              compact
                              menuId={email.id}
                              disabled={isLockedInbox}
                              snoozedUntil={email.snoozed_until}
                              syncStatus={snoozeSyncStatus}
                              onSnooze={(until) => handleSnooze(email, until)}
                            />
                          ) : null}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              email.sender?.avatar_url ||
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(email.sender?.full_name || "?")}&background=334155&color=e2e8f0`
                            }
                            alt=""
                            className="size-9 shrink-0 rounded-full bg-surface-highlight object-cover ring-1 ring-border-dark/50"
                          />
                        </div>
                        <time
                          dateTime={email.created_at}
                          className="shrink-0 text-[11px] font-medium tabular-nums text-text-secondary md:hidden"
                        >
                          {formatEmailListTime(email.created_at)}
                        </time>
                      </div>

                      {/* Col 2 — sender */}
                      <div className="flex min-w-0 items-center gap-1.5 md:min-w-0">
                        {showReadControl ? (
                          <button
                            type="button"
                            disabled={isLockedInbox || readSyncStatus === "syncing"}
                            onMouseDown={blockRowNavigation}
                            onClick={(event) => handleReadToggle(event, email)}
                            className="flex size-4 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-35"
                            aria-label={
                              unread ? "Mark as read" : "Mark as unread"
                            }
                            title={unread ? "Mark as read" : "Mark as unread"}
                            aria-busy={readSyncStatus === "syncing"}
                          >
                            {readSyncStatus ? (
                              <ActionStatusIcon
                                status={readSyncStatus}
                                className="text-[14px]"
                              />
                            ) : unread ? (
                              <span className="size-1.5 rounded-full bg-primary ring-2 ring-primary/25" />
                            ) : (
                              <span className="size-1.5 rounded-full border border-text-secondary/35 opacity-0 transition-opacity group-hover:opacity-100" />
                            )}
                          </button>
                        ) : null}
                        <span
                          className={`min-w-0 truncate text-sm ${unread ? "font-semibold text-main" : "font-medium text-text-secondary"}`}
                          title={email.sender?.full_name || "Unknown"}
                        >
                          {email.sender?.full_name || "Unknown"}
                        </span>
                      </div>

                      {/* Col 3 — subject + meta chips */}
                      <div className="flex min-w-0 flex-col gap-0.5 md:flex-row md:items-center md:gap-1.5">
                        <span
                          className={`min-w-0 truncate text-sm leading-snug ${unread ? "font-semibold text-main" : "font-medium text-main/90"}`}
                          title={subjectText}
                        >
                          {subjectText}
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center gap-1">
                          {mention && (
                            <span className="inline-flex rounded-md border border-primary/25 bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              @
                            </span>
                          )}
                          {attach && (
                            <span className="inline-flex items-center gap-0.5 rounded-md border border-border-dark/60 bg-white/4 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-secondary">
                              <span className="material-symbols-outlined text-[13px]">
                                attach_file
                              </span>
                              {attach}
                            </span>
                          )}
                          {delivery && activeFolder === "sent" && (
                            <span
                              className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${delivery.tone === "warn"
                                  ? "border border-red-500/20 bg-red-500/12 text-red-300"
                                  : "border border-emerald-500/20 bg-emerald-500/12 text-emerald-300"
                                }`}
                            >
                              {delivery.text}
                            </span>
                          )}
                          {activeFolder === "snoozed" &&
                            email.snoozed_until &&
                            snoozedActive ? (
                            <span className="inline-flex shrink-0 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              Until {formatSnoozedUntil(email.snoozed_until)}
                            </span>
                          ) : null}
                        </span>
                      </div>

                      {/* Col 4 — preview + optional AI summary (hidden at md, shown at lg where grid has 5 cols) */}
                      <div className="md:hidden lg:block min-w-0 lg:col-start-4 lg:row-start-1">
                        <p
                          className="text-[13px] leading-snug text-text-secondary md:text-xs md:leading-relaxed"
                          title={previewText}
                        >
                          <span className="line-clamp-2 font-normal md:line-clamp-1 md:truncate">
                            {previewText}
                          </span>
                        </p>
                        {email.ai_digest_summary ? (
                          <p
                            className="mt-0.5 text-[10px] leading-snug text-primary/90 line-clamp-2 md:line-clamp-2"
                            title={email.ai_digest_summary}
                          >
                            AI: {email.ai_digest_summary}
                          </p>
                        ) : null}
                      </div>

                      {/* Col 4/5 — time (tablet uses col 4, desktop uses col 5) */}
                      <time
                        dateTime={email.created_at}
                        className="hidden shrink-0 text-right text-[11px] font-medium tabular-nums text-text-secondary md:block md:justify-self-end"
                      >
                        {formatEmailListTime(email.created_at)}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
