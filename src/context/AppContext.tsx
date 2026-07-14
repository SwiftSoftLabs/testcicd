"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { showBrowserNotification, requestNotificationPermission } from "@/lib/browser-notifications";
import type {
  User,
  Commit,
  PullRequest,
  DiffFile,
  Project,
  Workspace,
  Team,
  Task,
  Notification,
  NotificationPreferences,
  Sprint,
  WorkspaceUserSettings,
} from "@/types";
import type { CalendarDTO, CalendarEventDTO } from "@/types/calendar";
import { createClient } from "@/lib/insforge/client";
import { insforgeNative } from "@/lib/insforge/native";
import { api } from "@/lib/api";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { presenceDbToMemberStatus, PRESENCE_DND_LABEL } from "@/lib/presence";
import type { PermissionKey } from "@/lib/rbac/permissions";
import { usePresence } from "@/hooks/usePresence";
import {
  useRealtimeConnection,
  type WorkspaceSyncStatus,
} from "@/hooks/useRealtimeConnection";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/constants/notification-preferences";
import { SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/auth/access-token-cookie";
import {
  ensureFreshAccessToken,
  SESSION_EXPIRED_EVENT,
  syncAccessTokenCookieFromStorage,
} from "@/lib/auth/client-session";
import { useSessionKeepAlive } from "@/hooks/useSessionKeepAlive";
import { normalizeFontSizeStep } from "@/lib/appearance/options";
import { APP_SETTINGS_STORAGE_KEY } from "@/lib/theme";

export type ThemeType = "light" | "dark" | "system";
export type DensityType = "comfortable" | "compact";
export type { WorkspaceSyncStatus };

type JsonRecord = Record<string, unknown>;

interface TaskApiRecord {
  id: string;
  task_key?: string | null;
  task_number?: number | null;
  title: string;
  description: string;
  status: Task["status"];
  priority: Task["priority"];
  assignee_id: string | null;
  project_id: string | null;
  tags?: string[] | null;
  due_date?: string | null;
  parent_task_id?: string | null;
  sprint_id?: string | null;
  estimated_hours?: number | string | null;
  subtask_count?: number | null;
  subtask_done_count?: number | null;
  comments_count?: number | null;
  attachment_count?: number | null;
  source_call_id?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  source?: 'local' | 'plugin' | null;
  source_plugin_provider?: string | null;
}

interface WorkspaceMemberApiRow {
  id: string;
  name?: string;
  avatar?: string;
  role?: string;
  email?: string;
  status?: string;
}

interface NativeUser {
  id: string;
  email?: string;
  profile?: { name?: string };
}

interface ProfileApiResponse {
  id: string;
  full_name?: string;
  email?: string;
  role?: string;
  avatar_url?: string;
  status?: string;
  onboarding_type?: "creator" | "joiner";
  pending_join_notification?: string | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUUID(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

export interface AppSettings {
  developerMode: boolean;
  compactDensity: boolean;
  layoutDensity: DensityType;
  theme: ThemeType;
  fontSize: number; // 0-100 scale
  showOfflineStatus: boolean;
  quickTaskbarPinned: boolean;
}

type GlobalAppSettings = Pick<
  AppSettings,
  "compactDensity" | "layoutDensity" | "theme" | "fontSize"
>;

interface AppContextType {
  currentUser: User;
  appSettings: AppSettings;
  pullRequests: PullRequest[];
  commits: Commit[];
  projects: Project[];
  users: User[];
  teams: Team[];
  tasks: Task[];
  notifications: Notification[];
  notificationPreferences: NotificationPreferences;
  sprints: Sprint[];
  calendars: CalendarDTO[];
  nativeEvents: CalendarEventDTO[];
  projectSprints: Sprint[];
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  selectedProjectId: string | null;
  selectedWorkspaceId: string | null;
  selectedSprintId: string | null;
  workspaceSyncStatus: WorkspaceSyncStatus;
  isLoading: boolean;
  projectsSettled: boolean;
  updateCurrentUser: (updates: Partial<User>) => void;
  updateAppSettings: (updates: Partial<AppSettings>) => void;
  applyAppearanceSettings: (
    updates: Partial<Pick<AppSettings, "theme" | "layoutDensity" | "fontSize">>,
  ) => void;
  saveSettingsToDb?: (settings: AppSettings) => Promise<void>;
  setWorkspacePresence: (
    status: "online" | "away" | "offline",
  ) => Promise<void>;
  mergePullRequest: (id: string) => void;
  addPRComment: (
    prId: string,
    filename: string,
    lineNumber: number,
    content: string,
  ) => void;
  addProject: (project: Omit<Project, "id">) => Promise<Project | null>;
  updateProject: (project: Project) => void;
  addPullRequest: (
    pr: Omit<
      PullRequest,
      | "id"
      | "project_id"
      | "author_id"
      | "created_at"
      | "is_open"
      | "commits_count"
      | "files_changed_count"
    >,
  ) => void;
  sendChatMessage: (conversationId: string, content: string) => Promise<void>;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedWorkspaceId: (id: string | null) => void;
  switchWorkspace: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  addTask: (task: Omit<Task, "id">) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<Task | void>;
  patchTaskLocal: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => Promise<void>;
  duplicateTask: (id: string) => Promise<void>;
  bulkUpdateTasks: (ids: string[], updates: Partial<Task>) => Promise<void>;
  getTaskActivities: (id: string) => Promise<JsonRecord[]>;
  addTaskActivity: (
    id: string,
    content: string,
    type?: string,
  ) => Promise<JsonRecord>;
  updateTaskActivity: (taskId: string, activityId: string, content: string) => Promise<void>;
  deleteTaskActivity: (taskId: string, activityId: string) => Promise<void>;
  fetchSprints: () => Promise<void>;
  fetchCalendars: () => Promise<void>;
  fetchNativeEvents: () => Promise<void>;
  createSprint: (data: Partial<Sprint>) => Promise<Sprint | null>;
  completeSprint: (
    id: string,
    action: "backlog" | "next-sprint",
    nextSprintId?: string,
  ) => Promise<void>;
  updateSprint: (id: string, data: Partial<Sprint>) => Promise<void>;
  setSelectedSprintId: (id: string | null) => void;
  fetchNotifications: () => Promise<void>;
  fetchNotificationPreferences: () => Promise<void>;
  updateNotificationPreferences: (
    updates: Partial<NotificationPreferences>,
  ) => Promise<void>;
  markNotificationAsRead: (id: string) => Promise<void>;
  markAllNotificationsAsRead: () => Promise<void>;
  pendingJoinNotification: string | null;
  clearPendingJoinNotification: () => Promise<void>;
  workspacePermissions: PermissionKey[];
  workspacePermissionsLoading: boolean;
  workspaceRoleLabel: string | null;
  workspaceIsOwner: boolean;
  canWorkspace: (permission: PermissionKey) => boolean;
  refreshWorkspacePermissions: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
const DEFAULT_APP_SETTINGS: AppSettings = {
  developerMode: false,
  compactDensity: false,
  layoutDensity: "comfortable",
  theme: "dark",
  fontSize: 50,
  showOfflineStatus: true,
  quickTaskbarPinned: true,
};

function readGlobalAppSettings(): GlobalAppSettings {
  if (typeof window === "undefined") {
    return {
      compactDensity: DEFAULT_APP_SETTINGS.compactDensity,
      layoutDensity: DEFAULT_APP_SETTINGS.layoutDensity,
      theme: DEFAULT_APP_SETTINGS.theme,
      fontSize: DEFAULT_APP_SETTINGS.fontSize,
    };
  }

  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        compactDensity: DEFAULT_APP_SETTINGS.compactDensity,
        layoutDensity: DEFAULT_APP_SETTINGS.layoutDensity,
        theme: DEFAULT_APP_SETTINGS.theme,
        fontSize: DEFAULT_APP_SETTINGS.fontSize,
      };
    }

    const parsed = JSON.parse(raw) as Partial<GlobalAppSettings>;
    return {
      compactDensity:
        typeof parsed.compactDensity === "boolean"
          ? parsed.compactDensity
          : DEFAULT_APP_SETTINGS.compactDensity,
      layoutDensity:
        parsed.layoutDensity === "compact" ||
        parsed.layoutDensity === "comfortable"
          ? parsed.layoutDensity
          : DEFAULT_APP_SETTINGS.layoutDensity,
      theme:
        parsed.theme === "light" ||
        parsed.theme === "dark" ||
        parsed.theme === "system"
          ? parsed.theme
          : DEFAULT_APP_SETTINGS.theme,
      fontSize:
        typeof parsed.fontSize === "number"
          ? parsed.fontSize
          : DEFAULT_APP_SETTINGS.fontSize,
    };
  } catch {
    return {
      compactDensity: DEFAULT_APP_SETTINGS.compactDensity,
      layoutDensity: DEFAULT_APP_SETTINGS.layoutDensity,
      theme: DEFAULT_APP_SETTINGS.theme,
      fontSize: DEFAULT_APP_SETTINGS.fontSize,
    };
  }
}

function persistGlobalAppSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;

  const globalSettings: GlobalAppSettings = {
    compactDensity: settings.compactDensity,
    layoutDensity: settings.layoutDensity,
    theme: settings.theme,
    fontSize: settings.fontSize,
  };

  localStorage.setItem(
    APP_SETTINGS_STORAGE_KEY,
    JSON.stringify(globalSettings),
  );
}

