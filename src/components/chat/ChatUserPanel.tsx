"use client";

import React, { useEffect } from "react";
import type { User } from "@/types";
import PresenceDot from "@/components/PresenceDot";
import { presenceFromMemberStatus, PRESENCE_DND_LABEL } from "@/lib/presence";

interface ChatUserPanelProps {
  userId: string;
  users: User[];
  fallbackName?: string;
  fallbackAvatar?: string;
  currentUserId?: string;
  onClose: () => void;
  onMessageUser?: (userId: string) => void;
}

function presenceLabel(status: string): string {
  if (status === PRESENCE_DND_LABEL) return PRESENCE_DND_LABEL;
  const presence = presenceFromMemberStatus(status);
  if (presence === "online") return "Active now";
  if (presence === "away") return "Away";
  if (presence === "invited") return "Invited";
  return "Offline";
}

export function ChatUserPanel({
  userId,
  users,
  fallbackName,
  fallbackAvatar,
  currentUserId,
  onClose,
  onMessageUser,
}: ChatUserPanelProps) {
  const user = users.find((u) => u.id === userId);
  const displayName = user?.name || fallbackName || "Unknown user";
  const avatar =
    user?.avatar ||
    fallbackAvatar ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1e293b&color=e2e8f0`;
  const presence = user ? presenceFromMemberStatus(user.status) : "offline";
  const isSelf = currentUserId === userId;
  const canMessage = Boolean(user && onMessageUser && !isSelf);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="flex h-full w-full md:w-[380px] shrink-0 flex-col border-l border-border-dark bg-background-dark">
      <header className="flex items-center justify-between shrink-0 border-b border-border-dark px-4 py-3 bg-surface-dark/50">
        <h3 className="text-sm font-bold text-white">Profile</h3>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
          title="Close profile"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatar}
              alt={displayName}
              className="size-24 rounded-2xl border border-border-dark bg-slate-700 object-cover"
            />
            {user && (
              <div className="absolute -bottom-1 -right-1">
                <PresenceDot status={presence} ring size="md" />
              </div>
            )}
          </div>

          <h4 className="mt-4 text-lg font-bold text-white">{displayName}</h4>

          {user ? (
            <>
              <div className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
                <PresenceDot status={presence} />
                <span>{presenceLabel(user.status)}</span>
              </div>
              {user.role && (
                <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-primary/80">
                  {user.role}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-text-secondary">
              External or guest sender — limited profile details available.
            </p>
          )}
        </div>

        {user && (
          <div className="mt-8 space-y-4">
            {user.email && (
              <div className="rounded-xl border border-border-dark bg-surface-dark/50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                  Email
                </p>
                <p className="mt-1 text-sm text-white break-all">{user.email}</p>
              </div>
            )}
            {user.role && (
              <div className="rounded-xl border border-border-dark bg-surface-dark/50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                  Role
                </p>
                <p className="mt-1 text-sm text-white capitalize">{user.role}</p>
              </div>
            )}
          </div>
        )}

        {canMessage && (
          <button
            type="button"
            onClick={() => onMessageUser?.(userId)}
            className="cursor-pointer mt-8 w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-600 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
            Message
          </button>
        )}
      </div>
    </div>
  );
}
