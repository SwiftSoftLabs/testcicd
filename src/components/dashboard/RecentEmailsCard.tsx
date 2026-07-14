"use client";

import React from "react";
import Link from "next/link";
import { EmailMessage } from "@/types";

interface RecentEmailsCardProps {
  emails: EmailMessage[];
  isLoading: boolean;
  connected: boolean;
  className?: string;
}

export const RecentEmailsCard: React.FC<RecentEmailsCardProps> = ({
  emails,
  isLoading,
  connected,
  className = "lg:col-span-6",
}) => {
  return (
    <div
      className={`${className} bg-surface-dark border border-border-dark rounded-2xl p-6 flex flex-col`}
    >
      <h3 className="text-main text-lg font-bold mb-6">Recent Emails</h3>
      <div className="space-y-3 flex-1">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-14 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-14 rounded-xl bg-white/5 animate-pulse" />
            <div className="h-14 rounded-xl bg-white/5 animate-pulse" />
          </div>
        ) : !connected ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
            <span className="material-symbols-outlined text-text-secondary text-4xl mb-2 opacity-20">
              mail_lock
            </span>
            <p className="text-xs text-text-secondary font-bold uppercase tracking-widest">
              Connect mailbox to view emails
            </p>
          </div>
        ) : emails.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
            <span className="material-symbols-outlined text-text-secondary text-4xl mb-2 opacity-20">
              mark_email_unread
            </span>
            <p className="text-xs text-text-secondary font-bold uppercase tracking-widest">
              No recent emails
            </p>
          </div>
        ) : (
          emails.map((email) => (
            <Link
              key={email.id}
              href={`/email/${email.id}?folder=inbox`}
              className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/5 transition-all"
            >
              <span className="material-symbols-outlined text-text-secondary mt-0.5">
                mail
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-main truncate">
                    {email.subject || "(No subject)"}
                  </p>
                  <span className="text-[10px] text-text-secondary shrink-0">
                    {new Date(email.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-xs text-text-secondary truncate">
                  {email.sender?.full_name || "External Sender"}
                </p>
              </div>
            </Link>
          ))
        )}
      </div>
      <Link
        href="/email"
        className="mt-4 w-full py-2 bg-white/5 border border-border-dark text-text-secondary text-xs font-bold rounded-lg hover:text-main transition-all uppercase tracking-widest text-center"
      >
        Open Inbox
      </Link>
    </div>
  );
};