const MOCK_DIFFS: DiffFile[] = [
  {
    filename: "src/controllers/UserController.ts",
    status: "modified",
    additions: 3,
    deletions: 1,
    lines: [
      {
        number: 10,
        content: "  async getUser(id: string) {",
        type: "normal",
        comments: [],
      },
      {
        number: 11,
        content: "-   const user = await db.users.find(id);",
        type: "deletion",
        comments: [],
      },
      {
        number: 12,
        content: "+   const cacheKey = `user:${id}`;",
        type: "addition",
        comments: [],
      },
      {
        number: 13,
        content: "+   const cached = await redis.get(cacheKey);",
        type: "addition",
        comments: [],
      },
      {
        number: 14,
        content: "+   if (cached) return JSON.parse(cached);",
        type: "addition",
        comments: [],
      },
      { number: 15, content: "    return user;", type: "normal", comments: [] },
    ],
  },
];

function getProfileName(user: unknown): string | undefined {
  const u = user as { profile?: { name?: string } } | null;
  return u?.profile?.name;
}

function getAuthToken(): string | null {
  // Try multiple sources for the access token
  if (typeof window === "undefined") return null;

  // 1. Check cookie (set during login)
  const cookieToken = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith("sb-access-token="))
    ?.split("=")[1];
  if (cookieToken) return cookieToken;

  // 2. Check localStorage (set during login)
  const storageKey = `sb-${new URL(window.location.href).hostname}-auth-token`;
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const session = JSON.parse(stored);
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  // 3. Try native SDK token manager (OAuth case)
  const auth = insforgeNative.auth as unknown as {
    tokenManager?: { getAccessToken?: () => string | null };
  };
  return auth.tokenManager?.getAccessToken?.() ?? null;
}

