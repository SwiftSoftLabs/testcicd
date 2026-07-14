import type {
  GitBranchInfo,
  GitCommitDetail,
  GitCommitListItem,
  GitFileTextResult,
  GitIntegrationStatusResponse,
  GitProvider,
  GitSshKey,
  GitPullCreateHint,
  GitReadmeResponse,
  GitRepo,
  GitRepoVercelDeploymentStatus,
  GitTreeEntry,
} from "@/types/git";
import type { DiffFile, PullRequest, PullRequestActivityComment } from "@/types";
import type {
  CalendarDTO,
  CalendarEventDTO,
  CreateCalendarInput,
  CreateEmailEventInput,
  CreateEventInput,
  EventRecurrenceSummaryDTO,
  UpdateEventInput,
} from "@/types/calendar";
import type { TeamPerformanceAnalytics } from "@/types/analytics";
import type { Project, WorkspaceUserSettings } from "@/types";
import type {
  CallLivePayload,
  CallSessionDetail,
  CallSessionRow,
  CallSyncPayload,
  MeetingTaskReviewRow,
  TranscriptSegment,
} from "@/types/calls";
import type { LiveAiDeltaResponse } from "@/lib/calls/localCallSession";
import {
  handleAuthFailure,
  prepareAuthenticatedRequest,
  recoverFromUnauthorized,
} from "@/lib/auth/client-session";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import {
  detectInsforge429,
  InsforgeRateLimitError,
  markInsforgeRateLimited,
} from "@/lib/insforgeRateLimit";

export { authenticatedFetch } from "@/lib/authenticated-fetch";
export { InsforgeRateLimitError, isInsforgeRateLimited, getInsforgeRateLimitRemainingMs } from "@/lib/insforgeRateLimit";

export interface ImpactItem {
  id: string;
  label: string;
}

export interface ImpactSection {
  label: string;
  count: number;
  items: ImpactItem[];
  emptyMessage?: string;
}

export interface ImpactResponse {
  sections: ImpactSection[];
  previewLimit: number;
}

type JsonRecord = Record<string, unknown>;
export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: string; // 'Admin' | 'Team Lead' | 'Member' | 'Guest' | 'Non-Member'
  status: string;
  lastActive: string;
  avatar: string;
  activeProjects: string[];
  isMember: boolean;
}

export interface MembersResponse {
  data: WorkspaceMember[];
  total: number;
  totalMembers: number;
  totalActive: number;
  totalAdmins: number;
}

export interface CalendarIntegrationStatusItem {
  provider: "google_calendar" | "zoom";
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  status: "connected" | "error" | "revoked" | "disconnected";
}

export interface CalendarIntegrationStatusResponse {
  googleConfigured: boolean;
  zoomConfigured: boolean;
  integrations: CalendarIntegrationStatusItem[];
}

