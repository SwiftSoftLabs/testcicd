"use client";

import React, { useState, useRef, useMemo, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import Link from "next/link";
import { Notification } from "@/types";
import GlobalSearch from "@/components/search/GlobalSearch";
import WorkspaceSyncIndicator from "@/components/WorkspaceSyncIndicator";
import { HeaderAppearanceControls } from "@/components/appearance/HeaderAppearanceControls";
import {
  getNotificationMeta,
  getNotificationDateGroup,
  getNotificationRoute,
} from "@/lib/notifications";

interface HeaderProps {
  notifications?: Notification[];
  markNotificationAsRead?: (id: string) => void;
  markAllNotificationsAsRead?: () => void;
}

const Header: React.FC<HeaderProps> = (props) => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    addToast,
    isSidebarOpen,
    toggleSidebar,
    openModal,
    globalSearchOpen,
    globalSearchQuery,
    openGlobalSearch,
    closeGlobalSearch,
  } = useUIContext();
  const {
    currentUser,
    notifications: contextNotifications,
    markNotificationAsRead: contextMarkRead,
    markAllNotificationsAsRead: contextMarkAllRead,
    selectedWorkspaceId,
    tasks,
    users,
    projects,
    commits,
    pullRequests,
  } = useAppContext();

  const notifications = props.notifications || contextNotifications || [];
  const markNotificationAsRead =
    props.markNotificationAsRead || contextMarkRead;
  const markAllNotificationsAsRead =
    props.markAllNotificationsAsRead || contextMarkAllRead;

  const [showNotifications, setShowNotifications] = useState(false);

  const notificationRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  useClickOutside(searchWrapperRef, () => closeGlobalSearch());

  // Close notifications on outside click
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (
        notificationRef.current &&
        !notificationRef.current.contains(e.target as Node)
      ) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openGlobalSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openGlobalSearch]);

  const getTitle = () => {
    const path = pathname?.split("/")[1];
    if (!path) return "Overview";
    if (path === "version-control") return "Version Control";
    return path.charAt(0).toUpperCase() + path.slice(1).replace("-", " ");
  };

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  const groupedDropdownNotifications = useMemo(() => {
    const groups: Array<{
      label: "Today" | "Yesterday" | "Earlier";
      items: Notification[];
    }> = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Earlier", items: [] },
    ];
    for (const n of notifications.slice(0, 8)) {
      const group = groups.find(
        (g) => g.label === getNotificationDateGroup(n.created_at),
      );
      group?.items.push(n);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [notifications]);

  const handleMarkAllRead = (e: React.MouseEvent) => {
    e.stopPropagation();
    markAllNotificationsAsRead();
    addToast("All notifications marked as read", "info");
  };

  const handleNotificationClick = (n: Notification) => {
    markNotificationAsRead(n.id);
    setShowNotifications(false);
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

  const openSearch = () => {
    openGlobalSearch();
  };

  return (
    <div ref={searchWrapperRef} className="contents">
      <header
        data-dashboard-header
        className="flex h-[var(--shell-header-height)] min-h-[var(--shell-header-height)] flex-shrink-0 items-center justify-between border-b border-border-dark bg-background-dark/80 px-6 backdrop-blur-md z-30 transition-[height,min-height] duration-200 ease-out"
      >
        <div className="flex items-center flex-1 max-w-2xl">
          <button
            type="button"
            onClick={toggleSidebar}
            className="app-header-icon-btn cursor-pointer mr-4 shrink-0 rounded-lg border border-border-dark bg-white/5 text-text-secondary transition-colors hover:bg-white/10 hover:text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title="Toggle Sidebar"
            aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={isSidebarOpen}
          >
            <span className="material-symbols-outlined">
              {isSidebarOpen ? "menu_open" : "menu"}
            </span>
          </button>
          <h2 className="text-lg font-bold text-main hidden md:block shrink-0 mr-6">
            {getTitle()}
          </h2>

          {/* Search trigger */}
          <button
            onClick={openSearch}
            className="cursor-pointer relative flex-1 group hidden md:flex items-center bg-surface-dark border border-border-dark text-text-secondary/50 text-sm rounded-lg pl-10 pr-12 py-2 hover:border-primary/50 transition-all text-left"
          >
            <span className="absolute left-3 material-symbols-outlined text-text-secondary group-hover:text-primary transition-colors text-[20px]">
              search
            </span>
            <span className="flex-1 text-sm text-text-secondary/50 truncate">
              {"Search tasks, code, or members..."}
            </span>
            <span className="absolute right-3 bg-[#2b3648] text-text-secondary text-[10px] px-1.5 py-0.5 rounded border border-border-dark opacity-40">
              ⌘K
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1 ml-4 shrink-0">
          <HeaderAppearanceControls />

          <button
            onClick={() => router.push("/support")}
            className="cursor-pointer p-2 text-text-secondary hover:text-main transition-colors"
            title="Support"
          >
            <span className="material-symbols-outlined text-[22px]">
              help
            </span>
          </button>

          <WorkspaceSyncIndicator />

          <div className="relative" ref={notificationRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="cursor-pointer p-2 text-text-secondary hover:text-main transition-colors relative"
              title="Notifications"
            >
              <span className="material-symbols-outlined text-[22px]">
                notifications
              </span>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 border-2 border-background-dark text-[9px] font-black text-white flex items-center justify-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-surface-dark border border-border-dark rounded-xl shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden">
                <div className="p-4 border-b border-border-dark flex justify-between items-center">
                  <span className="font-bold text-sm text-main">
                    Notifications
                  </span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="cursor-pointer text-[10px] text-primary font-bold uppercase hover:underline"
                    >
                      Mark all as read
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length > 0 ? (
                    groupedDropdownNotifications.map((group) => (
                      <div key={group.label}>
                        <div className="px-4 py-1.5 bg-surface-dark border-b border-border-dark/50 sticky top-0 z-10">
                          <span className="text-[9px] font-black uppercase tracking-widest text-text-secondary">
                            {group.label}
                          </span>
                        </div>
                        {group.items.map((n) => {
                          const meta = getNotificationMeta(n.type);
                          return (
                            <div
                              key={n.id}
                              onClick={() => handleNotificationClick(n)}
                              className={`flex items-start gap-3 px-4 py-3 hover:bg-white/5 cursor-pointer border-b border-border-dark last:border-0 ${!n.is_read ? "bg-primary/5" : ""}`}
                            >
                              <div
                                className={`shrink-0 size-8 rounded-full flex items-center justify-center mt-0.5 ${meta.iconBg}`}
                              >
                                <span
                                  className={`material-symbols-outlined text-[16px] ${meta.iconColor}`}
                                >
                                  {meta.icon}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`text-xs leading-snug truncate ${!n.is_read ? "text-main font-semibold" : "text-text-secondary"}`}
                                >
                                  {n.title}
                                </p>
                                <p className="text-[10px] text-text-secondary/70 truncate mt-0.5">
                                  {n.content}
                                </p>
                                <span className="text-[9px] text-text-secondary/50 mt-1 block">
                                  {new Date(n.created_at).toLocaleTimeString(
                                    [],
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                </span>
                              </div>
                              {!n.is_read && (
                                <span className="shrink-0 size-1.5 rounded-full bg-primary mt-1.5"></span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  ) : (
                    <div className="p-8 text-center text-text-secondary text-xs">
                      No notifications
                    </div>
                  )}
                </div>
                <div className="border-t border-border-dark p-3">
                  <Link
                    href="/notifications"
                    onClick={() => setShowNotifications(false)}
                    className="cursor-pointer block w-full text-center text-[11px] font-bold text-primary hover:underline py-1"
                  >
                    View all notifications
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {globalSearchOpen && (
        <GlobalSearch
          initialQuery={globalSearchQuery}
          workspaceId={selectedWorkspaceId ?? ""}
          tasks={tasks}
          users={users}
          projects={projects}
          commits={commits ?? []}
          pullRequests={pullRequests ?? []}
          onClose={closeGlobalSearch}
        />
      )}
    </div>
  );
};

export default Header;