function mapTaskRecord(task: unknown): Task {
  const t = task as TaskApiRecord;
  return {
    id: t.id,
    taskKey: t.task_key ?? undefined,
    taskNumber: t.task_number ?? undefined,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assignee_id ?? "",
    projectId: t.project_id,
    tags: t.tags || [],
    commentsCount: t.comments_count || 0,
    dueDate: t.due_date ?? undefined,
    parentTaskId: t.parent_task_id ?? undefined,
    sprintId: t.sprint_id ?? undefined,
    estimatedHours:
      t.estimated_hours != null ? Number(t.estimated_hours) : undefined,
    subtaskCount: t.subtask_count || 0,
    subtaskDoneCount: t.subtask_done_count || 0,
    attachmentCount: t.attachment_count || 0,
    sourceCallId: t.source_call_id ?? undefined,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    completedAt: t.completed_at ?? undefined,
    source: t.source === 'plugin' ? 'plugin' : 'local',
    sourceProvider:
      t.source === 'plugin' && t.source_plugin_provider
        ? (t.source_plugin_provider as Task['sourceProvider'])
        : undefined,
  };
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const insforge = React.useMemo(() => createClient(), []);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User>({
    id: "",
    name: "",
    role: "",
    email: "",
    avatar: "",
    status: "",
    onboarding_type: "creator",
  });
  const [pendingJoinNotification, setPendingJoinNotification] = useState<
    string | null
  >(null);
  const [appSettings, setAppSettings] =
    useState<AppSettings>(DEFAULT_APP_SETTINGS);

  const [commits, setCommits] = useState<Commit[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const notificationPreferencesRef = useRef<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  useEffect(() => { notificationPreferencesRef.current = notificationPreferences; }, [notificationPreferences]);
  const permissionRequestedRef = useRef(false);
  const isFetchingUsersRef = useRef(false);
  const presenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const presenceActivatedRef = useRef(false);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [calendars, setCalendars] = useState<CalendarDTO[]>([]);
  const [nativeEvents, setNativeEvents] = useState<CalendarEventDTO[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [workspaceSyncStatus, setWorkspaceSyncStatus] =
    useState<WorkspaceSyncStatus>("offline");
  const [projectsSettled, setProjectsSettled] = useState(false);
  const [workspacePermissions, setWorkspacePermissions] = useState<PermissionKey[]>([]);
  const [workspacePermissionsLoading, setWorkspacePermissionsLoading] = useState(false);
  const [workspaceRoleLabel, setWorkspaceRoleLabel] = useState<string | null>(null);
  const [workspaceIsOwner, setWorkspaceIsOwner] = useState(false);
  const selectedWorkspaceIdRef = React.useRef<string | null>(null);

  const getIsManualPresence = useCallback(() => {
    const wsUser = users.find((user) => user.id === currentUser.id);
    const status = wsUser?.status;
    return status === "Away" || status === PRESENCE_DND_LABEL;
  }, [users, currentUser.id]);

  usePresence(currentUser.id, getIsManualPresence);

  useSessionKeepAlive(Boolean(currentUser.id), "app");

  const realtimeEnabled = Boolean(
    currentUser.id && selectedWorkspaceId && isUUID(selectedWorkspaceId),
  );
  useRealtimeConnection(realtimeEnabled, setWorkspaceSyncStatus);

  const selectedWorkspace = React.useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
      null,
    [workspaces, selectedWorkspaceId],
  );

  const projectSprints = React.useMemo(
    () =>
      sprints.filter(
        (s) =>
          !s.project_id ||
          !selectedProjectId ||
          s.project_id === selectedProjectId,
      ),
    [sprints, selectedProjectId],
  );

  const saveSettingsToDb = useCallback(
    async (settings: AppSettings) => {
      persistGlobalAppSettings(settings);

      if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) {
        return;
      }

      await api.workspaceSettings.update(selectedWorkspaceId, {
        developerMode: settings.developerMode,
        showOfflineStatus: settings.showOfflineStatus,
        quickTaskbarPinned: settings.quickTaskbarPinned,
      });
    },
    [selectedWorkspaceId],
  );

  const clearWorkspaceScopedState = useCallback(() => {
    setProjectsSettled(false);
    setProjects([]);
    setTasks([]);
    setUsers([]);
    setSprints([]);
    setCalendars([]);
    setNativeEvents([]);
    setCommits([]);
    setPullRequests([]);
    setSelectedProjectId(null);
    setSelectedSprintId(null);
    setWorkspacePermissions([]);
    setWorkspaceRoleLabel(null);
    setWorkspaceIsOwner(false);
    setWorkspacePermissionsLoading(false);
  }, []);

  const canWorkspace = useCallback(
    (permission: PermissionKey) =>
      workspaceIsOwner || workspacePermissions.includes(permission),
    [workspaceIsOwner, workspacePermissions],
  );

  async function fetchWorkspacePermissions() {
    if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) {
      setWorkspacePermissions([]);
      setWorkspaceRoleLabel(null);
      setWorkspaceIsOwner(false);
      setWorkspacePermissionsLoading(false);
      return;
    }
    const workspaceId = selectedWorkspaceId;
    setWorkspacePermissionsLoading(true);
    try {
      const res = await api.rbac.getMyPermissions(workspaceId);
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      setWorkspacePermissions(res.data.permissions as PermissionKey[]);
      setWorkspaceRoleLabel(res.data.roleLabel);
      setWorkspaceIsOwner(res.data.isOwner);
    } catch {
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      setWorkspacePermissions([]);
      setWorkspaceRoleLabel(null);
      setWorkspaceIsOwner(false);
    } finally {
      if (selectedWorkspaceIdRef.current === workspaceId) {
        setWorkspacePermissionsLoading(false);
      }
    }
  }

  const refreshWorkspacePermissions = useCallback(async () => {
    await fetchWorkspacePermissions();
  }, [selectedWorkspaceId]);

  const stableFetchWorkspacePermissions = useCallback(fetchWorkspacePermissions, [
    selectedWorkspaceId,
  ]);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  // Using function declarations to avoid ReferenceErrors due to hoisting issues in Turbopack
  async function fetchProfile() {
    try {
      // Fast-path 1: localStorage — set during email/password login
      const stored =
        typeof window !== "undefined"
          ? localStorage.getItem("ow-current-user")
          : null;
      const storedUser = stored ? JSON.parse(stored) : null;

      // Fast-path 2: @insforge/sdk native getCurrentUser()
      // SDK stores session automatically including after OAuth callback.
      const { data: nativeData } = await insforgeNative.auth
        .getCurrentUser()
        .catch(() => ({ data: { user: null } }));
      const nativeUser = nativeData?.user as NativeUser | null | undefined;

      // Determine userId: prioritize native SDK (handles OAuth), fallback to localStorage
      const userId = nativeUser?.id || storedUser?.id;

      if (!userId) return;

      // Sync session if native user found (OAuth case) but localStorage/cookie not yet set
      if (nativeUser) {
        const name =
          getProfileName(nativeUser) ||
          nativeUser.email?.split("@")[0] ||
          "User";

        // Update localStorage
        if (!storedUser) {
          localStorage.setItem(
            "ow-current-user",
            JSON.stringify({
              id: nativeUser.id,
              email: nativeUser.email,
              name,
            }),
          );
        }

        // Sync access token to cookie when missing or stale (API auth uses cookie only)
        await syncAccessTokenCookieFromStorage();
        const hasCookie = document.cookie.includes("sb-access-token=");
        if (!hasCookie) {
          const accessToken = getAuthToken();

          if (accessToken) {
            document.cookie = `sb-access-token=${accessToken}; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
            document.cookie = `ow-session=1; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
            await authenticatedFetch("/api/auth/sync-cookie", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accessToken }),
            }).catch(() => {});
          }
        }
      }

      // Set user from best available data
      const displayName =
        getProfileName(nativeUser) ||
        storedUser?.name ||
        nativeUser?.email?.split("@")[0] ||
        "User";
      setCurrentUser((prev) => ({
        ...prev,
        id: userId,
        name: displayName,
        email: nativeUser?.email || storedUser?.email || "",
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`,
      }));

      // Fetch full profile from app_onework.profiles via API route
      const res = await authenticatedFetch(`/api/profile/me?userId=${userId}`);
      if (res.status === 401) return;
      if (res.ok) {
        const { data: profile } = (await res.json()) as {
          data?: ProfileApiResponse;
        };
        if (profile) {
          setCurrentUser({
            id: profile.id,
            name: profile.full_name || displayName,
            email:
              profile.email || nativeUser?.email || storedUser?.email || "",
            role: profile.role || "member",
            avatar:
              profile.avatar_url ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.full_name || "U")}&background=random`,
            status: "online",
            onboarding_type: profile.onboarding_type ?? "creator",
          });
          if (profile.pending_join_notification) {
            setPendingJoinNotification(profile.pending_join_notification);
          }
          if (!presenceActivatedRef.current) {
            presenceActivatedRef.current = true;
            try {
              await authenticatedFetch("/api/profile/presence/activate", {
                method: "POST",
              });
              setUsers((prev) =>
                prev.map((user) =>
                  user.id === profile.id ? { ...user, status: "Active" } : user,
                ),
              );
            } catch {
              presenceActivatedRef.current = false;
            }
          }
        }
      }
    } catch (error: unknown) {
      console.error("Failed to fetch profile:", getErrorMessage(error));
    }
  }

  const switchWorkspace = useCallback(
    (id: string) => {
      if (selectedWorkspaceIdRef.current === id) return;

      if (typeof window !== "undefined" && currentUser?.id) {
        localStorage.setItem(`ow-selected-workspace-id:${currentUser.id}`, id);
      }

      selectedWorkspaceIdRef.current = id;
      clearWorkspaceScopedState();
      setSelectedWorkspaceId(id);
    },
    [clearWorkspaceScopedState, currentUser?.id],
  );

  const refreshWorkspaces = useCallback(async () => {
    if (!currentUser?.id) {
      setWorkspaces([]);
      return;
    }

    try {
      const result = (await api.workspaces.getMine()) as { data?: Workspace[] };
      const nextWorkspaces = Array.isArray(result?.data) ? result.data : [];
      setWorkspaces(nextWorkspaces);

      const storageKey = `ow-selected-workspace-id:${currentUser.id}`;
      const persistedId =
        typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
      const currentId = selectedWorkspaceIdRef.current;
      const nextSelectedId =
        (currentId &&
          nextWorkspaces.some((workspace) => workspace.id === currentId) &&
          currentId) ||
        (persistedId &&
          nextWorkspaces.some((workspace) => workspace.id === persistedId) &&
          persistedId) ||
        nextWorkspaces[0]?.id ||
        null;

      if (!nextSelectedId) {
        setProjectsSettled(true);
        selectedWorkspaceIdRef.current = null;
        clearWorkspaceScopedState();
        setSelectedWorkspaceId(null);
        if (typeof window !== "undefined") localStorage.removeItem(storageKey);
        return;
      }

      if (selectedWorkspaceIdRef.current !== nextSelectedId) {
        selectedWorkspaceIdRef.current = nextSelectedId;
        clearWorkspaceScopedState();
        setSelectedWorkspaceId(nextSelectedId);
      }

      if (typeof window !== "undefined") {
        localStorage.setItem(storageKey, nextSelectedId);
      }

      const projectData = await api.projects.getAll(nextSelectedId);
      if (selectedWorkspaceIdRef.current === nextSelectedId) {
        setProjects(projectData as Project[]);
        setProjectsSettled(true);
      }
    } catch (error: unknown) {
      console.error("Failed to fetch workspaces:", getErrorMessage(error));
      if (selectedWorkspaceIdRef.current) {
        setProjectsSettled(true);
      }
    }
  }, [clearWorkspaceScopedState, currentUser?.id]);

  async function fetchProjects() {
    if (
      !selectedWorkspaceId ||
      !isUUID(selectedWorkspaceId) ||
      !currentUser?.id
    )
      return;
    const workspaceId = selectedWorkspaceId;
    try {
      setProjectsSettled(false);
      const data = await api.projects.getAll(workspaceId);
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      setProjects(data as Project[]);
      setProjectsSettled(true);
    } catch (error: unknown) {
      console.error("Failed to fetch projects:", getErrorMessage(error));
      if (selectedWorkspaceIdRef.current === workspaceId) {
        setProjectsSettled(true);
      }
    }
  }

  async function fetchTasks() {
    if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) return;
    const workspaceId = selectedWorkspaceId;
    try {
      const data = await api.tasks.getAll(workspaceId);
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      const mappedTasks = (data as unknown[]).map(mapTaskRecord);
      setTasks(mappedTasks as Task[]);
    } catch (error: unknown) {
      console.error("Failed to fetch tasks:", getErrorMessage(error));
    }
  }

  async function fetchNotifications() {
    if (!currentUser?.id) return;
    try {
      const data = await api.notifications.getAll();
      setNotifications(data as Notification[]);
    } catch (error: unknown) {
      console.error("Failed to fetch notifications:", getErrorMessage(error));
    }
  }

  async function fetchNotificationPreferences() {
    if (!currentUser?.id) return;
    try {
      const data = await api.notificationPreferences.get();
      setNotificationPreferences({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...(data as NotificationPreferences),
      });
    } catch (error: unknown) {
      console.error(
        "Failed to fetch notification preferences:",
        getErrorMessage(error),
      );
    }
  }

  async function fetchCommits() {
    if (!selectedProjectId || !isUUID(selectedProjectId)) return;
    try {
      const data = await api.vc.getCommits(selectedProjectId);
      setCommits(data as Commit[]);
    } catch (error: unknown) {
      console.error("Failed to fetch commits:", getErrorMessage(error));
    }
  }

  async function fetchPullRequests() {
    if (!selectedProjectId || !isUUID(selectedProjectId)) return;
    try {
      const data = await api.vc.getPullRequests(selectedProjectId);
      const prs = (data as PullRequest[]).map((pr) => ({
        ...pr,
        diffFiles: MOCK_DIFFS,
      }));
      setPullRequests(prs);
    } catch (error: unknown) {
      console.error("Failed to fetch pull requests:", getErrorMessage(error));
    }
  }

  async function fetchUsers() {
    if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) return;
    if (isFetchingUsersRef.current) return;
    isFetchingUsersRef.current = true;
    const workspaceId = selectedWorkspaceId;
    try {
      // app_onework.workspace_members not accessible via frontend SDK (custom schema).
      const res = await authenticatedFetch(
        `/api/workspace/members?workspaceId=${workspaceId}&lite=true&limit=50`,
      );
      if (!res.ok) return;
      if (selectedWorkspaceIdRef.current !== workspaceId) return;

      const { data } = await res.json();
      if (data) {
        const members = (data as WorkspaceMemberApiRow[]).map((m) => ({
          id: m.id,
          name: m.name || "Anonymous",
          avatar:
            m.avatar ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name || "U")}&background=random`,
          role: m.role || "member",
          email: m.email || "",
          status: m.status || "online",
        }));
        setUsers(members);
      }
    } catch (error: unknown) {
      console.error("Failed to fetch users:", getErrorMessage(error));
    } finally {
      isFetchingUsersRef.current = false;
    }
  }

  async function fetchTeams() {
    if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) return;
    const workspaceId = selectedWorkspaceId;
    try {
      const res = await authenticatedFetch(`/api/teams?workspaceId=${workspaceId}`);
      if (!res.ok) return;
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      const data = await res.json();
      if (Array.isArray(data)) setTeams(data as Team[]);
    } catch (error: any) {
      console.error("Failed to fetch teams:", error.message || error);
    }
  }

  // Wrap in useCallback for context stable reference
  const stableFetchTasks = useCallback(fetchTasks, [selectedWorkspaceId]);
  const stableFetchNotifications = useCallback(fetchNotifications, [
    currentUser.id,
  ]);
  const stableFetchNotificationPreferences = useCallback(
    fetchNotificationPreferences,
    [currentUser.id],
  );
  const stableFetchProjects = useCallback(fetchProjects, [
    currentUser.id,
    selectedWorkspaceId,
  ]);
  const stableFetchProfile = useCallback(fetchProfile, [insforge]);
  const stableFetchCommits = useCallback(fetchCommits, [selectedProjectId]);
  const stableFetchPullRequests = useCallback(fetchPullRequests, [
    selectedProjectId,
  ]);
  const stableFetchUsers = useCallback(fetchUsers, [selectedWorkspaceId]);
  const stableFetchTeams = useCallback(fetchTeams, [selectedWorkspaceId]);

  const updateTask = useCallback(async (id: string, updates: Partial<Task>) => {
    const apiUpdates: Record<string, unknown> = {};
    if ("title" in updates) apiUpdates.title = updates.title;
    if ("description" in updates) apiUpdates.description = updates.description;
    if ("status" in updates) apiUpdates.status = updates.status;
    if ("priority" in updates) apiUpdates.priority = updates.priority;
    if ("assigneeId" in updates) apiUpdates.assignee_id = updates.assigneeId;
    if ("dueDate" in updates) apiUpdates.due_date = updates.dueDate || null;
    if ("tags" in updates) apiUpdates.tags = updates.tags;
    if ("estimatedHours" in updates)
      apiUpdates.estimated_hours = updates.estimatedHours;
    if ("subtaskCount" in updates)
      apiUpdates.subtask_count = updates.subtaskCount;
    if ("subtaskDoneCount" in updates)
      apiUpdates.subtask_done_count = updates.subtaskDoneCount;
    if ("sprintId" in updates) apiUpdates.sprint_id = updates.sprintId || null;
    if ("projectId" in updates) apiUpdates.project_id = updates.projectId || null;

    if (Object.keys(apiUpdates).length === 0) return undefined;

    let previousTask: Task | undefined;
    setTasks((prev) => {
      previousTask = prev.find((t) => t.id === id);
      return prev.map((t) => (t.id === id ? { ...t, ...updates } : t));
    });

    try {
      const result = await api.tasks.update(id, apiUpdates);
      const mappedTask = mapTaskRecord(result);
      setTasks((prev) => prev.map((t) => (t.id === id ? mappedTask : t)));
      return mappedTask;
    } catch (error: unknown) {
      console.error("Failed to update task:", getErrorMessage(error));
      if (previousTask) {
        setTasks((prev) => prev.map((t) => (t.id === id ? previousTask! : t)));
      }
      throw error;
    }
  }, []);

  const patchTaskLocal = useCallback((id: string, updates: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    );
  }, []);

  const addTask = useCallback(
    async (task: Omit<Task, "id">): Promise<Task> => {
      if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId))
        throw new Error("No active workspace");
      const result = await api.tasks.create({
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignee_id: task.assigneeId || null,
        tags: task.tags,
        due_date: task.dueDate || null,
        workspace_id: selectedWorkspaceId,
        project_id: isUUID(task.projectId)
          ? task.projectId
          : isUUID(selectedProjectId)
            ? selectedProjectId
            : null,
        sprint_id: isUUID(task.sprintId) ? task.sprintId : null,
      });
      const newTask = mapTaskRecord(result);
      setTasks((prev) => [newTask, ...prev]);
      return newTask;
    },
    [selectedWorkspaceId, selectedProjectId],
  );

  const deleteTask = useCallback(async (id: string) => {
    try {
      await api.tasks.delete(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (error: unknown) {
      console.error("Failed to delete task:", getErrorMessage(error));
      throw error;
    }
  }, []);

  const duplicateTask = useCallback(async (id: string) => {
    try {
      const result = await api.tasks.duplicate(id);
      const newTask = mapTaskRecord(result);
      setTasks((prev) => [newTask, ...prev]);
    } catch (error: unknown) {
      console.error("Failed to duplicate task:", getErrorMessage(error));
      throw error;
    }
  }, []);

  const getTaskActivities = useCallback(
    async (id: string): Promise<JsonRecord[]> => {
      try {
        const data = await api.tasks.getActivities(id);
        return data as JsonRecord[];
      } catch (error: unknown) {
        console.error(
          "Failed to fetch task activities:",
          getErrorMessage(error),
        );
        return [];
      }
    },
    [],
  );

  const addTaskActivity = useCallback(
    async (
      id: string,
      content: string,
      type: string = "comment",
    ): Promise<JsonRecord> => {
      try {
        const activity = await api.tasks.addActivity(id, { content, type });
        return activity as JsonRecord;
      } catch (error: unknown) {
        console.error("Failed to add task activity:", getErrorMessage(error));
        throw error;
      }
    },
    [],
  );

  const updateTaskActivity = useCallback(
    async (taskId: string, activityId: string, content: string): Promise<void> => {
      try {
        await api.tasks.updateActivity(taskId, activityId, content);
      } catch (error: unknown) {
        console.error("Failed to update task activity:", getErrorMessage(error));
        throw error;
      }
    },
    [],
  );

  const deleteTaskActivity = useCallback(
    async (taskId: string, activityId: string): Promise<void> => {
      try {
        await api.tasks.deleteActivity(taskId, activityId);
      } catch (error: unknown) {
        console.error("Failed to delete task activity:", getErrorMessage(error));
        throw error;
      }
    },
    [],
  );

  const bulkUpdateTasks = useCallback(
    async (ids: string[], updates: Partial<Task>) => {
      try {
        const apiUpdates: Record<string, unknown> = {};
        if ("status" in updates) apiUpdates.status = updates.status;
        if ("priority" in updates) apiUpdates.priority = updates.priority;
        if ("assigneeId" in updates)
          apiUpdates.assignee_id = updates.assigneeId;
        if ("tags" in updates) apiUpdates.tags = updates.tags;

        if (Object.keys(apiUpdates).length === 0) return;
        await api.tasks.bulkUpdate(ids, apiUpdates);
        setTasks((prev) =>
          prev.map((t) => (ids.includes(t.id) ? { ...t, ...updates } : t)),
        );
      } catch (error: unknown) {
        console.error("Failed to bulk update tasks:", getErrorMessage(error));
      }
    },
    [],
  );

  async function fetchSprints() {
    if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) return;
    const workspaceId = selectedWorkspaceId;
    try {
      const data = await api.sprints.getAll(workspaceId);
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      setSprints(data as Sprint[]);
    } catch (error: unknown) {
      console.error("Failed to fetch sprints:", getErrorMessage(error));
    }
  }

  const stableFetchSprints = useCallback(fetchSprints, [selectedWorkspaceId]);

  async function ensureDefaultCalendar(workspaceId: string): Promise<void> {
    const created = await api.calendars.create({
      workspaceId,
      name: "Workspace Calendar",
      color: "#3b82f6",
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Manila",
      isDefault: true,
    });
    if (selectedWorkspaceIdRef.current === workspaceId) {
      setCalendars([created.calendar]);
    }
  }

  async function fetchCalendars() {
    if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) {
      setCalendars([]);
      return;
    }
    const workspaceId = selectedWorkspaceId;
    try {
      const response = await api.calendars.getAll(workspaceId);
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      if (response.calendars.length === 0) {
        await ensureDefaultCalendar(workspaceId);
      } else {
        setCalendars(response.calendars);
      }
    } catch (error: unknown) {
      console.error("Failed to fetch calendars:", getErrorMessage(error));
    }
  }

  const stableFetchCalendars = useCallback(fetchCalendars, [
    selectedWorkspaceId,
  ]);

  async function fetchNativeEvents() {
    if (!currentUser?.id) return;
    const workspaceId = selectedWorkspaceIdRef.current;
    try {
      const response = await api.events.getAll({ workspaceId });
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      setNativeEvents(response.events);
    } catch (error: unknown) {
      console.error("Failed to fetch events:", getErrorMessage(error));
    }
  }

  const stableFetchNativeEvents = useCallback(fetchNativeEvents, [
    currentUser?.id,
    selectedWorkspaceId,
  ]);

  const createSprint = useCallback(
    async (data: Partial<Sprint>): Promise<Sprint | null> => {
      if (!selectedWorkspaceId) return null;
      try {
        const result = await api.sprints.create({
          ...data,
          workspace_id: selectedWorkspaceId,
        });
        const sprint = result as Sprint;
        setSprints((prev) => [sprint, ...prev]);
        return sprint;
      } catch (error: unknown) {
        console.error("Failed to create sprint:", getErrorMessage(error));
        return null;
      }
    },
    [selectedWorkspaceId],
  );

  const completeSprint = useCallback(
    async (
      id: string,
      action: "backlog" | "next-sprint",
      nextSprintId?: string,
    ) => {
      try {
        await api.sprints.complete(id, action, nextSprintId);
        setSprints((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, status: "completed" as const } : s,
          ),
        );
        await fetchTasks();
      } catch (error: unknown) {
        console.error("Failed to complete sprint:", getErrorMessage(error));
      }
    },
    [selectedWorkspaceId],
  );

  const updateSprint = useCallback(
    async (id: string, data: Partial<Sprint>) => {
      try {
        const apiData: Record<string, unknown> = {};
        if ("name" in data) apiData.name = data.name;
        if ("status" in data) apiData.status = data.status;
        if ("start_date" in data) apiData.start_date = data.start_date ?? null;
        if ("end_date" in data) apiData.end_date = data.end_date ?? null;
        if ("duration_days" in data)
          apiData.duration_days = data.duration_days ?? null;
        const result = await api.sprints.update(id, apiData);
        const updated = result as Sprint;
        setSprints((prev) => prev.map((s) => (s.id === id ? updated : s)));
      } catch (error: unknown) {
        console.error("Failed to update sprint:", getErrorMessage(error));
        throw error;
      }
    },
    [],
  );

  const markNotificationAsRead = useCallback(async (id: string) => {
    try {
      await api.notifications.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    } catch (error: unknown) {
      console.error(
        "Failed to mark notification as read:",
        getErrorMessage(error),
      );
    }
  }, []);

  const markAllNotificationsAsRead = useCallback(async () => {
    try {
      await api.notifications.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (error: unknown) {
      console.error(
        "Failed to mark all notifications as read:",
        getErrorMessage(error),
      );
    }
  }, []);

  const clearPendingJoinNotification = useCallback(async () => {
    setPendingJoinNotification(null);
    try {
      await authenticatedFetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_join_notification: null }),
      });
    } catch (error: unknown) {
      console.error(
        "Failed to clear join notification:",
        getErrorMessage(error),
      );
    }
  }, []);

  const updateNotificationPreferences = useCallback(
    async (updates: Partial<NotificationPreferences>) => {
      const previous = notificationPreferences;
      const next = { ...previous, ...updates };
      setNotificationPreferences(next);
      try {
        const saved = await api.notificationPreferences.update(
          next as Record<string, boolean>,
        );
        setNotificationPreferences({
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...(saved as NotificationPreferences),
        });
      } catch (error: unknown) {
        console.error(
          "Failed to update notification preferences:",
          getErrorMessage(error),
        );
        setNotificationPreferences(previous);
        throw error;
      }
    },
    [notificationPreferences],
  );

  const mergePullRequest = useCallback(async (id: string) => {
    try {
      await api.vc.updatePullRequest(id, { status: "Merged", is_open: false });
      setPullRequests((prev) =>
        prev.map((pr) =>
          pr.id === id ? { ...pr, status: "Merged", is_open: false } : pr,
        ),
      );
    } catch (error) {
      console.error("Failed to merge PR:", error);
    }
  }, []);

  const addPRComment = useCallback(
    (prId: string, filename: string, lineNumber: number, content: string) => {
      console.log(
        `Comment added to PR ${prId} on ${filename}:${lineNumber} - ${content}`,
      );
    },
    [],
  );

  const addProject = useCallback(
    async (project: Omit<Project, "id">) => {
      if (!selectedWorkspaceId) return null;
      try {
        const newProject = (await api.projects.create({
          ...project,
          workspace_id: selectedWorkspaceId,
        })) as Project;
        setProjects((prev) => [newProject, ...prev]);
        setSelectedProjectId(newProject.id);
        return newProject;
      } catch (error) {
        console.error("Failed to add project:", error);
        return null;
      }
    },
    [selectedWorkspaceId],
  );

  const updateProject = useCallback((updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);

  const addPullRequest = useCallback(
    async (
      pr: Omit<
        PullRequest,
        | "id"
        | "project_id"
        | "author_id"
        | "created_at"
        | "is_open"
        | "commits_count"
        | "files_changed_count"
      >,
    ) => {
      if (!selectedProjectId) return;
      try {
        const newPR = await api.vc.createPullRequest({
          ...pr,
          project_id: selectedProjectId,
          is_open: true,
          status: "In Review",
        });
        setPullRequests((prev) => [newPR as PullRequest, ...prev]);
      } catch (error) {
        console.error("Failed to create PR:", error);
      }
    },
    [selectedProjectId],
  );

  const sendChatMessage = useCallback(
    async (conversationId: string, content: string) => {
      try {
        await api.chat.sendMessage({
          conversation_id: conversationId,
          sender_id: currentUser.id,
          content: content,
          type: "text",
        });
      } catch (error) {
        console.error("Failed to send message:", error);
      }
    },
    [currentUser.id],
  );

  const updateCurrentUser = useCallback((updates: Partial<User>) => {
    setCurrentUser((prev) => ({ ...prev, ...updates }));
  }, []);

  const setWorkspacePresence = useCallback(
    async (status: "online" | "away" | "offline") => {
      if (!selectedWorkspaceId || !isUUID(selectedWorkspaceId)) {
        throw new Error("No active workspace");
      }

      await api.profile.updatePresence(status, selectedWorkspaceId, true);
      updateCurrentUser({ status });
      setUsers((prev) =>
        prev.map((user) =>
          user.id === currentUser.id
            ? {
                ...user,
                status:
                  status === "online"
                    ? "Active"
                    : status === "away"
                      ? "Away"
                      : PRESENCE_DND_LABEL,
              }
            : user,
        ),
      );
    },
    [currentUser.id, selectedWorkspaceId, updateCurrentUser],
  );

  const updateAppSettings = useCallback((updates: Partial<AppSettings>) => {
    setAppSettings((prev) => ({ ...prev, ...updates }));
  }, []);

  const applyAppearanceSettings = useCallback(
    (
      updates: Partial<
        Pick<AppSettings, "theme" | "layoutDensity" | "fontSize">
      >,
    ) => {
      setAppSettings((prev) => {
        const next: AppSettings = {
          ...prev,
          ...updates,
          ...(updates.layoutDensity !== undefined
            ? { compactDensity: updates.layoutDensity === "compact" }
            : {}),
          ...(updates.fontSize !== undefined
            ? { fontSize: normalizeFontSizeStep(updates.fontSize) }
            : {}),
        };
        persistGlobalAppSettings(next);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    setAppSettings((prev) => ({
      ...prev,
      ...readGlobalAppSettings(),
    }));
  }, []);

  useEffect(() => {
    if (!currentUser.id) return;
    setAppSettings((prev) => ({
      ...prev,
      ...readGlobalAppSettings(),
    }));
  }, [currentUser.id]);

  // Hooks
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await ensureFreshAccessToken();
      await fetchProfile();
      setIsLoading(false);
    };
    void init();
  }, [stableFetchProfile]);

  /** Renew access JWT on init after login / hard refresh. */
  useEffect(() => {
    if (!currentUser.id || typeof window === "undefined") return undefined;
    void ensureFreshAccessToken();
  }, [currentUser.id]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onSessionExpired = () => {
      presenceActivatedRef.current = false;
      setCurrentUser({
        id: "",
        name: "",
        role: "",
        email: "",
        avatar: "",
        status: "",
        onboarding_type: "creator",
      });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    };
  }, []);

  useEffect(() => {
    if (!isLoading && currentUser.id) {
      refreshWorkspaces();
      stableFetchNotifications();
      stableFetchNotificationPreferences();
    }
  }, [
    isLoading,
    currentUser.id,
    refreshWorkspaces,
    stableFetchNotifications,
    stableFetchNotificationPreferences,
  ]);

  useEffect(() => {
    if (
      !selectedWorkspaceId ||
      !isUUID(selectedWorkspaceId) ||
      !currentUser.id
    ) {
      setAppSettings((prev) => ({
        ...prev,
        developerMode: DEFAULT_APP_SETTINGS.developerMode,
        showOfflineStatus: DEFAULT_APP_SETTINGS.showOfflineStatus,
        quickTaskbarPinned: DEFAULT_APP_SETTINGS.quickTaskbarPinned,
      }));
      return;
    }

    let cancelled = false;

    const loadWorkspaceSettings = async () => {
      try {
        const settings = (await api.workspaceSettings.get(
          selectedWorkspaceId,
        )) as WorkspaceUserSettings;
        if (cancelled || selectedWorkspaceIdRef.current !== selectedWorkspaceId)
          return;
        setAppSettings((prev) => ({
          ...prev,
          developerMode: settings.developerMode,
          showOfflineStatus: settings.showOfflineStatus,
          quickTaskbarPinned: settings.quickTaskbarPinned,
        }));
      } catch (error: unknown) {
        console.error(
          "Failed to fetch workspace settings:",
          getErrorMessage(error),
        );
        if (cancelled || selectedWorkspaceIdRef.current !== selectedWorkspaceId)
          return;
        setAppSettings((prev) => ({
          ...prev,
          developerMode: DEFAULT_APP_SETTINGS.developerMode,
          showOfflineStatus: DEFAULT_APP_SETTINGS.showOfflineStatus,
          quickTaskbarPinned: DEFAULT_APP_SETTINGS.quickTaskbarPinned,
        }));
      }
    };

    void loadWorkspaceSettings();

    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId, currentUser.id]);

  useEffect(() => {
    stableFetchNativeEvents();
    if (selectedWorkspaceId) {
      stableFetchProjects();
      stableFetchTasks();
      stableFetchUsers();
      stableFetchTeams();
      stableFetchSprints();
      stableFetchCalendars();
      stableFetchWorkspacePermissions();
    } else {
      setCalendars([]);
    }
  }, [
    currentUser.id,
    selectedWorkspaceId,
    stableFetchProjects,
    stableFetchTasks,
    stableFetchUsers,
    stableFetchTeams,
    stableFetchSprints,
    stableFetchCalendars,
    stableFetchNativeEvents,
    stableFetchWorkspacePermissions,
  ]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchCommits();
      fetchPullRequests();
    }
  }, [selectedProjectId, stableFetchCommits, stableFetchPullRequests]);

  useEffect(() => {
    if (
      projects.length > 0 &&
      !projects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    const schema = process.env.NEXT_PUBLIC_DB_SCHEMA || "app_onework";
    const channels: ReturnType<typeof insforge.channel>[] = [];

    if (selectedWorkspaceId) {
      const taskChannel = insforge
        .channel("realtime-tasks")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: schema,
            table: "tasks",
            filter: `workspace_id=eq.${selectedWorkspaceId}`,
          },
          () => stableFetchTasks(),
        )
        .subscribe();
      channels.push(taskChannel);
    }

    const accountEventsChannel = insforge
      .channel("realtime-account-events")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: schema,
          table: "events",
          filter: `account_id=eq.${currentUser.id}`,
        },
        () => stableFetchNativeEvents(),
      )
      .subscribe();
    channels.push(accountEventsChannel);

    if (selectedWorkspaceId) {
      const workspaceEventsChannel = insforge
        .channel("realtime-workspace-events")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: schema,
            table: "events",
            filter: `workspace_id=eq.${selectedWorkspaceId}`,
          },
          () => stableFetchNativeEvents(),
        )
        .subscribe();
      channels.push(workspaceEventsChannel);

      const onPresenceChange = (payload: {
        new?: { user_id?: string; status?: string; is_manual?: boolean };
      }) => {
        const row = payload.new;
        if (row?.user_id && row.status) {
          const uiStatus = presenceDbToMemberStatus(
            row.status,
            Boolean(row.is_manual),
          );
          setUsers((prev) =>
            prev.map((user) =>
              user.id === row.user_id ? { ...user, status: uiStatus } : user,
            ),
          );
        }

        if (presenceDebounceRef.current) {
          clearTimeout(presenceDebounceRef.current);
        }
        presenceDebounceRef.current = setTimeout(() => {
          presenceDebounceRef.current = null;
          stableFetchUsers();
        }, 400);
      };

      const presenceChannel = insforge
        .channel(`realtime-presence-${selectedWorkspaceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: schema,
            table: "workspace_presence",
            filter: `workspace_id=eq.${selectedWorkspaceId}`,
          },
          onPresenceChange,
        )
        .subscribe();
      channels.push(presenceChannel);
    }

    return () => {
      if (presenceDebounceRef.current) {
        clearTimeout(presenceDebounceRef.current);
        presenceDebounceRef.current = null;
      }
      channels.forEach((channel) => insforge.removeChannel(channel));
    };
  }, [
    selectedWorkspaceId,
    currentUser.id,
    insforge,
    stableFetchTasks,
    stableFetchNativeEvents,
    stableFetchUsers,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (!currentUser?.id) return;
    if (!notificationPreferences.browserNotifications) return;
    if (notificationPreferences.globalDnd) return;
    if (Notification.permission !== "default") return;
    if (permissionRequestedRef.current) return;

    const onUserGesture = () => {
      if (permissionRequestedRef.current) return;
      if (Notification.permission !== "default") return;
      permissionRequestedRef.current = true;
      console.log("[push] requesting browser notification permission (user gesture)");
      requestNotificationPermission()
        .then((result) => console.log("[push] permission result:", result))
        .catch((err) => console.error("[push] permission request failed:", err));
    };

    window.addEventListener("pointerdown", onUserGesture, { once: true, capture: true });
    window.addEventListener("keydown", onUserGesture, { once: true, capture: true });

    return () => {
      window.removeEventListener("pointerdown", onUserGesture, { capture: true });
      window.removeEventListener("keydown", onUserGesture, { capture: true });
    };
  }, [
    currentUser?.id,
    notificationPreferences.browserNotifications,
    notificationPreferences.globalDnd,
  ]);

  // ─── Realtime: per-user notification pub/sub channel ────────────────────────
  // Backed by a Postgres trigger on app_onework.notifications that publishes to
  // `notifications:{user_id}` via realtime.publish(). See insforge realtime docs.
  useEffect(() => {
    if (!currentUser?.id) return;
    const channelName = `notifications:${currentUser.id}`;
    let subscribed = false;

    const handler = (payload: Record<string, unknown>) => {
      stableFetchNotifications();
      console.log("[push] realtime INSERT_notification received", payload);
      const prefs = notificationPreferencesRef.current;
      console.log(
        "[push] permission:",
        typeof window !== "undefined" ? Notification.permission : "ssr",
        "browserNotifications:", prefs.browserNotifications,
        "globalDnd:", prefs.globalDnd,
      );
      if (
        payload?.type === "mention" &&
        prefs.browserNotifications &&
        !prefs.globalDnd
      ) {
        console.log("[push] calling showBrowserNotification");
        showBrowserNotification(
          String(payload.title ?? "New message"),
          String(payload.content ?? ""),
          {
            tag: String(payload.id ?? ""),
            onClick: () => {
              window.location.href = payload.ref_id
                ? `/chat?conv=${payload.ref_id}`
                : "/chat";
            },
          },
        );
      }

      if (
        payload?.type === "calendar_event" &&
        prefs.browserNotifications &&
        !prefs.globalDnd &&
        prefs.calendarEmailEvents
      ) {
        showBrowserNotification(
          String(payload.title ?? "New calendar event"),
          String(payload.content ?? ""),
          {
            tag: String(payload.id ?? ""),
            onClick: () => {
              window.location.href = payload.ref_id
                ? `/calendar?eventId=${payload.ref_id}`
                : "/calendar";
            },
          },
        );
      }

      if (
        (payload?.type === "calendar_invite" ||
          payload?.type === "calendar_update" ||
          payload?.type === "calendar_cancel") &&
        prefs.browserNotifications &&
        !prefs.globalDnd &&
        prefs.calendarEventInvites
      ) {
        showBrowserNotification(
          String(payload.title ?? "Calendar update"),
          String(payload.content ?? ""),
          {
            tag: String(payload.id ?? ""),
            onClick: () => {
              window.location.href = payload.ref_id
                ? `/calendar?eventId=${payload.ref_id}`
                : "/calendar";
            },
          },
        );
      }
    };

    const setup = async () => {
      try {
        if (!insforgeNative.realtime.isConnected) {
          await insforgeNative.realtime.connect();
        }
        const result = await insforgeNative.realtime.subscribe(channelName);
        if (!result.ok) {
          console.warn("[push] subscribe failed:", result.error?.message);
          return;
        }
        subscribed = true;
        insforgeNative.realtime.on("INSERT_notification", handler);
      } catch (err) {
        console.error("[push] notification subscribe error:", err);
      }
    };
    setup();

    return () => {
      insforgeNative.realtime.off("INSERT_notification", handler);
      if (subscribed) insforgeNative.realtime.unsubscribe(channelName);
    };
  }, [currentUser?.id, stableFetchNotifications]);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    const interval = setInterval(() => stableFetchUsers(), 60_000);
    return () => clearInterval(interval);
  }, [selectedWorkspaceId, stableFetchUsers]);

  useEffect(() => {
    if (!selectedWorkspaceId) return;

    const onVisibility = () => {
      if (!document.hidden) {
        stableFetchUsers();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [selectedWorkspaceId, stableFetchUsers]);

  const contextValue = React.useMemo(
    () => ({
      currentUser,
      appSettings,
      pullRequests,
      commits,
      projects,
      users,
      teams,
      tasks,
      notifications,
      notificationPreferences,
      sprints,
      calendars,
      nativeEvents,
      projectSprints,
      workspaces,
      selectedWorkspace,
      selectedProjectId,
      selectedWorkspaceId,
      selectedSprintId,
      workspaceSyncStatus,
      isLoading,
      projectsSettled,
      updateCurrentUser,
      updateAppSettings,
      applyAppearanceSettings,
      saveSettingsToDb,
      setWorkspacePresence,
      mergePullRequest,
      addPRComment,
      addProject,
      updateProject,
      addPullRequest,
      sendChatMessage,
      setSelectedProjectId,
      setSelectedWorkspaceId,
      switchWorkspace,
      refreshWorkspaces,
      fetchTasks: stableFetchTasks,
      addTask,
      updateTask,
      patchTaskLocal,
      deleteTask,
      duplicateTask,
      bulkUpdateTasks,
      getTaskActivities,
      addTaskActivity,
      updateTaskActivity,
      deleteTaskActivity,
      fetchSprints: stableFetchSprints,
      fetchCalendars: stableFetchCalendars,
      fetchNativeEvents: stableFetchNativeEvents,
      createSprint,
      completeSprint,
      updateSprint,
      setSelectedSprintId,
      fetchNotifications: stableFetchNotifications,
      fetchNotificationPreferences: stableFetchNotificationPreferences,
      updateNotificationPreferences,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      pendingJoinNotification,
      clearPendingJoinNotification,
      workspacePermissions,
      workspacePermissionsLoading,
      workspaceRoleLabel,
      workspaceIsOwner,
      canWorkspace,
      refreshWorkspacePermissions,
    }),
    [
      currentUser,
      appSettings,
      pullRequests,
      commits,
      projects,
      users,
      teams,
      tasks,
      notifications,
      notificationPreferences,
      sprints,
      calendars,
      nativeEvents,
      projectSprints,
      workspaces,
      selectedWorkspace,
      selectedProjectId,
      selectedWorkspaceId,
      selectedSprintId,
      workspaceSyncStatus,
      isLoading,
      projectsSettled,
      updateCurrentUser,
      updateAppSettings,
      applyAppearanceSettings,
      saveSettingsToDb,
      setWorkspacePresence,
      mergePullRequest,
      addPRComment,
      addProject,
      updateProject,
      addPullRequest,
      sendChatMessage,
      setSelectedProjectId,
      setSelectedWorkspaceId,
      switchWorkspace,
      refreshWorkspaces,
      stableFetchTasks,
      addTask,
      updateTask,
      patchTaskLocal,
      deleteTask,
      duplicateTask,
      bulkUpdateTasks,
      getTaskActivities,
      addTaskActivity,
      updateTaskActivity,
      deleteTaskActivity,
      stableFetchSprints,
      stableFetchCalendars,
      stableFetchNativeEvents,
      createSprint,
      completeSprint,
      updateSprint,
      setSelectedSprintId,
      stableFetchNotifications,
      stableFetchNotificationPreferences,
      updateNotificationPreferences,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      pendingJoinNotification,
      clearPendingJoinNotification,
      workspacePermissions,
      workspacePermissionsLoading,
      workspaceRoleLabel,
      workspaceIsOwner,
      canWorkspace,
      refreshWorkspacePermissions,
    ],
  );

  return (
    <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context)
    throw new Error("useAppContext must be used within an AppProvider");
  return context;
};
