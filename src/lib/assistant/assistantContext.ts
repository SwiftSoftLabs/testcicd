import type { PermissionKey } from "@/lib/rbac/permissions";
import {
  getWorkspaceMembership,
  memberCan,
  type WorkspaceMembership,
} from "@/lib/rbac/workspace-access";
import type {
  AssistantModule,
  AssistantPageContext,
  AssistantRouteDefinition,
} from "@/types/assistant";

export const ASSISTANT_ROUTES: AssistantRouteDefinition[] = [
  { path: "/dashboard", label: "Dashboard", module: "dashboard" },
  { path: "/tasks", label: "Tasks", module: "tasks", requiresProject: true },
  { path: "/calendar", label: "Calendar", module: "calendar" },
  {
    path: "/version-control",
    label: "Version Control",
    module: "version-control",
    requires: "access_repositories",
    requiresProject: true,
  },
  { path: "/chat", label: "Chat", module: "chat", requiresProject: true },
  { path: "/email", label: "Email", module: "email" },
  { path: "/calls", label: "Calls", module: "calls" },
  { path: "/files", label: "Files", module: "files", requiresProject: true },
  {
    path: "/analytics",
    label: "Analytics",
    module: "analytics",
    requiresProject: true,
  },
  { path: "/vault", label: "Vault", module: "vault", requiresProject: true },
  { path: "/settings", label: "Settings", module: "settings" },
  { path: "/settings/account", label: "Account Settings", module: "settings" },
  { path: "/settings/profile", label: "Profile Settings", module: "settings" },
  {
    path: "/settings/users",
    label: "Team Members",
    module: "settings",
    requiresAny: ["invite_members", "manage_members"],
  },
  {
    path: "/settings/roles",
    label: "Roles",
    module: "settings",
    requires: "manage_roles",
  },
  {
    path: "/settings/permissions",
    label: "Permissions",
    module: "settings",
    requires: "manage_roles",
  },
  { path: "/settings/git-ssh", label: "Git & SSH", module: "settings" },
  {
    path: "/settings/workspace",
    label: "Workspace Settings",
    module: "settings",
    requires: "workspace_settings",
  },
  {
    path: "/settings/notifications",
    label: "Notification Settings",
    module: "settings",
  },
  { path: "/settings/plugins", label: "Plugins", module: "settings" },
  {
    path: "/settings/billing",
    label: "Billing",
    module: "settings",
    requires: "billing_management",
  },
  {
    path: "/settings/activity-logs",
    label: "Activity Logs",
    module: "settings",
    requires: "view_audit_logs",
  },
  { path: "/settings/security", label: "Security", module: "settings" },
  { path: "/notifications", label: "Notifications", module: "notifications" },
  { path: "/support", label: "Support", module: "support" },
  { path: "/email/compose", label: "Compose Email", module: "email" },
];

export interface ResolvedAssistantContext {
  pageContext: AssistantPageContext;
  membership: WorkspaceMembership | null;
  allowedPaths: string[];
  allowedModules: AssistantModule[];
  currentModule: AssistantModule | null;
  hasProject: boolean;
}

function moduleFromPath(pathname: string): AssistantModule | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path.startsWith("/email/compose")) return "email";
  if (path.startsWith("/tasks")) return "tasks";
  if (path.startsWith("/calendar")) return "calendar";
  if (path.startsWith("/version-control")) return "version-control";
  if (path.startsWith("/chat")) return "chat";
  if (path.startsWith("/email")) return "email";
  if (path.startsWith("/calls")) return "calls";
  if (path.startsWith("/files")) return "files";
  if (path.startsWith("/analytics")) return "analytics";
  if (path.startsWith("/vault")) return "vault";
  if (path.startsWith("/settings")) return "settings";
  if (path.startsWith("/notifications")) return "notifications";
  if (path.startsWith("/support")) return "support";
  if (path.startsWith("/dashboard")) return "dashboard";
  return null;
}

