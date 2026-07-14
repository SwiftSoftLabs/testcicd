"use client";

import React from "react";
import Link from "next/link";

interface RecentCommsProps {
  messages: Array<{
    id: string;
    content: string;
    created_at: string;
    sender?: {
      full_name?: string | null;
      avatar_url?: string | null;
    } | null;
  }> | null;
  className?: string;
}

export const RecentComms: React.FC<RecentCommsProps> = ({
  messages,
  className = "lg:col-span-4",
}) => {
  const comms = (messages || []).map((m) => ({
    name: m.sender?.full_name || "System",
    msg: m.content,
    time: new Date(m.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    avatar:
      m.sender?.avatar_url ||
      `https://ui-avatars.com/api/?name=${m.sender?.full_name || "S"}&background=random`,
  }));

  return (
    <div
      className={`${className} bg-surface-dark border border-border-dark rounded-2xl p-6 flex flex-col`}
    >
      <h3 className="text-main text-lg font-bold mb-6">Recent Comms</h3>
      <div className="space-y-4 flex-1">
        {comms.length > 0 ? (
          comms.map((comm, idx) => (
            <Link
              key={idx}
              href="/chat"
              className="flex gap-4 p-3 rounded-xl hover:bg-white/5 transition-all cursor-pointer relative group"
            >
              <div
                className="size-10 rounded-full bg-cover bg-center shrink-0 border border-border-dark"
                style={{ backgroundImage: `url(${comm.avatar})` }}
              ></div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-sm font-bold text-main truncate">
                    {comm.name}
                  </span>
                  <span className="text-[10px] text-text-secondary">
                    {comm.time}
                  </span>
                </div>
                <p className="text-xs text-text-secondary truncate">
                  {comm.msg}
                </p>
              </div>
            </Link>
          ))
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
            <span className="material-symbols-outlined text-text-secondary text-4xl mb-2 opacity-20">
              chat_bubble
            </span>
            <p className="text-xs text-text-secondary font-bold uppercase tracking-widest">
              No recent messages
            </p>
          </div>
        )}
      </div>
      <Link
        href="/chat"
        className="mt-4 w-full py-2 bg-white/5 border border-border-dark text-text-secondary text-xs font-bold rounded-lg hover:text-main transition-all uppercase tracking-widest text-center"
      >
        Open Hub
      </Link>
    </div>
  );
};