export interface CalendarPluginStatusItem {
  provider: "google_calendar" | "outlook" | "calendly";
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  status: "connected" | "error" | "revoked" | "disconnected";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface CalendarPluginStatusResponse {
  googleConfigured: boolean;
  outlookConfigured: boolean;
  calendlyConfigured: boolean;
  plugins: CalendarPluginStatusItem[];
}

export interface ChatPluginSlackStatus {
  connected: boolean;
  teamName: string | null;
  status: "connected" | "error" | "revoked" | "disconnected";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export type ChatPluginProviderId = "slack" | "teams" | "discord";

export interface ConversationLinkDTO {
  id: string;
  conversationId: string;
  conversationName: string | null;
  provider: ChatPluginProviderId;
  externalChannelId: string;
  externalChannelName: string | null;
}

export interface ExternalChannelItem {
  id: string;
  name: string;
  isPrivate: boolean;
  subtitle?: string;
}

export type TaskPluginProviderId = "trello" | "jira" | "clickup" | "asana";

export interface TaskPluginStatusItem {
  provider: TaskPluginProviderId;
  connected: boolean;
  accountName: string | null;
  accountEmail: string | null;
  status: "connected" | "error" | "revoked" | "disconnected";
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface ProjectLinkDTO {
  id: string;
  provider: TaskPluginProviderId;
  projectId: string | null;
  projectName: string | null;
  externalContainerId: string;
  externalContainerName: string | null;
}

export interface ExternalTaskContainerItem {
  id: string;
  name: string;
  subtitle?: string;
}

/** @deprecated Use ExternalChannelItem */
export type SlackChannelItem = ExternalChannelItem;

/** API routes often set `{ error: string }`; upstream Git errors may stringify JSON in `error`. */
function humanizeApiErrorPayload(errorData: JsonRecord, status: number): string {
  const raw = errorData.error ?? errorData.message;
  if (raw == null) return `HTTP error! status: ${status}`;
  if (typeof raw !== "string") return String(raw);

  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const inner = JSON.parse(s) as { message?: string; error?: string };
      if (typeof inner.message === "string" && inner.message) return inner.message;
      if (typeof inner.error === "string" && inner.error.trim().startsWith("{")) {
        try {
          const nested = JSON.parse(inner.error) as { message?: string };
          if (typeof nested.message === "string" && nested.message) return nested.message;
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* not JSON — use raw string below */
    }
  }
  return s;
}

export async function fetcher<T>(
  url: string,
  options?: RequestInit,
  retriedAfterRefresh = false,
): Promise<T> {
  if (typeof window !== "undefined" && !retriedAfterRefresh) {
    await prepareAuthenticatedRequest();
  }

  const res = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (
    res.status === 401 &&
    !retriedAfterRefresh &&
    typeof window !== "undefined"
  ) {
    const recovered = await recoverFromUnauthorized();
    if (recovered) {
      return fetcher<T>(url, options, true);
    }
    if (!recovered) {
      handleAuthFailure();
    }
  }

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as JsonRecord;
    const errorMessage = humanizeApiErrorPayload(errorData, res.status);
    if (detectInsforge429(res.status, errorMessage)) {
      markInsforgeRateLimited();
      throw new InsforgeRateLimitError(errorMessage, 90_000);
    }
    throw new Error(errorMessage);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json();
}

function assertUuidLike(id: string, label: string): string {
  const value = (id || "").trim();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function emailQuery(params: Record<string, string> = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) qs.set(key, value);
  const query = qs.toString();
  return query ? `/api/email?${query}` : "/api/email";
}

export const api = {
  auth: {
    passkeyLoginOptions: (email?: string) =>
      fetcher("/api/auth/passkey/login/options", {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    passkeyLoginVerify: (response: unknown) =>
      fetcher("/api/auth/passkey/login/verify", {
        method: "POST",
        body: JSON.stringify({ response }),
      }),
  },
  rbac: {
    get: (workspaceId: string) => {
      const validId = assertUuidLike(workspaceId, "workspace id");
      return fetcher<{
        data: {
          roles: Array<{
            key: string;
            label: string;
            description: string;
            active: boolean;
            permissions: Record<string, boolean>;
          }>;
          matrix: Array<{
            id: string;
            name: string;
            description: string;
            section: string;
            roles: Record<string, boolean>;
          }>;
          canManage: boolean;
          myPermissions: string[];
          myRole: string;
          isOwner: boolean;
        };
      }>(`/api/workspace/rbac?workspaceId=${encodeURIComponent(validId)}`);
    },
    updateRole: (
      workspaceId: string,
      body: {
        role: string;
        label?: string;
        description?: string;
        active?: boolean;
        permissions?: Record<string, boolean>;
        resetRole?: boolean;
      },
    ) => {
      const validId = assertUuidLike(workspaceId, "workspace id");
      return fetcher(`/api/workspace/rbac?workspaceId=${encodeURIComponent(validId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    getMyPermissions: (workspaceId: string) => {
      const validId = assertUuidLike(workspaceId, "workspace id");
      return fetcher<{
        data: {
          permissions: string[];
          role: string;
          roleLabel: string;
          isOwner: boolean;
        };
      }>(`/api/workspace/permissions?workspaceId=${encodeURIComponent(validId)}`);
    },
  },
  workspaces: {
    getMine: () => fetcher("/api/workspace/me"),
    getDeleteImpact: (id: string) => {
      const validId = assertUuidLike(id, "workspace id");
      return fetcher<ImpactResponse>(
        `/api/workspace/delete-impact?id=${encodeURIComponent(validId)}`,
      );
    },
    delete: (id: string) => {
      const validId = assertUuidLike(id, "workspace id");
      return fetcher(`/api/workspace?id=${encodeURIComponent(validId)}`, {
        method: "DELETE",
      });
    },
    getCallSettings: (workspaceId: string) =>
      fetcher<{ settings: Record<string, unknown> }>(
        `/api/workspace/call-settings?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
    patchCallSettings: (
      workspaceId: string,
      body: {
        who_can_start_calls?: "all_members" | "admins_only";
        call_recording_retention_days?: number;
        call_ai_enabled_default?: boolean;
        call_noise_cancellation_default?: boolean;
      },
    ) =>
      fetcher<{ settings: Record<string, unknown> }>("/api/workspace/call-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, ...body }),
      }),
  },
  users: {
    getMembers: (
      workspaceId: string,
      params: {
        search?: string;
        role?: string;
        status?: string;
        sort?: string;
        page?: number;
        limit?: number;
      } = {},
    ) => {
      const qs = new URLSearchParams({ workspaceId });
      if (params.search) qs.set("search", params.search);
      if (params.role) qs.set("role", params.role);
      if (params.status) qs.set("status", params.status);
      if (params.sort) qs.set("sort", params.sort);
      if (params.page) qs.set("page", String(params.page));
      if (params.limit) qs.set("limit", String(params.limit));
      return fetcher<MembersResponse>(`/api/workspace/members?${qs}`);
    },
    invite: (workspaceId: string, email: string, role: string) =>
      fetcher<{ message: string }>(`/api/workspace/members?workspaceId=${workspaceId}`, {
        method: "POST",
        body: JSON.stringify({ email, role }),
      }),
    updateStatus: (userId: string, status: string, workspaceId: string) =>
      fetcher<{ message: string }>(`/api/workspace/members/${userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, workspaceId }),
      }),
    getDeleteImpact: (userId: string, workspaceId: string, scope?: "account") => {
      const qs = new URLSearchParams({ workspaceId });
      if (scope) qs.set("scope", scope);
      return fetcher<ImpactResponse>(
        `/api/workspace/members/${userId}/delete-impact?${qs}`,
      );
    },
    removeMember: (userId: string, workspaceId: string) =>
      fetcher<{ message: string }>(
        `/api/workspace/members/${userId}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      ),
    deleteAccount: (userId: string, workspaceId: string) =>
      fetcher<{ message: string }>(
        `/api/workspace/members/${userId}?workspaceId=${encodeURIComponent(workspaceId)}&scope=account`,
        { method: "DELETE" },
      ),
    updateMemberRole: (userId: string, workspaceId: string, role: string) =>
      fetcher<{ data: { role: string }; message: string }>(
        `/api/workspace/members/${userId}/role?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "PATCH", body: JSON.stringify({ role }) },
      ),
  },
  projectMembers: {
    assign: (projectId: string, userId: string, role = "member") =>
      fetcher<{ message: string }>("/api/project-members", {
        method: "POST",
        body: JSON.stringify({ projectId, userId, role }),
      }),
  },
  analytics: {
    getTeamPerformance: (
      workspaceId: string,
      teamId: string,
      sprintId = "all",
    ) =>
      fetcher<TeamPerformanceAnalytics>(
        `/api/analytics/team-performance?workspaceId=${encodeURIComponent(assertUuidLike(workspaceId, "workspace id"))}&teamId=${encodeURIComponent(teamId)}&sprintId=${encodeURIComponent(sprintId)}`,
      ),
  },
  tasks: {
    getAll: (workspaceId: string) => fetcher(`/api/tasks?workspaceId=${workspaceId}`),
    getOne: (id: string) => fetcher(`/api/tasks/${id}`),
    create: (data: JsonRecord) =>
      fetcher("/api/tasks", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: JsonRecord) =>
      fetcher(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) => fetcher(`/api/tasks/${id}`, { method: "DELETE" }),
    duplicate: (id: string) => fetcher(`/api/tasks/${id}/duplicate`, { method: "POST" }),
    bulkUpdate: (ids: string[], updates: JsonRecord) =>
      fetcher("/api/tasks/bulk", {
        method: "POST",
        body: JSON.stringify({ ids, updates }),
      }),
    getActivities: (id: string) => fetcher(`/api/tasks/${id}/activities`),
    addActivity: (id: string, data: JsonRecord) =>
      fetcher(`/api/tasks/${id}/activities`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateActivity: (taskId: string, activityId: string, content: string) =>
      fetcher(`/api/tasks/${taskId}/activities/${activityId}`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      }),
    deleteActivity: (taskId: string, activityId: string) =>
      fetcher(`/api/tasks/${taskId}/activities/${activityId}`, {
        method: "DELETE",
      }),
    getSubtasks: (id: string) => fetcher(`/api/tasks/${id}/subtasks`),
    createSubtask: (id: string, data: JsonRecord) =>
      fetcher(`/api/tasks/${id}/subtasks`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    getTimeLogs: (id: string) => fetcher(`/api/tasks/${id}/time-logs`),
    logTime: (id: string, data: JsonRecord) =>
      fetcher(`/api/tasks/${id}/time-logs`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    getDependencies: (id: string) => fetcher(`/api/tasks/${id}/dependencies`),
    addDependency: (id: string, dependsOnTaskId: string) =>
      fetcher(`/api/tasks/${id}/dependencies`, {
        method: "POST",
        body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
      }),
    removeDependency: (id: string, depId: string) =>
      fetcher(`/api/tasks/${id}/dependencies?depId=${depId}`, {
        method: "DELETE",
      }),
    getAttachments: (id: string) => fetcher(`/api/tasks/${id}/attachments`),
    createAttachment: (id: string, data: JsonRecord) =>
      fetcher(`/api/tasks/${id}/attachments`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    deleteAttachment: (id: string, attachmentId: string) =>
      fetcher(`/api/tasks/${id}/attachments?attachmentId=${attachmentId}`, {
        method: "DELETE",
      }),
    /** Unified task AI (detail + board). See POST /api/tasks/ai. */
    runAi: (body: Record<string, unknown>) =>
      fetcher<Record<string, unknown>>("/api/tasks/ai", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getAISuggestions: (id: string, type: string) =>
      fetcher<Record<string, unknown>>("/api/tasks/ai", {
        method: "POST",
        body: JSON.stringify({ kind: type, taskId: id }),
      }),
  },
  calendars: {
    getAll: (workspaceId: string) =>
      fetcher<{ calendars: CalendarDTO[] }>(
        `/api/calendars?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
    create: (data: CreateCalendarInput) =>
      fetcher<{ calendar: CalendarDTO }>("/api/calendars", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  events: {
    getAll: (params: {
      workspaceId?: string | null;
      start?: string;
      end?: string;
      projectId?: string | null;
    }) => {
      const qs = new URLSearchParams();
      if (params.workspaceId) qs.set("workspaceId", params.workspaceId);
      if (params.start) qs.set("start", params.start);
      if (params.end) qs.set("end", params.end);
      if (params.projectId) qs.set("projectId", params.projectId);
      return fetcher<{ events: CalendarEventDTO[] }>(`/api/events?${qs}`);
    },
    create: (data: CreateEventInput) =>
      fetcher<{ event: CalendarEventDTO; recurrence: EventRecurrenceSummaryDTO | null }>("/api/events", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    createFromEmail: (data: CreateEmailEventInput) =>
      fetcher<{ event: CalendarEventDTO }>("/api/events/from-email", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    get: (id: string) =>
      fetcher<{ event: CalendarEventDTO }>(`/api/events/${id}`),
    update: (id: string, data: UpdateEventInput) =>
      fetcher<{ event: CalendarEventDTO }>(`/api/events/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string, opts?: { scope?: "following" | "series" }) => {
      const qs = opts?.scope ? `?scope=${opts.scope}` : "";
      return fetcher<{ success: true }>(`/api/events/${id}${qs}`, { method: "DELETE" });
    },
  },
  calendarIntegrations: {
    status: () =>
      fetcher<CalendarIntegrationStatusResponse>("/api/integrations/calendar/status"),
    startUrl: (
      provider: "google" | "zoom",
      opts?: { returnTo?: string; popup?: boolean },
    ) => {
      const qs = new URLSearchParams();
      if (opts?.returnTo) qs.set("returnTo", opts.returnTo);
      if (opts?.popup) qs.set("popup", "1");
      const q = qs.toString();
      return `/api/integrations/calendar/${provider}/start${q ? `?${q}` : ""}`;
    },
    disconnect: (provider: "google" | "zoom") =>
      fetcher<{ ok: boolean }>(`/api/integrations/calendar/${provider}`, {
        method: "DELETE",
      }),
  },
  calendarPlugins: {
    status: () => fetcher<CalendarPluginStatusResponse>("/api/plugins/calendar/status"),
    startUrl: (
      provider: "google_calendar" | "outlook" | "calendly" | "google",
      opts?: { returnTo?: string; popup?: boolean },
    ) => {
      const pathProvider = provider === "google" ? "google_calendar" : provider;
      const qs = new URLSearchParams();
      if (opts?.returnTo) qs.set("returnTo", opts.returnTo);
      if (opts?.popup) qs.set("popup", "1");
      const q = qs.toString();
      return `/api/plugins/calendar/${pathProvider}/start${q ? `?${q}` : ""}`;
    },
    disconnect: (provider: "google_calendar" | "outlook" | "calendly" | "google") => {
      const pathProvider = provider === "google" ? "google_calendar" : provider;
      return fetcher<{ ok: boolean }>(`/api/plugins/calendar/${pathProvider}`, {
        method: "DELETE",
      });
    },
    sync: (provider?: "google_calendar" | "outlook" | "calendly") =>
      fetcher<{
        ok: boolean;
        results: Array<{
          provider: string;
          pulled: number;
          deleted: number;
          error?: string;
        }>;
      }>("/api/plugins/calendar/sync", {
        method: "POST",
        body: JSON.stringify(provider ? { provider } : {}),
      }),
    updateSettings: (
      provider: "google_calendar" | "outlook" | "calendly",
      settings: { calendarIds?: string[]; userUri?: string },
    ) =>
      fetcher<{ ok: boolean; settings: Record<string, unknown> }>(
        `/api/plugins/calendar/${provider}/settings`,
        { method: "PATCH", body: JSON.stringify(settings) },
      ),
  },
  chatPlugins: {
    status: (workspaceId: string) =>
      fetcher<{
        slackConfigured: boolean;
        teamsConfigured: boolean;
        discordConfigured: boolean;
        slack: ChatPluginSlackStatus;
        teams: ChatPluginSlackStatus;
        discord: ChatPluginSlackStatus;
      }>(`/api/plugins/chat/status?workspaceId=${encodeURIComponent(workspaceId)}`),
    startUrl: (
      workspaceId: string,
      provider: ChatPluginProviderId,
      opts?: { returnTo?: string; popup?: boolean },
    ) => {
      const qs = new URLSearchParams({ workspaceId });
      if (opts?.returnTo) qs.set("returnTo", opts.returnTo);
      if (opts?.popup) qs.set("popup", "1");
      const q = qs.toString();
      return `/api/plugins/chat/${provider}/start?${q}`;
    },
    disconnect: (workspaceId: string, provider: ChatPluginProviderId) =>
      fetcher<{ ok: boolean }>(
        `/api/plugins/chat/${provider}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      ),
    sync: (workspaceId: string, provider?: ChatPluginProviderId) =>
      fetcher<{ ok: boolean; imported: number; error?: string }>(
        "/api/plugins/chat/sync",
        {
          method: "POST",
          body: JSON.stringify(provider ? { workspaceId, provider } : { workspaceId }),
        },
      ),
    listLinks: (workspaceId: string) =>
      fetcher<{ links: ConversationLinkDTO[] }>(
        `/api/plugins/chat/links?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
    createLink: (input: {
      workspaceId: string;
      provider: ChatPluginProviderId;
      conversationId: string;
      externalChannelId: string;
      externalChannelName?: string;
    }) =>
      fetcher<{
        ok: boolean;
        link: unknown;
        imported: number;
        warning?: string;
        alreadyLinked?: boolean;
      }>("/api/plugins/chat/links", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    deleteLink: (workspaceId: string, linkId: string) =>
      fetcher<{ ok: boolean }>(
        `/api/plugins/chat/links?workspaceId=${encodeURIComponent(workspaceId)}&linkId=${encodeURIComponent(linkId)}`,
        { method: "DELETE" },
      ),
    listChannels: (workspaceId: string, provider: ChatPluginProviderId) =>
      fetcher<{ channels: ExternalChannelItem[] }>(
        `/api/plugins/chat/${provider}/channels?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
  },
  taskPlugins: {
    status: (workspaceId: string) =>
      fetcher<{
        trelloConfigured: boolean;
        jiraConfigured: boolean;
        clickupConfigured: boolean;
        asanaConfigured: boolean;
        trello: TaskPluginStatusItem;
        jira: TaskPluginStatusItem;
        clickup: TaskPluginStatusItem;
        asana: TaskPluginStatusItem;
      }>(`/api/plugins/tasks/status?workspaceId=${encodeURIComponent(workspaceId)}`),
    startUrl: (
      workspaceId: string,
      provider: TaskPluginProviderId,
      opts?: { returnTo?: string; popup?: boolean },
    ) => {
      const qs = new URLSearchParams({ workspaceId });
      if (opts?.returnTo) qs.set("returnTo", opts.returnTo);
      if (opts?.popup) qs.set("popup", "1");
      return `/api/plugins/tasks/${provider}/start?${qs.toString()}`;
    },
    disconnect: (workspaceId: string, provider: TaskPluginProviderId) =>
      fetcher<{ ok: boolean }>(
        `/api/plugins/tasks/${provider}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      ),
    sync: (workspaceId: string, provider?: TaskPluginProviderId) =>
      fetcher<{ ok: boolean; imported: number; updated: number; error?: string }>(
        "/api/plugins/tasks/sync",
        {
          method: "POST",
          body: JSON.stringify(provider ? { workspaceId, provider } : { workspaceId }),
        },
      ),
    listLinks: (workspaceId: string) =>
      fetcher<{ links: ProjectLinkDTO[] }>(
        `/api/plugins/tasks/links?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
    createLink: (input: {
      workspaceId: string;
      provider: TaskPluginProviderId;
      projectId?: string | null;
      externalContainerId: string;
      externalContainerName?: string;
    }) =>
      fetcher<{ ok: boolean; link: unknown; imported: number; updated: number }>(
        "/api/plugins/tasks/links",
        { method: "POST", body: JSON.stringify(input) },
      ),
    deleteLink: (workspaceId: string, linkId: string) =>
      fetcher<{ ok: boolean }>(
        `/api/plugins/tasks/links?workspaceId=${encodeURIComponent(workspaceId)}&linkId=${encodeURIComponent(linkId)}`,
        { method: "DELETE" },
      ),
    listContainers: (workspaceId: string, provider: TaskPluginProviderId) =>
      fetcher<{ containers: ExternalTaskContainerItem[] }>(
        `/api/plugins/tasks/${provider}/containers?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
  },
  projects: {
    getAll: (workspaceId: string) =>
      fetcher<Project[]>(`/api/projects?workspaceId=${workspaceId}`),
    getDeleteImpact: (id: string) => {
      const validId = assertUuidLike(id, "project id");
      return fetcher<ImpactResponse>(
        `/api/projects/delete-impact?id=${encodeURIComponent(validId)}`,
      );
    },
    create: (data: JsonRecord) =>
      fetcher("/api/projects", { method: "POST", body: JSON.stringify(data) }),
    delete: (id: string) => {
      const validId = assertUuidLike(id, "project id");
      return fetcher(`/api/projects?id=${encodeURIComponent(validId)}`, {
        method: "DELETE",
      });
    },
    update: (
      id: string,
      data: Partial<Pick<Project, "name" | "description" | "color" | "key">>,
    ) => {
      const validId = assertUuidLike(id, "project id");
      return fetcher<Project>(`/api/projects/${encodeURIComponent(validId)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
  },
  chat: {
    getConversations: (workspaceId: string) =>
      fetcher(`/api/chat/conversations?workspaceId=${workspaceId}`),
    createConversation: (data: JsonRecord) =>
      fetcher("/api/chat/conversations", { method: "POST", body: JSON.stringify(data) }),
    getMessages: (conversationId: string, cursor?: string, limit = 100) =>
      fetcher(
        `/api/chat/messages?conversationId=${conversationId}&limit=${limit}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      ),
    sendMessage: (data: JsonRecord) =>
      fetcher("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    getThreadReplies: (messageId: string, cursor?: string, limit = 50) =>
      fetcher(
        `/api/chat/messages/${encodeURIComponent(messageId)}/replies?limit=${limit}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      ),
    editMessage: (id: string, content: string, metadata?: JsonRecord) =>
      fetcher(`/api/chat/messages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ content, metadata }),
      }),
    toggleReaction: (id: string, emoji: string, userId: string) =>
      fetcher(`/api/chat/messages/${id}/reaction`, {
        method: "POST",
        body: JSON.stringify({ emoji, userId }),
      }),
    deleteMessage: (id: string, userId: string) =>
      fetcher(`/api/chat/messages/${id}?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      }),
    markRead: (conversationId: string, userId: string) =>
      fetcher(`/api/chat/conversations/${conversationId}/read`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    leaveConversation: (conversationId: string, userId: string) =>
      fetcher(`/api/chat/conversations/${conversationId}/leave`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),
    runAi: (body: Record<string, unknown>) =>
      fetcher<{
        text?: string;
        replies?: string[];
        summary?: string;
        focus?: string[];
        open_questions?: string[];
        cached?: boolean;
      }>("/api/chat/ai", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getConversationMembers: (conversationId: string) =>
      fetcher<{ data: Array<{ user_id: string; role: string; full_name: string | null; avatar_url: string | null; email: string | null; joined_at: string }> }>(
        `/api/chat/conversations/${encodeURIComponent(conversationId)}/members`,
      ),
    addConversationMember: (conversationId: string, userId: string) =>
      fetcher<{ ok: boolean }>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      }),
    removeConversationMember: (conversationId: string, userId: string) =>
      fetcher<{ ok: boolean }>(`/api/chat/conversations/${encodeURIComponent(conversationId)}/members`, {
        method: 'DELETE',
        body: JSON.stringify({ user_id: userId }),
      }),
  },
  notifications: {
    getAll: () => fetcher("/api/notifications"),
    markAsRead: (id: string) =>
      fetcher(`/api/notifications?id=${id}`, { method: "PATCH" }),
    markAllAsRead: () => fetcher("/api/notifications", { method: "PATCH" }),
  },
  notificationPreferences: {
    get: () => fetcher("/api/notifications/preferences"),
    update: (data: Record<string, boolean>) =>
      fetcher("/api/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },
  email: {
    getAll: (type: string = "inbox", limit?: number) => {
      const q: Record<string, string> = { type, includeAiDigest: "1" };
      if (limit != null && Number.isFinite(limit)) q.limit = String(limit);
      return fetcher(emailQuery(q));
    },
    getRecentInbox: (limit: number = 3) =>
      fetcher(emailQuery({ type: "inbox", limit: String(limit) })),
    getById: (id: string, opts?: { hydrateBody?: boolean }) => {
      const q: Record<string, string> = { id };
      if (opts?.hydrateBody) q.hydrate = "1";
      return fetcher(emailQuery(q));
    },
    send: (data: unknown) =>
      fetcher("/api/email", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: unknown) =>
      fetcher(emailQuery({ id }), {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) => fetcher(emailQuery({ id }), { method: "DELETE" }),
    requestEmailAi: (id: string, body: Record<string, unknown> = {}) =>
      fetcher<Record<string, unknown>>(`/api/email/${encodeURIComponent(id)}/ai`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    getCachedEmailAi: async (id: string) => {
      const res = await authenticatedFetch(`/api/email/${encodeURIComponent(id)}/ai`);
      if (res.status === 204) return null;
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!text.trim()) return null;
      return JSON.parse(text) as Record<string, unknown>;
    },
    composeAi: (body: Record<string, unknown>) =>
      fetcher<{
        bodyHtml?: string;
        subject?: string;
        sourceTruncated?: boolean;
      }>("/api/email/compose/ai", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    accounts: {
      status: () => fetcher<import("@/types").MailAccountStatus>("/api/email/accounts/status"),
      connect: (data: unknown) =>
        fetcher("/api/email/accounts/connect", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      sync: () =>
        fetcher("/api/email/accounts/sync", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      disconnect: (id: string) =>
        fetcher(`/api/email/accounts/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
    oauth: {
      config: () =>
        fetcher<{ googleConfigured: boolean; microsoftConfigured: boolean }>(
          "/api/email/oauth/config",
        ),
      startUrl: (
        provider: "google" | "microsoft",
        opts?: {
          workspaceId?: string | null;
          returnTo?: string;
          popup?: boolean;
        },
      ) => {
        const qs = new URLSearchParams();
        if (opts?.workspaceId) qs.set("workspaceId", opts.workspaceId);
        if (opts?.returnTo) qs.set("returnTo", opts.returnTo);
        if (opts?.popup) qs.set("popup", "1");
        const q = qs.toString();
        return `/api/email/oauth/${provider}/start${q ? `?${q}` : ""}`;
      },
    },
  },
  profile: {
    updateMe: (data: Record<string, unknown>) =>
      fetcher("/api/profile/me", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    updatePresence: (
      status: "online" | "offline" | "away",
      workspaceId?: string | null,
      manual?: boolean,
    ) =>
      fetcher<{ ok: boolean }>("/api/profile/presence", {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(workspaceId ? { workspaceId } : {}),
          manual,
        }),
      }),
    beaconOffline: () => {
      if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
      const blob = new Blob([JSON.stringify({ status: "offline" })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/profile/presence", blob);
    },
    activate: () =>
      fetcher<{ ok: boolean }>("/api/profile/presence/activate", {
        method: "POST",
      }),
  },
  workspaceSettings: {
    get: (workspaceId: string) =>
      fetcher<WorkspaceUserSettings>(
        `/api/workspace/settings?workspaceId=${encodeURIComponent(workspaceId)}`,
      ),
    update: (workspaceId: string, updates: Partial<WorkspaceUserSettings>) =>
      fetcher<WorkspaceUserSettings>("/api/workspace/settings", {
        method: "PUT",
        body: JSON.stringify({ workspaceId, ...updates }),
      }),
  },
  security: {
    get: () => fetcher("/api/security"),
    update: (data: { twoFactorEnabled: boolean }) =>
      fetcher("/api/security", { method: "PUT", body: JSON.stringify(data) }),
    twoFactor: {
      status: () => fetcher("/api/security/2fa"),
      setup: () =>
        fetcher("/api/security/2fa/setup", { method: "POST" }),
      confirm: (code: string) =>
        fetcher("/api/security/2fa/confirm", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      verify: (code: string) =>
        fetcher("/api/security/2fa/verify", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      disable: (code: string) =>
        fetcher("/api/security/2fa/disable", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      clearVaultStepUp: () =>
        fetcher("/api/security/2fa/step-up", { method: "DELETE" }),
    },
    passkeys: {
      list: () => fetcher("/api/security/passkeys"),
      registerOptions: (friendlyName?: string) =>
        fetcher("/api/security/passkeys/register/options", {
          method: "POST",
          body: JSON.stringify({ friendlyName }),
        }),
      registerVerify: (response: unknown, friendlyName?: string) =>
        fetcher("/api/security/passkeys/register/verify", {
          method: "POST",
          body: JSON.stringify({ response, friendlyName }),
        }),
      authenticateOptions: () =>
        fetcher("/api/security/passkeys/authenticate/options", {
          method: "POST",
        }),
      authenticateVerify: (response: unknown) =>
        fetcher("/api/security/passkeys/authenticate/verify", {
          method: "POST",
          body: JSON.stringify({ response }),
        }),
      remove: (id: string) =>
        fetcher(`/api/security/passkeys/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
    updatePassword: (data: { currentPassword: string; newPassword: string }) =>
      fetcher("/api/security/password", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    signOutOtherSessions: () => fetcher("/api/security/sessions", { method: "DELETE" }),
  },
  vc: {
    getCommits: (projectId: string) => fetcher(`/api/vc/commits?projectId=${projectId}`),
    getPullRequests: (projectId: string) =>
      fetcher(`/api/vc/pull-requests?projectId=${projectId}`),
    createPullRequest: (data: JsonRecord) =>
      fetcher("/api/vc/pull-requests", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updatePullRequest: (id: string, data: JsonRecord) =>
      fetcher(`/api/vc/pull-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
  search: {
    global: (q: string, workspaceId: string) =>
      fetcher(`/api/search?q=${q}&workspaceId=${workspaceId}`),
  },
  sprints: {
    getAll: (workspaceId: string) => fetcher(`/api/sprints?workspaceId=${workspaceId}`),
    create: (data: JsonRecord) =>
      fetcher("/api/sprints", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: JsonRecord) =>
      fetcher(`/api/sprints/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    delete: (id: string) => fetcher(`/api/sprints/${id}`, { method: "DELETE" }),
    complete: (id: string, action: "backlog" | "next-sprint", nextSprintId?: string) =>
      fetcher(`/api/sprints/${id}/complete`, {
        method: "POST",
        body: JSON.stringify({ action, nextSprintId }),
      }),
  },
  taskTemplates: {
    getAll: (workspaceId: string) =>
      fetcher(`/api/task-templates?workspaceId=${workspaceId}`),
    create: (data: unknown) =>
      fetcher("/api/task-templates", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: unknown) =>
      fetcher("/api/task-templates", {
        method: "PATCH",
        body: JSON.stringify({ id, ...(data as object) }),
      }),
    delete: (id: string) => fetcher(`/api/task-templates?id=${id}`, { method: "DELETE" }),
  },
  integrations: {
    git: {
      status: (workspaceId: string) =>
        fetcher<GitIntegrationStatusResponse>(
          `/api/integrations/git?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      connectPAT: (provider: GitProvider, workspaceId: string, token: string) =>
        fetcher<{ ok: boolean }>(`/api/integrations/git/${provider}/connect`, {
          method: "POST",
          body: JSON.stringify({ workspaceId, token }),
        }),
      oauthStartUrl: (
        provider: GitProvider,
        workspaceId: string,
        projectId: string,
        returnTo?: string,
      ) => {
        const r = returnTo ?? "/settings/git-ssh";
        const qs = new URLSearchParams({
          workspaceId,
          projectId,
          returnTo: r,
        });
        return `/api/integrations/git/${provider}/oauth/start?${qs.toString()}`;
      },
      linkedRepos: {
        list: (workspaceId: string, projectId: string, provider: GitProvider) => {
          if (provider === "onework") {
            const qs = new URLSearchParams({ workspaceId, projectId });
            return fetcher<GitRepo[]>(
              `/api/integrations/git/onework/project-repos?${qs.toString()}`,
            );
          }
          const qs = new URLSearchParams({ workspaceId, projectId, provider });
          return fetcher<GitRepo[]>(
            `/api/integrations/git/linked-repos?${qs.toString()}`,
          );
        },
        save: (body: {
          workspaceId: string;
          projectId: string;
          provider: GitProvider;
          repos: Array<{
            id: string;
            owner: string;
            name: string;
            fullName: string;
            private: boolean;
            defaultBranch: string;
            htmlUrl: string;
            cloneUrl: string;
            sshUrl: string;
            description?: string | null;
            homepage?: string | null;
            license?: string | null;
            stargazersCount?: number;
            updatedAt?: string;
          }>;
        }) =>
          fetcher<{ ok: boolean }>("/api/integrations/git/linked-repos", {
            method: "PUT",
            body: JSON.stringify(body),
          }),
      },
      onework: {
        createProjectRepo: (workspaceId: string, projectId: string) =>
          fetcher<GitRepo[]>("/api/integrations/git/onework/project-repos", {
            method: "POST",
            body: JSON.stringify({ workspaceId, projectId }),
          }),
      },
      disconnect: (provider: GitProvider, workspaceId: string) =>
        fetcher<{ ok: boolean }>(
          `/api/integrations/git/${provider}?workspaceId=${encodeURIComponent(workspaceId)}`,
          { method: "DELETE" },
        ),
      sshKeys: {
        list: async (workspaceId: string, provider: GitProvider) => {
          const qs = new URLSearchParams({ workspaceId, provider });
          const res = await authenticatedFetch(`/api/integrations/git/ssh-keys?${qs.toString()}`, {
            headers: { "Content-Type": "application/json" },
          });
          const json = (await res.json()) as {
            data?: GitSshKey[];
            accountLogin?: string;
            scopes?: string[];
            error?: string;
            code?: string;
          };
          if (!res.ok) {
            const err = new Error(
              humanizeApiErrorPayload(json as JsonRecord, res.status),
            ) as Error & { code?: string };
            if (typeof json.code === "string") err.code = json.code;
            throw err;
          }
          return {
            data: json.data ?? [],
            accountLogin: json.accountLogin ?? "",
            scopes: json.scopes ?? [],
          };
        },
        create: (body: {
          workspaceId: string;
          provider: GitProvider;
          title: string;
          key: string;
        }) =>
          fetcher<{ data: GitSshKey }>("/api/integrations/git/ssh-keys", {
            method: "POST",
            body: JSON.stringify(body),
          }),
        delete: (workspaceId: string, provider: GitProvider, keyId: string) => {
          const qs = new URLSearchParams({ workspaceId, provider, keyId });
          return fetcher<{ ok: boolean }>(
            `/api/integrations/git/ssh-keys?${qs.toString()}`,
            { method: "DELETE" },
          );
        },
      },
      repos: (provider: GitProvider, workspaceId: string, q?: string, page?: number) => {
        const qs = new URLSearchParams({ workspaceId });
        if (q?.trim()) qs.set("q", q.trim());
        if (page != null) qs.set("page", String(page));
        return fetcher<GitRepo[]>(
          `/api/integrations/git/${provider}/repos?${qs.toString()}`,
        );
      },
      contents: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        path?: string,
        ref?: string,
      ) => {
        const qs = new URLSearchParams({ workspaceId });
        if (path) qs.set("path", path);
        if (ref) qs.set("ref", ref);
        return fetcher<GitTreeEntry[]>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?${qs.toString()}`,
        );
      },
      file: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        path: string,
        ref?: string,
      ) => {
        const qs = new URLSearchParams({ workspaceId, path });
        if (ref) qs.set("ref", ref);
        return fetcher<GitFileTextResult>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/file?${qs.toString()}`,
        );
      },
      readme: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        ref?: string,
      ) => {
        const qs = new URLSearchParams({ workspaceId });
        if (ref) qs.set("ref", ref);
        return fetcher<GitReadmeResponse>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme?${qs.toString()}`,
        );
      },
      branches: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
      ) =>
        fetcher<GitBranchInfo[]>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      createBranch: (
        workspaceId: string,
        owner: string,
        repo: string,
        branchName: string,
        fromRef: string,
      ) =>
        fetcher<{ ok: boolean }>(
          `/api/integrations/git/onework/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, branchName, fromRef }),
          },
        ),
      commitFile: (body: {
        workspaceId: string;
        owner: string;
        repo: string;
        path: string;
        content: string;
        message: string;
        branch: string;
        sha?: string | null;
      }) =>
        fetcher<{ ok: boolean }>(
          `/api/integrations/git/onework/repos/${encodeURIComponent(body.owner)}/${encodeURIComponent(body.repo)}/file`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId: body.workspaceId,
              path: body.path,
              content: body.content,
              message: body.message,
              branch: body.branch,
              sha: body.sha ?? null,
            }),
          },
        ),
      tags: (workspaceId: string, owner: string, repo: string) =>
        fetcher<
          Array<{
            name: string;
            commitSha: string;
            message: string | null;
            createdAt: string | null;
          }>
        >(
          `/api/integrations/git/onework/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      releases: (workspaceId: string, owner: string, repo: string) =>
        fetcher<
          Array<{
            id: number;
            tagName: string;
            name: string;
            body: string;
            draft: boolean;
            prerelease: boolean;
            htmlUrl: string | null;
            createdAt: string | null;
            publishedAt: string | null;
            assetCount: number;
          }>
        >(
          `/api/integrations/git/onework/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      createRelease: (
        workspaceId: string,
        owner: string,
        repo: string,
        body: {
          tagName: string;
          target: string;
          name?: string;
          body?: string;
          draft?: boolean;
          prerelease?: boolean;
        },
      ) =>
        fetcher<{
          id: number;
          tagName: string;
          name: string;
          body: string;
          draft: boolean;
          prerelease: boolean;
          htmlUrl: string | null;
          createdAt: string | null;
          publishedAt: string | null;
          assetCount: number;
        }>(
          `/api/integrations/git/onework/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, ...body }),
          },
        ),
      commits: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        ref?: string,
        page?: number,
      ) => {
        const qs = new URLSearchParams({ workspaceId });
        if (ref) qs.set("ref", ref);
        if (page != null) qs.set("page", String(page));
        return fetcher<GitCommitListItem[]>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${qs.toString()}`,
        );
      },
      commitDetail: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        sha: string,
      ) =>
        fetcher<GitCommitDetail>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      pulls: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        state: "open" | "closed",
        page?: number,
      ) => {
        const qs = new URLSearchParams({ workspaceId, state });
        if (page != null) qs.set("page", String(page));
        return fetcher<PullRequest[]>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${qs.toString()}`,
        );
      },
      pullDetail: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
      ) =>
        fetcher<{ pullRequest: PullRequest; diffFiles: DiffFile[] }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      pullCreateHint: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        base: string,
        compare: string,
      ) => {
        const qs = new URLSearchParams({
          workspaceId,
          base,
          compare,
        });
        return fetcher<GitPullCreateHint>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull-create-hint?${qs.toString()}`,
        );
      },
      postPullComment: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
        body: string,
      ) =>
        fetcher<{ comment: PullRequestActivityComment }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, body }),
          },
        ),
      mergePull: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
        opts?: {
          mergeMethod?: "merge" | "squash" | "rebase";
          squash?: boolean;
          deleteBranchAfterMerge?: boolean;
          projectId?: string;
        },
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              mergeMethod: opts?.mergeMethod,
              squash: opts?.squash,
              deleteBranchAfterMerge: opts?.deleteBranchAfterMerge,
              projectId: opts?.projectId,
            }),
          },
        ),
      closePull: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/close`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          },
        ),
      submitPullReview: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
        input: {
          event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
          body?: string;
        },
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reviews`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              event: input.event,
              body: input.body ?? "",
            }),
          },
        ),
      requestPullReviewers: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
        reviewers: string[],
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/requested-reviewers`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, reviewers }),
          },
        ),
      createPull: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        body: {
          title: string;
          description?: string;
          base: string;
          head: string;
          draft?: boolean;
          projectId?: string;
        },
      ) =>
        fetcher<PullRequest>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              projectId: body.projectId,
              title: body.title,
              description: body.description ?? "",
              base: body.base,
              head: body.head,
              draft: body.draft,
            }),
          },
        ),
      pullTemplates: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
      ) =>
        fetcher<{
          pulls: PullRequest[];
          templates: Array<{ path: string; name: string; content: string }>;
        }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?workspaceId=${encodeURIComponent(workspaceId)}&state=open&templates=1`,
        ),
      updatePull: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
        body: { title?: string; description?: string; draft?: boolean },
      ) =>
        fetcher<{ pullRequest: PullRequest; diffFiles: DiffFile[] }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              title: body.title,
              description: body.description,
              draft: body.draft,
            }),
          },
        ),
      postPullReviewComment: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
        body: { body: string; path: string; line: number; side?: "LEFT" | "RIGHT" },
      ) =>
        fetcher<{ comment: PullRequestActivityComment }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/review-comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, ...body }),
          },
        ),
      updatePullBranch: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/update-branch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          },
        ),
      reopenPull: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reopen`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          },
        ),
      enablePullAutoMerge: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        pullNumber: number,
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/auto-merge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          },
        ),
      branchProtection: {
        list: (workspaceId: string, projectId: string) => {
          const qs = new URLSearchParams({ workspaceId, projectId });
          return fetcher<{
            rules: Array<{
              id: string;
              project_id: string;
              branch_pattern: string;
              require_approval_count: number;
              require_status_checks: boolean;
              required_check_names: string[];
              block_force_push: boolean;
              allow_admin_bypass: boolean;
              created_at: string;
            }>;
          }>(`/api/integrations/git/branch-protection?${qs.toString()}`).then(
            (res) => res.rules,
          );
        },
        save: (
          workspaceId: string,
          projectId: string,
          rules: Array<{
            branch_pattern: string;
            require_approval_count: number;
            require_status_checks: boolean;
            required_check_names: string[];
            block_force_push: boolean;
            allow_admin_bypass: boolean;
          }>,
        ) =>
          fetcher<{
            rules: Array<{
              id: string;
              project_id: string;
              branch_pattern: string;
              require_approval_count: number;
              require_status_checks: boolean;
              required_check_names: string[];
              block_force_push: boolean;
              allow_admin_bypass: boolean;
              created_at: string;
            }>;
          }>("/api/integrations/git/branch-protection", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId, projectId, rules }),
          }).then((res) => res.rules),
      },
      vercelDeployments: {
        status: (
          workspaceId: string,
          projectId: string,
          owner: string,
          repo: string,
        ) => {
          const qs = new URLSearchParams({ workspaceId, projectId, owner, repo });
          return fetcher<{ data: GitRepoVercelDeploymentStatus }>(
            `/api/integrations/git/vercel-deployments?${qs.toString()}`,
          ).then((res) => res.data);
        },
        setup: (body: {
          workspaceId: string;
          projectId: string;
          productionBranch?: string;
          vercelProjectName?: string;
          vercelProjectId?: string;
        }) =>
          fetcher<{ data: { id: string } }>("/api/integrations/git/vercel-deployments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).then((res) => res.data),
        disconnect: (body: {
          workspaceId: string;
          projectId: string;
          owner: string;
          repo: string;
        }) =>
          fetcher<{ data: { disconnected: boolean } }>(
            "/api/integrations/git/vercel-deployments",
            {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          ).then((res) => res.data),
        trigger: (body: {
          workspaceId: string;
          projectId: string;
          owner: string;
          repo: string;
          branch?: string;
          sha: string;
        }) =>
          fetcher<{ data: { deploymentId: string; url: string | null } }>(
            "/api/integrations/git/vercel-deployments/trigger",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          ).then((res) => res.data),
      },
      addCollaborator: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        body: {
          username: string;
          permission: "pull" | "triage" | "push" | "maintain" | "admin";
        },
      ) =>
        fetcher<{
          ok: true;
          alreadyCollaborator?: boolean;
          invitationPending?: boolean;
          message: string;
        }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              username: body.username,
              permission: body.permission,
            }),
          },
        ),
      listCollaborators: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
      ) =>
        fetcher<
          Array<{
            id: string;
            login: string;
            avatarUrl: string | null;
            permission: string;
            htmlUrl?: string | null;
          }>
        >(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      removeCollaborator: (
        provider: GitProvider,
        workspaceId: string,
        owner: string,
        repo: string,
        username: string,
      ) =>
        fetcher<{ ok: true }>(
          `/api/integrations/git/${provider}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators?workspaceId=${encodeURIComponent(workspaceId)}&username=${encodeURIComponent(username)}`,
          { method: "DELETE" },
        ),
      oneworkMemberHandles: (workspaceId: string) =>
        fetcher<
          Array<{
            userId: string;
            name: string;
            email: string;
            giteaUsername: string | null;
          }>
        >(
          `/api/integrations/git/onework/member-handles?workspaceId=${encodeURIComponent(workspaceId)}`,
        ),
      provisionOneworkMember: (workspaceId: string, userId: string) =>
        fetcher<{
          userId: string;
          name: string;
          email: string;
          giteaUsername: string;
        }>("/api/integrations/git/onework/member-handles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, userId }),
        }),
    },
  },
  calls: {
    list: (workspaceId: string, tab?: string, offset?: number) => {
      const qs = new URLSearchParams({ workspaceId });
      if (tab) qs.set("tab", tab);
      if (offset) qs.set("offset", String(offset));
      return fetcher<Array<CallSessionRow & { active_count?: number }>>(
        `/api/calls?${qs.toString()}`,
      );
    },
    upcoming: (workspaceId: string) => {
      const qs = new URLSearchParams({
        workspaceId,
        tab: "home",
        upcoming: "1",
      });
      return fetcher<Array<CallSessionRow & { active_count?: number }>>(
        `/api/calls?${qs.toString()}`,
      );
    },
    create: (body: Record<string, unknown>) =>
      fetcher<CallSessionRow>("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    get: (id: string) => fetcher<CallSessionDetail>(`/api/calls/${id}`),
    patch: (id: string, body: Record<string, unknown>) =>
      fetcher<CallSessionRow>(`/api/calls/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    token: (id: string) =>
      fetcher<{
        token: string;
        url: string;
        room: string;
        identity: string;
      }>(`/api/calls/${id}/token`, { method: "POST" }),
    join: (id: string, consentAt: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent_at: consentAt }),
      }),
    leave: (id: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}/leave`, { method: "POST" }),
    startAgent: (id: string) =>
      fetcher<CallSessionDetail>(`/api/calls/${id}/agent/start`, {
        method: "POST",
      }),
    ensureAgent: (id: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}/agent/ensure`, {
        method: "POST",
      }),
    stopAgent: (id: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}/agent/stop`, {
        method: "POST",
      }),
    reviews: (
      workspaceId: string,
      offsetOrOpts?: number | { offset?: number; callSessionId?: string },
    ) => {
      const qs = new URLSearchParams({ workspaceId });
      const opts =
        typeof offsetOrOpts === "number"
          ? { offset: offsetOrOpts }
          : offsetOrOpts;
      if (opts?.offset) qs.set("offset", String(opts.offset));
      if (opts?.callSessionId) qs.set("callSessionId", opts.callSessionId);
      return fetcher<MeetingTaskReviewRow[]>(`/api/calls/reviews?${qs.toString()}`);
    },
    reviewsForCall: (callSessionId: string, limit = 50) => {
      const qs = new URLSearchParams({ callSessionId, limit: String(limit) });
      return fetcher<MeetingTaskReviewRow[]>(`/api/calls/reviews?${qs.toString()}`);
    },
    live: (id: string, opts?: { lite?: boolean }) => {
      const qs = opts?.lite ? "?lite=1" : "";
      return fetcher<CallLivePayload>(`/api/calls/${id}/live${qs}`);
    },
    sync: (id: string) => fetcher<CallSyncPayload>(`/api/calls/${id}/sync`),
    runLiveAi: (
      id: string,
      body: {
        segments: TranscriptSegment[];
        mode?: "notes" | "tasks";
        sinceCharCount?: number;
      },
    ) =>
      fetcher<LiveAiDeltaResponse>(`/api/calls/${id}/live-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    flushTranscript: (
      id: string,
      body: {
        segments: TranscriptSegment[];
        summary?: string | null;
        keyDecisions?: string[];
        liveNotes?: { at_ms: number; text: string }[];
        pendingTasks?: Array<{
          title: string;
          description?: string;
          suggestedAssigneeId?: string | null;
          suggestedPriority?: "urgent" | "high" | "medium" | "low";
          suggestedDueDate?: string | null;
          confidence?: number;
        }>;
      },
    ) =>
      fetcher<{ ok: boolean; tasksCreated: number }>(
        `/api/calls/${id}/transcript/flush`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    approveReview: (
      reviewId: string,
      moveToTodo?: boolean,
      inCall?: boolean,
    ) =>
      fetcher<{
        ok: boolean;
        acknowledged?: boolean;
        task?: {
          id: string;
          status: string;
          tags: string[];
          sprint_id: string | null;
          project_id: string | null;
        };
      }>(`/api/calls/reviews/${reviewId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          move_to_todo: moveToTodo ?? false,
          in_call: inCall ?? false,
        }),
      }),
    rejectReview: (reviewId: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/reviews/${reviewId}/reject`, {
        method: "POST",
      }),
    endCall: (id: string) =>
      fetcher<CallSessionRow>(`/api/calls/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "processing" }),
      }),
    processAi: (id: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}/process-ai`, {
        method: "POST",
      }),
    resumeProcessing: (id: string, force = false) =>
      fetcher<{ ok: boolean; started?: boolean; skipped?: boolean }>(
        `/api/calls/${id}/resume-processing`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        },
      ),
    reportProcessingProgress: (
      id: string,
      body: { progress?: number; upload_ratio?: number },
    ) =>
      fetcher<{ ok: boolean; progress?: number; skipped?: boolean }>(
        `/api/calls/${id}/processing-progress`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      ),
    uploadRecording: (id: string, blob: Blob, durationSeconds: number) =>
      (async () => {
        await prepareAuthenticatedRequest();
        return new Promise<{ ok: boolean; workspace_file_id?: string }>(
          (resolve, reject) => {
        const form = new FormData();
        form.append(
          "file",
          blob,
          blob.type.includes("webm") ? "recording.webm" : "recording.mp4",
        );
        form.append(
          "duration_seconds",
          String(Math.max(0, Math.round(durationSeconds))),
        );

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/calls/${id}/recording/upload`);
        xhr.withCredentials = true;

        let lastReportedRatio = -1;
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable || ev.total <= 0) return;
          const ratio = ev.loaded / ev.total;
          const stepped = Math.floor(ratio * 20) / 20;
          if (stepped <= lastReportedRatio) return;
          lastReportedRatio = stepped;
          void authenticatedFetch(`/api/calls/${id}/processing-progress`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ upload_ratio: ratio }),
          }).catch(() => undefined);
        };

        xhr.onload = () => {
          const body = (() => {
            try {
              return JSON.parse(xhr.responseText) as {
                error?: string;
                code?: string;
                ok?: boolean;
                workspace_file_id?: string;
              };
            } catch {
              return {};
            }
          })();
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({
              ok: true,
              workspace_file_id: body.workspace_file_id,
            });
            return;
          }
          if (xhr.status === 401) {
            void recoverFromUnauthorized().then((recovered) => {
              if (!recovered) handleAuthFailure();
              reject(new Error(body.error ?? "Unauthorized"));
            });
            return;
          }
          const err = new Error(
            body.error ?? `Upload failed (${xhr.status})`,
          ) as Error & { status?: number; code?: string };
          err.status = xhr.status;
          err.code = body.code;
          reject(err);
        };

        xhr.onerror = () => reject(new Error("Upload failed (network error)"));
        xhr.send(form);
          },
        );
      })(),
    invite: (id: string, body: { participant_ids: string[] }) =>
      fetcher<{ ok: boolean; added: string[] }>(`/api/calls/${id}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    raiseHand: (id: string, raised: boolean) =>
      fetcher<{ ok: boolean; raised: boolean }>(`/api/calls/${id}/raise-hand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raised }),
      }),
    deleteRecording: (id: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}/recording`, {
        method: "DELETE",
      }),
    deleteCall: (id: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}`, {
        method: "DELETE",
      }),
    exportSummaryMarkdown: (id: string) =>
      fetcher<{ id: string; file_name: string }>(`/api/calls/${id}/summary/export`, {
        method: "POST",
      }),
    getMeetingNotes: (id: string) =>
      fetcher<{
        publicContent: string;
        privateContent: string;
        publicUpdatedAt: string | null;
        publicUpdatedBy: string | null;
      }>(`/api/calls/${id}/meeting-notes`),
    patchPublicMeetingNotes: (id: string, content: string) =>
      fetcher<{
        publicContent: string;
        publicUpdatedAt: string;
        publicUpdatedBy: string;
      }>(`/api/calls/${id}/meeting-notes/public`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    patchPrivateMeetingNotes: (id: string, content: string) =>
      fetcher<{ ok: boolean }>(`/api/calls/${id}/meeting-notes/private`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    exportMeetingNotes: (id: string) =>
      fetcher<
        | { id: string; file_name: string }
        | { skipped: boolean; reason: string }
      >(`/api/calls/${id}/meeting-notes/export`, {
        method: "POST",
      }),
  },
  assistant: {
    command: (
      body: import("@/types/assistant").AssistantCommandRequest,
      signal?: AbortSignal,
    ) =>
      fetcher<import("@/types/assistant").AssistantCommandResponse>(
        "/api/assistant/command",
        {
          method: "POST",
          body: JSON.stringify(body),
          signal,
        },
      ),
  },
};
