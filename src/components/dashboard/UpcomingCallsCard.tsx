"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { CallSessionRow } from "@/types/calls";

interface UpcomingCallsCardProps {
  workspaceId: string;
  className?: string;
}

export function UpcomingCallsCard({
  workspaceId,
  className = "",
}: UpcomingCallsCardProps) {
  const [calls, setCalls] = useState<CallSessionRow[]>([]);

  useEffect(() => {
    api.calls
      .list(workspaceId, "scheduled")
      .then((list) => {
        const today = new Date().toDateString();
        setCalls(
          list.filter((c) => {
            if (!c.scheduled_start_at) return false;
            return new Date(c.scheduled_start_at).toDateString() === today;
          }),
        );
      })
      .catch(() => setCalls([]));
  }, [workspaceId]);

  return (
    <div
      className={`bg-surface-dark border border-border-dark rounded-2xl p-5 flex flex-col ${className}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white">Upcoming calls today</h3>
        <Link href="/calls" className="text-xs text-primary font-bold">
          All calls
        </Link>
      </div>
      {calls.length === 0 ? (
        <p className="text-xs text-text-secondary">No calls scheduled today.</p>
      ) : (
        <ul className="space-y-2">
          {calls.map((c) => (
            <li key={c.id}>
              <Link
                href={`/calls/${c.id}`}
                className="text-sm text-white hover:text-primary block"
              >
                {c.title}
              </Link>
              <p className="text-xs text-text-secondary">
                {c.scheduled_start_at
                  ? new Date(c.scheduled_start_at).toLocaleTimeString()
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
