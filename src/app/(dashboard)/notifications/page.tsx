"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import type { Notification } from "@/types";
import {
  getNotificationMeta,
  getNotificationRoute,
  formatRelativeTime,
  isVcNotificationType,
} from "@/lib/notifications";

type NotificationTab =
  | "all"
  | "unread"
  | "tasks"
  | "chat"
  | "calls"
  | "reviews"
  | "version-control"
  | "calendar"
  | "system";

const TABS: { id: NotificationTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "tasks", label: "Tasks" },
  { id: "chat", label: "Chat" },
  { id: "calls", label: "Calls" },
  { id: "reviews", label: "Reviews" },
  { id: "version-control", label: "Version Control" },
  { id: "calendar", label: "Calendar" },
  { id: "system", label: "System" },
];

function NotificationRow({
  n,
  onClick,
}: {
  n: Notification;
  onClick: (n: Notification) => void;
}) {
  const meta = getNotificationMeta(n.type);
  return (
    <div
      onClick={() => onClick(n)}
      className={`flex items-start gap-4 px-6 py-4 cursor-pointer border-b border-border-dark hover:bg-surface-highlight transition-colors ${!n.is_read ? "bg-primary/[0.04]" : ""}`}
    >
      <div
        className={`shrink-0 size-10 rounded-full flex items-center justify-center mt-0.5 ${meta.iconBg}`}
      >
        <span
          className={`material-symbols-outlined text-[20px] ${meta.iconColor}`}
        >
          {meta.icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-snug ${!n.is_read ? "text-main font-semibold" : "text-text-secondary"}`}
        >
          {n.title}
        </p>
        <p className="text-xs text-text-secondary/70 mt-0.5 line-clamp-2">
          {n.content}
        </p>
        <span className="text-[11px] text-text-secondary/50 mt-1.5 block">
          {formatRelativeTime(n.created_at)}
        </span>
      </div>
      {!n.is_read && (
        <span className="shrink-0 size-2 rounded-full bg-primary mt-2"></span>
      )}
    </div>
  );
}

function EmptyStateView({ tab }: { tab: NotificationTab }) {
  const messages: Record<NotificationTab, { icon: string; text: string }> = {
    all: { icon: "notifications_none", text: "You have no notifications" },
    unread: { icon: "mark_email_read", text: "All caught up" },
    tasks: { icon: "assignment", text: "No task notifications" },
    chat: { icon: "chat_bubble_outline", text: "No chat notifications" },
    calls: { icon: "videocam", text: "No call notifications" },
    reviews: { icon: "rate_review", text: "No review notifications" },
    "version-control": {
      icon: "account_tree",
      text: "No version control notifications",
    },
    calendar: { icon: "event", text: "No calendar notifications" },
    system: { icon: "info", text: "No system notifications" },
  };
  const { icon, text } = messages[tab];
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-text-secondary">
      <span className="material-symbols-outlined text-[48px] opacity-30">
        {icon}
      </span>
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const {
    notifications,
    tasks,
    markNotificationAsRead,
    markAllNotificationsAsRead,
  } = useAppContext();
  const { addToast, openModal } = useUIContext();
  const [activeTab, setActiveTab] = useState<NotificationTab>("all");

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  const vcUnreadCount = useMemo(
    () =>
      notifications.filter((n) => !n.is_read && isVcNotificationType(n.type))
        .length,
    [notifications],
  );

  const filteredNotifications = useMemo((): Notification[] => {
    switch (activeTab) {
      case "unread":
        return notifications.filter((n) => !n.is_read);
      case "tasks":
        return notifications.filter((n) => n.type === "assignment");
      case "chat":
        return notifications.filter(
          (n) => n.type === "mention" || n.type === "comment",
        );
      case "calls":
        return notifications.filter((n) =>
          [
            "call_invite",
            "call_reminder",
            "call_summary",
            "meeting_tasks_review",
          ].includes(n.type),
        );
      case "reviews":
        return notifications.filter((n) => n.type === "review");
      case "version-control":
        return notifications.filter((n) => isVcNotificationType(n.type));
      case "calendar":
        return notifications.filter((n) =>
          [
            "calendar_event",
            "calendar_invite",
            "calendar_update",
            "calendar_cancel",
          ].includes(n.type),
        );
      case "system":
        return notifications.filter((n) => n.type === "system");
      default:
        return notifications;
    }
  }, [notifications, activeTab]);

  const handleNotificationClick = (n: Notification) => {
    markNotificationAsRead(n.id);
    if (
      (n.type === "assignment" ||
        n.type === "comment" ||
        n.type === "system") &&
      n.ref_id
    ) {
      const task = tasks.find((t) => t.id === n.ref_id);
      if (task) {
        openModal("task-detail", { task });
        return;
      }
    }
    router.push(getNotificationRoute(n));
  };

  const handleMarkAllRead = () => {
    markAllNotificationsAsRead();
    addToast("All notifications marked as read", "info");
  };

  return (
    <div className="h-full flex flex-col bg-background-dark">
      <div className="px-6 py-5 border-b border-border-dark flex items-center justify-between shrink-0">
        <h1 className="text-xl font-black text-main">Notifications</h1>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="cursor-pointer text-xs font-bold text-primary hover:underline"
          >
            Mark all as read
          </button>
        )}
      </div>

      <div className="px-6 border-b border-border-dark shrink-0 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`cursor-pointer flex items-center gap-1.5 px-4 py-3 text-sm font-bold whitespace-nowrap transition-all border-b-2 ${
              activeTab === tab.id
                ? "text-white border-primary"
                : "text-text-secondary border-transparent hover:text-white"
            }`}
          >
            {tab.label}
            {tab.id === "unread" && unreadCount > 0 && (
              <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-black">
                {unreadCount}
              </span>
            )}
            {tab.id === "version-control" && vcUnreadCount > 0 && (
              <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-black">
                {vcUnreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredNotifications.length === 0 ? (
          <EmptyStateView tab={activeTab} />
        ) : (
          filteredNotifications.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onClick={handleNotificationClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
