"use client";

import React, { useMemo, useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUIContext } from "@/context/UIContext";
import { performManualSignOut } from "@/lib/auth/client-session";
import { Project, User, EmailMessage } from "@/types";
import { useAppContext } from "@/context/AppContext";
import PresenceDot from "@/components/PresenceDot";
import { presenceFromMemberStatus, presenceLabelForMemberStatus, PRESENCE_DND_LABEL } from "@/lib/presence";
import { useCreateProjectGuard } from "@/hooks/useCreateProjectGuard";
import { useWorkspaceBillingPlan } from "@/hooks/useWorkspaceBillingPlan";
import WorkspacePlanBadge from "@/components/billing/WorkspacePlanBadge";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { api } from "@/lib/api";
import { isVcNotificationType } from "@/lib/notifications";
import { applyProjectSelection } from "@/lib/projects/projectSelection";

const SIDEBAR_WIDTH_CLASS = "app-sidebar-shell";

function formatNavBadge(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : String(count);
}

function useClickOutsideTemp(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
) {
  React.useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

function navItemIsActive(pathname: string | null, path: string): boolean {
  if (!pathname) return false;
  if (path === "/email")
    return pathname === "/email" || pathname.startsWith("/email/");
  if (path === "/dashboard") return pathname === "/dashboard";
  return pathname === path || pathname.startsWith(`${path}/`);
}

const EMAIL_FOLDERS = [
  { id: "inbox", label: "Inbox", icon: "inbox" as const },
  { id: "starred", label: "Starred", icon: "star" as const },
  { id: "snoozed", label: "Snoozed", icon: "schedule" as const },
  { id: "sent", label: "Sent", icon: "send" as const },
  { id: "drafts", label: "Drafts", icon: "draft" as const },
];

type SidebarMode =
  | "loading"
  | "no_workspace"
  | "workspace_no_project"
  | "workspace_with_project";

function EmailFolderNav({ inboxUnread }: { inboxUnread: number }) {
  const searchParams = useSearchParams();
  const raw = (searchParams.get("folder") || "inbox").toLowerCase();
  const allowed = new Set(EMAIL_FOLDERS.map((f) => f.id));
  const activeFolder = allowed.has(raw) ? raw : "inbox";
  const inboxBadge = formatNavBadge(inboxUnread);

  return (
    <div className="mt-1 mb-2 space-y-1 ml-2 pl-2 border-l border-white/10">
      {EMAIL_FOLDERS.map((folder) => {
        const isFolderActive = activeFolder === folder.id;
        const badge = folder.id === "inbox" ? inboxBadge : undefined;
        return (
          <Link
            key={folder.id}
            href={`/email?folder=${folder.id}`}
            className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              isFolderActive
                ? "bg-white/10 text-main font-bold"
                : "text-text-secondary hover:text-main hover:bg-surface-highlight font-medium"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[18px] shrink-0 opacity-80">
                {folder.icon}
              </span>
              <span className="truncate">{folder.label}</span>
            </span>
            {badge ? (
              <span
                className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${
                  isFolderActive ? "bg-primary/20 text-primary" : "bg-primary text-white"
                }`}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

interface SidebarProps {
  currentUser?: User;
  projects?: Project[];
  emails?: EmailMessage[];
  selectedProjectId?: string;
  setSelectedProjectId?: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = (props) => {
  const {
    currentUser: contextUser,
    projects: contextProjects,
    selectedProjectId: contextSelectedId,
    selectedWorkspaceId,
    selectedWorkspace,
    workspaces,
    switchWorkspace,
    setSelectedProjectId,
    users,
    setWorkspacePresence,
    isLoading,
    notifications,
  } = useAppContext();

  const currentUser = props.currentUser || contextUser;
  const projects = props.projects || contextProjects;
  const selectedProjectId = props.selectedProjectId || contextSelectedId;

  const pathname = usePathname();
  const router = useRouter();
  const { openModal, addToast, isSidebarOpen, setSidebarOpen } = useUIContext();
  const openCreateProject = useCreateProjectGuard();
  const { planName, planCode, isLoading: isPlanLoading } =
    useWorkspaceBillingPlan(selectedWorkspaceId);
  const handleSignOut = async () => {
    addToast("Logged out successfully", "info");
    await performManualSignOut();
  };

  const [totalUnreadChat, setTotalUnreadChat] = useState(0);
  const [totalUnreadEmail, setTotalUnreadEmail] = useState(0);
  const totalUnreadVc = useMemo(
    () =>
      notifications.filter((n) => !n.is_read && isVcNotificationType(n.type))
        .length,
    [notifications],
  );
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  useClickOutsideTemp(dropdownRef, () => setShowUserDropdown(false));
  useClickOutsideTemp(workspaceDropdownRef, () =>
    setShowWorkspaceDropdown(false),
  );
  useClickOutsideTemp(projectDropdownRef, () => setShowProjectDropdown(false));

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => window.innerWidth < 1024;
    setIsMobile(checkMobile());

    let prevWidth = window.innerWidth;
    const handleResize = () => {
      const currWidth = window.innerWidth;
      setIsMobile(currWidth < 1024);
      if (currWidth < 1024 && prevWidth >= 1024) {
        setSidebarOpen(false);
      } else if (currWidth >= 1024 && prevWidth < 1024) {
        setSidebarOpen(true);
      }
      prevWidth = currWidth;
    };

    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  useEffect(() => {
    if (!selectedWorkspaceId) { setTotalUnreadChat(0); return; }
    let cancelled = false;

    const fetchUnread = () => {
      authenticatedFetch(`/api/chat/conversations?workspaceId=${selectedWorkspaceId}`)
        .then(r => r.ok ? r.json() : null)
        .then((res: { data?: { unread_count?: number }[] } | null) => {
          if (cancelled || !res?.data) return;
          const total = res.data.reduce((sum, c) => sum + Number(c.unread_count ?? 0), 0);
          setTotalUnreadChat(total);
        })
        .catch(() => {});
    };

    fetchUnread();
    window.addEventListener('chatUnreadUpdated', fetchUnread);
    return () => {
      cancelled = true;
      window.removeEventListener('chatUnreadUpdated', fetchUnread);
    };
  }, [selectedWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    const fetchUnreadEmail = () => {
      api.email.accounts
        .status()
        .then((res) => {
          if (cancelled) return;
          setTotalUnreadEmail(Number(res.unreadCount ?? 0));
        })
        .catch(() => {});
    };

    fetchUnreadEmail();
    window.addEventListener("emailUnreadUpdated", fetchUnreadEmail);
    return () => {
      cancelled = true;
      window.removeEventListener("emailUnreadUpdated", fetchUnreadEmail);
    };
  }, [currentUser.id]);

  const validSelectedWorkspace = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      null,
    [selectedWorkspaceId, workspaces],
  );

  const activeProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const displayedProject = activeProject ?? projects[0] ?? null;
  const currentWorkspaceUser = useMemo(
    () => users.find((user) => user.id === currentUser.id),
    [currentUser.id, users],
  );
  const currentPresence = currentWorkspaceUser?.status
    ? presenceFromMemberStatus(currentWorkspaceUser.status)
    : presenceFromMemberStatus(currentUser.status || "Offline");
  const currentStatusLabel = currentWorkspaceUser?.status
    ? presenceLabelForMemberStatus(currentWorkspaceUser.status)
    : presenceLabelForMemberStatus(currentUser.status || "Offline");

  const navItems = useMemo(
    () => [
      { label: "Dashboard", icon: "dashboard", path: "/dashboard" },
      { label: "Tasks", icon: "check_circle", path: "/tasks" },
      { label: "Calendar", icon: "calendar_month", path: "/calendar" },
      { label: "Version Control", icon: "code", path: "/version-control", badge: totalUnreadVc || undefined },
      { label: "Chat", icon: "chat", path: "/chat", badge: totalUnreadChat || undefined },
      {
        label: "Email",
        icon: "mail",
        path: "/email",
        badge: formatNavBadge(totalUnreadEmail),
      },
      { label: "Calls", icon: "videocam", path: "/calls" },
      { label: "Files", icon: "folder", path: "/files" },
      { label: "Analytics", icon: "analytics", path: "/analytics" },
      { label: "Vault", icon: "security", path: "/vault" },
      { label: "Settings", icon: "settings", path: "/settings" },
    ],
    [totalUnreadChat, totalUnreadEmail, totalUnreadVc],
  );

  const sidebarMode = useMemo<SidebarMode>(() => {
    if (isLoading) return "loading";
    if (!validSelectedWorkspace && workspaces.length === 0)
      return "no_workspace";
    if (!validSelectedWorkspace) return "no_workspace";
    if (!activeProject) return "workspace_no_project";
    return "workspace_with_project";
  }, [activeProject, isLoading, validSelectedWorkspace, workspaces.length]);

  const visibleNavItems = useMemo(() => {
    switch (sidebarMode) {
      case "loading":
        return [];
      case "no_workspace":
        return navItems.filter((item) =>
          ["/dashboard", "/calendar", "/email", "/calls", "/settings"].includes(
            item.path,
          ),
        );
      case "workspace_no_project":
        return navItems.filter((item) =>
          [
            "/dashboard",
            "/calendar",
            "/chat",
            "/email",
            "/calls",
            "/files",
            "/settings",
          ].includes(item.path),
        );
      case "workspace_with_project":
        return navItems;
    }
  }, [navItems, sidebarMode]);

  const handleSettings = () => {
    setShowUserDropdown(false);
    router.push("/settings");
  };

  const handleCreatedProject = (project: Project) => {
    applyProjectSelection({
      projectId: project.id,
      workspaceId: selectedWorkspaceId,
      pathname,
      router,
      setSelectedProjectId,
    });
  };

  useEffect(() => {
    if (!showProjectDropdown) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowProjectDropdown(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showProjectDropdown]);

  const renderPrimaryLink = (item: (typeof navItems)[number]) => {
    const isActive = navItemIsActive(pathname, item.path);
    return (
      <Link
        key={item.path}
        href={item.path}
        {...(item.path === "/settings"
          ? { "data-tour": "settings-invite" }
          : {})}
        data-sidebar-nav-item
        className={`cursor-pointer flex items-center gap-3 px-3 py-3 min-h-11 rounded-lg transition-all group ${
          isActive
            ? "bg-primary text-white shadow-lg shadow-primary/20 font-semibold"
            : "text-text-secondary hover:text-main hover:bg-surface-highlight"
        }`}
      >
        <span
          className={`material-symbols-outlined shrink-0 text-[20px] ${isActive ? "fill-1" : ""}`}
        >
          {item.icon}
        </span>
        <span className="text-sm flex-1 truncate">{item.label}</span>
        {!!item.badge && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
              isActive ? "bg-white/20" : "bg-primary text-white"
            }`}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const renderSetupAction = () => {
    if (sidebarMode === "loading") {
      return (
        <div className="px-4 pb-4">
          <div className="h-10 rounded-lg bg-white/5 animate-pulse" />
        </div>
      );
    }

    if (sidebarMode === "no_workspace") {
      return (
        <div className="px-4 pb-4">
          <Link
            href="/settings/workspace?create=1"
            data-tour="create-workspace"
            className="w-full h-10 cursor-pointer flex items-center justify-center gap-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-blue-600 transition-all shadow-lg shadow-primary/20"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Create Workspace</span>
          </Link>
        </div>
      );
    }

    if (sidebarMode === "workspace_no_project") {
      return (
        <div className="px-4 pb-4">
          <button
            type="button"
            data-tour="create-project"
            onClick={() => {
              setShowProjectDropdown(false);
              void openCreateProject({
                onCreated: handleCreatedProject,
              });
            }}
            className="cursor-pointer w-full h-10 flex items-center justify-center gap-2 rounded-lg bg-primary text-white text-sm font-bold hover:bg-blue-600 transition-all shadow-lg shadow-primary/20"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span>Create Project</span>
          </button>
        </div>
      );
    }

    return null;
  };

  const renderNavigation = () => {
    if (sidebarMode === "loading") {
      return (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-10 rounded-lg bg-white/5 animate-pulse"
            />
          ))}
        </div>
      );
    }

    return (
      <>
        {visibleNavItems.map((item) => (
          <div key={item.path} className="space-y-1">
            {renderPrimaryLink(item)}
            {item.path === "/email" && pathname?.startsWith("/email") && (
              <Suspense
                fallback={
                  <div className="ml-2 pl-2 border-l border-white/10 h-36 rounded-lg bg-white/3 animate-pulse" />
                }
              >
                <EmailFolderNav inboxUnread={totalUnreadEmail} />
              </Suspense>
            )}
          </div>
        ))}
      </>
    );
  };

  return (
    <>
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 dismiss-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
    <aside
      data-app-sidebar
      data-sidebar-open={isSidebarOpen ? "true" : "false"}
      className={`bg-sidebar-bg border-r border-border-dark flex flex-col shrink-0 h-full overflow-hidden transition-[width,opacity,min-width] duration-300 ease-in-out ${isMobile && isSidebarOpen ? "fixed inset-y-0 left-0 z-40" : ""} ${
        isSidebarOpen
          ? `${SIDEBAR_WIDTH_CLASS} opacity-100`
          : "w-0 min-w-0 max-w-0 border-none opacity-0 pointer-events-none"
      }`}
    >
      <div
        className={`h-full flex flex-col shrink-0 overflow-hidden ${
          isSidebarOpen ? `${SIDEBAR_WIDTH_CLASS} min-w-full` : "w-0 min-w-0"
        }`}
      >
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <div className="size-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
              <span
                className="material-symbols-outlined text-white text-2xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                layers
              </span>
            </div>
            <div className="relative min-w-0 flex-1" ref={workspaceDropdownRef}>
              <button
                type="button"
                data-tour="sidebar-workspace"
                onClick={() => {
                  setShowWorkspaceDropdown((open) => !open);
                  setShowUserDropdown(false);
                  setShowProjectDropdown(false);
                }}
                className={`w-full cursor-pointer h-11 flex items-center gap-2 px-2.5 rounded-xl border transition-all text-left ${
                  showWorkspaceDropdown
                    ? "bg-white/10 border-white/15"
                    : "bg-surface-dark/60 border-border-dark hover:bg-surface-highlight hover:border-border-dark"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-main truncate">
                    {validSelectedWorkspace?.name ||
                      selectedWorkspace?.name ||
                      "No workspace"}
                  </p>
                  <p className="text-[9px] font-black text-text-secondary uppercase tracking-widest truncate">
                    WORKSPACE
                  </p>
                </div>
                <span
                  className={`material-symbols-outlined text-[18px] text-text-secondary transition-transform shrink-0 ${showWorkspaceDropdown ? "rotate-180" : ""}`}
                >
                  expand_more
                </span>
              </button>

              {showWorkspaceDropdown && (
                <div className="absolute right-0 top-full z-50 mt-2 w-56 bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="p-2 max-h-72 overflow-y-auto custom-scrollbar">
                    {workspaces.length === 0 ? (
                      <div className="px-3 py-4 text-center">
                        <p className="text-sm font-bold text-main">
                          No workspaces yet
                        </p>
                        <p className="text-xs text-text-secondary mt-1">
                          Use Create Workspace to get started.
                        </p>
                      </div>
                    ) : (
                      workspaces.map((workspace) => {
                        const isActive = workspace.id === selectedWorkspaceId;
                        return (
                          <button
                            key={workspace.id}
                            type="button"
                            onClick={() => {
                              if (isActive) {
                                setShowWorkspaceDropdown(false);
                                return;
                              }
                              switchWorkspace(workspace.id);
                              setShowWorkspaceDropdown(false);
                            }}
                            className={`w-full cursor-pointer flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                              isActive
                                ? "bg-primary/10 text-main"
                                : "text-text-secondary hover:text-main hover:bg-surface-highlight"
                            }`}
                          >
                            <span
                              className={`material-symbols-outlined text-[20px] ${isActive ? "text-primary" : "text-text-secondary"}`}
                            >
                              {isActive
                                ? "radio_button_checked"
                                : "radio_button_unchecked"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold truncate">
                                {workspace.name}
                              </span>
                              <span className="block text-[10px] truncate opacity-70">
                                {workspace.slug}
                              </span>
                            </span>
                            {workspace.role && (
                              <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-1 rounded-md bg-white/5 border border-border-dark text-text-secondary">
                                {workspace.role}
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="border-t border-border-dark p-2 space-y-1">
                    <Link
                      href="/settings/workspace?create=1"
                      onClick={() => setShowWorkspaceDropdown(false)}
                      className="cursor-pointer flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-primary hover:bg-primary/10 transition-all"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        add
                      </span>
                      Create Workspace
                    </Link>
                    <Link
                      href="/settings/workspace"
                      onClick={() => setShowWorkspaceDropdown(false)}
                      className="cursor-pointer flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:text-main hover:bg-surface-highlight transition-all"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        settings
                      </span>
                      Workspace Settings
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {renderSetupAction()}

        <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto no-scrollbar">
          {renderNavigation()}
        </nav>

        <div className="p-4 border-t border-border-dark relative">
          {validSelectedWorkspace && projects.length > 0 && (
            <div className="mb-4 relative" ref={projectDropdownRef}>
              <button
                type="button"
                data-tour="sidebar-projects"
                onClick={() => {
                  setShowProjectDropdown((open) => !open);
                  setShowUserDropdown(false);
                  setShowWorkspaceDropdown(false);
                }}
                aria-haspopup="dialog"
                aria-expanded={showProjectDropdown}
                className={`w-full cursor-pointer h-12 flex items-center gap-3 px-3 rounded-xl border transition-all text-left ${
                  showProjectDropdown
                    ? "bg-white/10 border-white/15"
                    : "bg-surface-dark/60 border-border-dark hover:bg-surface-highlight hover:border-border-dark"
                }`}
              >
                <span
                  className={`size-2.5 rounded-full shrink-0 ${displayedProject ? "" : "bg-text-secondary/30"}`}
                  style={
                    displayedProject
                      ? { backgroundColor: displayedProject.color }
                      : undefined
                  }
                />
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-sm font-bold text-main truncate"
                    title={displayedProject?.name ?? "Select a project"}
                  >
                    {displayedProject?.name ?? "Select a project"}
                  </span>
                  <span className="block text-[9px] font-black text-text-secondary uppercase tracking-widest truncate">
                    PROJECT
                  </span>
                </span>
                {displayedProject?.quota_locked && (
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[9px] font-black uppercase tracking-widest text-amber-300 shrink-0">
                    Read-only
                  </span>
                )}
                <span
                  className={`material-symbols-outlined text-[18px] text-text-secondary transition-transform shrink-0 ${showProjectDropdown ? "rotate-180" : ""}`}
                >
                  expand_more
                </span>
              </button>

              {showProjectDropdown && (
                <div
                  role="dialog"
                  aria-label="All projects"
                  className="absolute left-0 right-0 bottom-full z-50 mb-2 bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2 duration-150"
                >
                  <div className="p-2 max-h-72 overflow-y-auto custom-scrollbar">
                    {projects.length === 0 ? (
                      <div className="px-3 py-5 text-center">
                        <p className="text-sm font-bold text-main">
                          No projects yet
                        </p>
                        <p className="text-xs text-text-secondary mt-1">
                          Use Create Project to get started.
                        </p>
                      </div>
                    ) : (
                      projects.map((project) => {
                        const isActive = project.id === activeProject?.id;
                        return (
                          <button
                            key={project.id}
                            type="button"
                            aria-current={isActive ? "true" : undefined}
                            onClick={() => {
                              if (isActive) {
                                setShowProjectDropdown(false);
                                return;
                              }
                              applyProjectSelection({
                                projectId: project.id,
                                workspaceId: selectedWorkspaceId,
                                pathname,
                                router,
                                setSelectedProjectId,
                              });
                              setShowProjectDropdown(false);
                            }}
                            className={`w-full cursor-pointer flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                              isActive
                                ? "bg-primary/10 text-main"
                                : "text-text-secondary hover:text-main hover:bg-surface-highlight"
                            }`}
                          >
                            <span
                              className="size-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: project.color }}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className="block text-sm font-bold truncate"
                                title={project.name}
                              >
                                {project.name}
                              </span>
                              <span className="block text-[10px] truncate opacity-70">
                                {project.quota_locked ? "Read-only" : project.status}
                              </span>
                            </span>
                            {project.quota_locked && (
                              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[9px] font-black uppercase tracking-widest text-amber-300 shrink-0">
                                Locked
                              </span>
                            )}
                            {isActive && (
                              <span className="material-symbols-outlined text-[17px] text-primary shrink-0">
                                check
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <div className="border-t border-border-dark p-2 space-y-1">
                    <Link
                      href="/settings/workspace#projects"
                      onClick={() => setShowProjectDropdown(false)}
                      className="cursor-pointer flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:text-main hover:bg-surface-highlight transition-all"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        settings
                      </span>
                      Project Settings
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {showUserDropdown && (
            <div
              ref={dropdownRef}
              className="absolute bottom-full left-4 right-4 mb-2 bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2 duration-200 z-50"
            >
              <div className="p-2 space-y-1">
                <button
                  onClick={async () => {
                    try {
                      await setWorkspacePresence("online");
                      addToast("Status set to online.", "success");
                      setShowUserDropdown(false);
                    } catch (error: unknown) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : "Failed to update status";
                      addToast(message, "error");
                    }
                  }}
                  className="cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:text-main hover:bg-surface-highlight transition-all"
                >
                  <PresenceDot status="online" />
                  Online
                </button>
                <button
                  onClick={async () => {
                    try {
                      await setWorkspacePresence("away");
                      addToast("Status set to away.", "success");
                      setShowUserDropdown(false);
                    } catch (error: unknown) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : "Failed to update status";
                      addToast(message, "error");
                    }
                  }}
                  className="cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:text-main hover:bg-surface-highlight transition-all"
                >
                  <PresenceDot status="away" />
                  Away
                </button>
                <button
                  onClick={async () => {
                    try {
                      await setWorkspacePresence("offline");
                      addToast("Status set to do not disturb.", "success");
                      setShowUserDropdown(false);
                    } catch (error: unknown) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : "Failed to update status";
                      addToast(message, "error");
                    }
                  }}
                  className="cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:text-main hover:bg-surface-highlight transition-all"
                >
                  <PresenceDot status="offline" />
                  {PRESENCE_DND_LABEL}
                </button>
                <div className="h-px bg-white/5 mx-2"></div>
                <button
                  onClick={handleSettings}
                  className="cursor-pointer w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-text-secondary hover:text-main hover:bg-surface-highlight transition-all"
                >
                  <span className="material-symbols-outlined">settings</span>
                  Account Settings
                </button>
                <div className="h-px bg-white/5 mx-2"></div>
                <button
                  onClick={handleSignOut}
                  className="w-full cursor-pointer flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <span className="material-symbols-outlined">logout</span>
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {validSelectedWorkspace &&
            sidebarMode === "workspace_with_project" && (
              <button
                onClick={() => {
                  setShowProjectDropdown(false);
                  void openCreateProject({
                    onCreated: handleCreatedProject,
                  });
                }}
                className="w-full cursor-pointer flex items-center justify-center gap-2 bg-surface-highlight hover:bg-white/10 text-main rounded-lg h-10 px-4 text-sm font-bold transition-all border border-border-dark mb-4"
              >
                <span className="material-symbols-outlined text-[18px]">
                  add
                </span>
                <span>Create Project</span>
              </button>
            )}
          <div
            onClick={() => {
              setShowUserDropdown(!showUserDropdown);
              setShowProjectDropdown(false);
            }}
            className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors group ${showUserDropdown ? "bg-white/10" : "hover:bg-surface-highlight"}`}
          >
            <div
              className="relative size-9 rounded-full bg-cover border-2 border-border-dark group-hover:border-primary transition-colors shrink-0"
              style={{ backgroundImage: `url(${currentUser.avatar})` }}
            >
              <div className="absolute -bottom-0.5 -right-0.5">
                <PresenceDot
                  ring
                  status={currentPresence}
                  title={`${currentStatusLabel} in ${selectedWorkspace?.name ?? "this workspace"}`}
                />
              </div>
            </div>
            <div className="flex flex-col min-w-0 flex-1 gap-0.5">
              <span
                className="text-sm font-bold text-main truncate"
                title={currentUser.name}
              >
                {currentUser.name}
              </span>
              {isPlanLoading ? (
                <span
                  className="inline-block h-5 w-14 rounded-lg bg-white/5 animate-pulse self-start"
                  aria-hidden
                />
              ) : planName && planCode ? (
                <WorkspacePlanBadge
                  planName={planName}
                  planCode={planCode}
                  className="self-start"
                />
              ) : null}
            </div>
            <span
              className={`material-symbols-outlined text-text-secondary shrink-0 transition-transform ${showUserDropdown ? "rotate-180" : ""}`}
            >
              unfold_more
            </span>
          </div>
        </div>
      </div>
    </aside>
    </>
  );
};

export default Sidebar;
