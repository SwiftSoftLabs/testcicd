"use client";

import React, {
  Suspense,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmailList } from "@/components/email/EmailList";
import { EmailMessage, MailAccountStatus } from "@/types";
import { useAppContext } from "@/context/AppContext";
import {
  fetchMailboxList,
  isDemoMailboxProject,
} from "@/lib/email/demoMailbox";
import {
  bustMailboxListCache,
  readMailboxListCache,
  readMailboxStatusCache,
  writeMailboxStatusCache,
  notifyEmailUnreadChanged,
} from "@/lib/email/mailboxSessionCache";
import { api } from "@/lib/api";

const ALLOWED_FOLDERS = new Set([
  "inbox",
  "starred",
  "snoozed",
  "sent",
  "drafts",
]);

function EmailPageContent() {
  const { selectedProjectId } = useAppContext();
  const searchParams = useSearchParams();
  const rawFolder = (searchParams.get("folder") || "inbox").toLowerCase();
  const activeFolder = ALLOWED_FOLDERS.has(rawFolder) ? rawFolder : "inbox";

  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mailboxStatus, setMailboxStatus] = useState<MailAccountStatus | null>(
    null,
  );
  const [mailboxStatusLoading, setMailboxStatusLoading] = useState(true);
  const isDemoProject =
    selectedProjectId && isDemoMailboxProject(selectedProjectId);
  /** One background IMAP sync per visit; avoids hammering POST /accounts/sync (server rate limit). */
  const backgroundSyncStartedRef = useRef(false);

  useEffect(() => {
    const warm = readMailboxStatusCache();
    if (warm) {
      setMailboxStatus(warm);
      setMailboxStatusLoading(false);
    }
  }, []);

  const fetchMailboxStatus = useCallback(async () => {
    if (isDemoProject) {
      const demo: MailAccountStatus = { connected: true, account: null };
      setMailboxStatus(demo);
      writeMailboxStatusCache(demo);
      setMailboxStatusLoading(false);
      return;
    }
    const hadWarmCache = !!readMailboxStatusCache();
    if (!hadWarmCache) setMailboxStatusLoading(true);
    try {
      const status = (await api.email.accounts.status()) as MailAccountStatus;
      setMailboxStatus(status);
      writeMailboxStatusCache(status);
    } catch (error) {
      console.error("Failed to fetch mailbox status:", error);
      if (!hadWarmCache) setMailboxStatus({ connected: false, account: null });
    } finally {
      setMailboxStatusLoading(false);
    }
  }, [isDemoProject]);

  const fetchEmails = useCallback(
    async (opts?: { bust?: boolean; background?: boolean; sync?: boolean }) => {
      if (mailboxStatus && !mailboxStatus.connected && !isDemoProject) {
        setEmails([]);
        return;
      }
      const skipSpinner =
        opts?.background ||
        (!opts?.bust && !opts?.sync && !!readMailboxListCache(activeFolder));
      if (!skipSpinner) setIsLoading(true);
      try {
        if (opts?.sync && mailboxStatus?.connected && !isDemoProject) {
          try {
            await api.email.accounts.sync();
          } catch (err) {
            console.warn("[email] Mailbox sync failed:", err);
          }
          bustMailboxListCache();
        }
        const data = await fetchMailboxList(activeFolder, {
          bust: opts?.bust ?? opts?.sync,
        });
        setEmails(data);
        if (opts?.sync) notifyEmailUnreadChanged();
      } catch (error) {
        console.error("Failed to fetch emails:", error);
      } finally {
        if (!skipSpinner) setIsLoading(false);
      }
    },
    [activeFolder, mailboxStatus, isDemoProject],
  );

  useEffect(() => {
    void fetchMailboxStatus();
  }, [fetchMailboxStatus]);

  useEffect(() => {
    if (mailboxStatusLoading) return;
    fetchEmails();
  }, [fetchEmails, mailboxStatusLoading]);

  useEffect(() => {
    if (mailboxStatusLoading) return;
    if (!mailboxStatus?.connected || isDemoProject) return;
    if (backgroundSyncStartedRef.current) return;
    backgroundSyncStartedRef.current = true;

    void (async () => {
      try {
        await api.email.accounts.sync();
      } catch (err) {
        console.warn("[email] Background mailbox sync failed:", err);
      } finally {
        bustMailboxListCache();
        await fetchEmails({ bust: true, background: true });
        notifyEmailUnreadChanged();
      }
    })();
  }, [
    mailboxStatusLoading,
    mailboxStatus?.connected,
    isDemoProject,
    fetchEmails,
  ]);

  if (mailboxStatusLoading) {
    return (
      <div className="absolute inset-0 flex overflow-hidden bg-background-dark">
        <div className="flex-1 min-w-0 animate-pulse bg-white/2" />
      </div>
    );
  }

  if (mailboxStatus && !mailboxStatus.connected && !isDemoProject) {
    return (
      <div className="absolute inset-0 flex overflow-hidden bg-background-dark">
        <div className="flex-1 min-w-0 p-6 sm:p-8">
          <div className="max-w-3xl mx-auto border border-border-dark rounded-2xl bg-surface-dark p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-3">
              <span className="material-symbols-outlined text-primary text-2xl">
                mail_lock
              </span>
              <h1 className="text-xl sm:text-2xl font-black text-main tracking-tight">
                Connect your mailbox to get started
              </h1>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              No external mailbox is connected yet. To see real Inbox, Sent, and
              Drafts data, connect your email in Plugins (Sign in with
              Google/Microsoft, or custom IMAP).
            </p>
            <ol className="mt-5 space-y-2 text-sm text-text-secondary list-decimal list-inside">
              <li>Open Plugins settings</li>
              <li>
                Choose Gmail or Outlook and sign in, or use Custom Domain with
                IMAP/SMTP
              </li>
              <li>Wait for sync to finish, then refresh this page</li>
            </ol>
            <div className="mt-6 flex items-center gap-3">
              <Link
                href="/settings/plugins"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold shadow-lg shadow-primary/25 hover:brightness-110 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">
                  settings
                </span>
                Open Plugins
              </Link>
              <button
                type="button"
                onClick={fetchMailboxStatus}
                className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border-dark bg-background-dark text-main text-sm font-bold hover:bg-white/5 transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">
                  refresh
                </span>
                Check again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isLockedInbox = mailboxStatus?.account?.quota_locked === true;

  return (
    <div className="absolute inset-0 flex overflow-hidden bg-background-dark">
      {isLockedInbox && (
        <div className="absolute top-0 left-0 right-0 z-20 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-sm text-amber-200">
          This inbox is read-only because your workspace is over its plan limit. Upgrade to restore editing.
        </div>
      )}
      <EmailList
        emails={emails}
        isLoading={isLoading}
        activeFolder={activeFolder}
        onRefresh={() => void fetchEmails({ bust: true, sync: true })}
        initialFollowups={searchParams.get("followups") === "1"}
        isLockedInbox={isLockedInbox}
      />
    </div>
  );
}

export default function EmailPage() {
  return (
    <Suspense
      fallback={
        <div className="absolute inset-0 flex overflow-hidden bg-background-dark">
          <div className="flex-1 min-w-0 animate-pulse bg-white/2" />
        </div>
      }
    >
      <EmailPageContent />
    </Suspense>
  );
}