function memberHasPermission(
  membership: WorkspaceMembership | null,
  permission: PermissionKey,
): boolean {
  if (!membership) return false;
  return memberCan(membership, permission);
}

function routeAllowed(
  route: AssistantRouteDefinition,
  membership: WorkspaceMembership | null,
  hasProject: boolean,
): boolean {
  if (!membership) {
    return ["dashboard", "calendar", "email", "calls", "settings"].includes(
      route.module,
    );
  }
  if (route.requiresProject && !hasProject) return false;
  if (route.requiresAny?.length) {
    const ok = route.requiresAny.some((p) => memberHasPermission(membership, p));
    if (!ok) return false;
  } else if (route.requires && !memberHasPermission(membership, route.requires)) {
    return false;
  }
  return true;
}

export async function resolveAssistantContext(
  userId: string,
  pageContext: AssistantPageContext,
): Promise<ResolvedAssistantContext> {
  const workspaceId = pageContext.workspaceId?.trim() || null;
  const projectId = pageContext.projectId?.trim() || null;
  const hasProject = Boolean(projectId);

  let membership: WorkspaceMembership | null = null;
  if (workspaceId) {
    membership = await getWorkspaceMembership(workspaceId, userId);
  }

  const allowedRoutes = ASSISTANT_ROUTES.filter((r) =>
    routeAllowed(r, membership, hasProject),
  );
  const allowedPaths = allowedRoutes.map((r) => r.path);
  const allowedModules = [
    ...new Set(allowedRoutes.map((r) => r.module)),
  ] as AssistantModule[];

  return {
    pageContext: {
      pathname: pageContext.pathname || "/dashboard",
      workspaceId,
      projectId,
      conversationId: pageContext.conversationId?.trim() || null,
      emailMessageId: pageContext.emailMessageId?.trim() || null,
      taskId: pageContext.taskId?.trim() || null,
    },
    membership,
    allowedPaths,
    allowedModules,
    currentModule: moduleFromPath(pageContext.pathname || ""),
    hasProject,
  };
}

export function formatContextForPrompt(ctx: ResolvedAssistantContext): string {
  const routeLabels = ASSISTANT_ROUTES.filter((r) =>
    ctx.allowedPaths.includes(r.path),
  ).map((r) => `${r.label} → ${r.path}`);

  const lines = [
    "## OneWork assistant context",
    `Current path: ${ctx.pageContext.pathname}`,
    `Workspace: ${ctx.pageContext.workspaceId ?? "none"}`,
    `Project: ${ctx.pageContext.projectId ?? "none"}`,
    `Current module: ${ctx.currentModule ?? "unknown"}`,
    "",
    "Allowed navigation destinations:",
    ...routeLabels.map((l) => `- ${l}`),
    "",
    "Allowed navigation paths:",
    ...ctx.allowedPaths.map((p) => `- ${p}`),
    "",
    "Allowed summarize modules:",
    ...ctx.allowedModules
      .filter((m) => ["tasks", "email", "chat", "calendar"].includes(m))
      .map((m) => `- ${m}`),
  ];
  if (ctx.pageContext.conversationId) {
    lines.push("", `Active conversation: ${ctx.pageContext.conversationId}`);
  }
  if (ctx.pageContext.emailMessageId) {
    lines.push("", `Open email message: ${ctx.pageContext.emailMessageId}`);
  }
  if (ctx.pageContext.taskId) {
    lines.push("", `Open task: ${ctx.pageContext.taskId}`);
  }
  return lines.join("\n");
}

export function isPathAllowed(
  ctx: ResolvedAssistantContext,
  path: string,
): boolean {
  const normalized = path.split("?")[0] ?? path;
  if (ctx.allowedPaths.includes(normalized)) return true;
  return ctx.allowedPaths.some(
    (p) => p !== "/settings" && normalized.startsWith(`${p}/`),
  );
}

export function canUsePermission(
  ctx: ResolvedAssistantContext,
  permission: PermissionKey,
): boolean {
  if (!ctx.membership) return false;
  return memberCan(ctx.membership, permission);
}
