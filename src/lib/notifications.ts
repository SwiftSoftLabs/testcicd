import { formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";
import type { Notification } from "@/types";

interface NotificationMeta {
  icon: string;
  iconBg: string;
  iconColor: string;
}

export function getNotificationMeta(
  type: Notification["type"],
): NotificationMeta {
  switch (type) {
    case "mention":
      return {
        icon: "alternate_email",
        iconBg: "bg-purple-500/15",
        iconColor: "text-purple-400",
      };
    case "assignment":
      return {
        icon: "assignment_ind",
        iconBg: "bg-blue-500/15",
        iconColor: "text-blue-400",
      };
    case "comment":
      return {
        icon: "chat_bubble",
        iconBg: "bg-emerald-500/15",
        iconColor: "text-emerald-400",
      };
    case "review":
      return {
        icon: "rate_review",
        iconBg: "bg-orange-500/15",
        iconColor: "text-orange-400",
      };
    case "system":
      return {
        icon: "info",
        iconBg: "bg-text-secondary/10",
        iconColor: "text-text-secondary",
      };
    case "call_invite":
    case "call_reminder":
      return {
        icon: "videocam",
        iconBg: "bg-cyan-500/15",
        iconColor: "text-cyan-400",
      };
    case "call_summary":
      return {
        icon: "summarize",
        iconBg: "bg-indigo-500/15",
        iconColor: "text-indigo-400",
      };
    case "meeting_tasks_review":
      return {
        icon: "playlist_add_check",
        iconBg: "bg-amber-500/15",
        iconColor: "text-amber-400",
      };
    case "calendar_event":
    case "calendar_invite":
    case "calendar_update":
    case "calendar_cancel":
      return {
        icon: "event",
        iconBg: "bg-violet-500/15",
        iconColor: "text-violet-400",
      };
    case "vc_pr_opened":
    case "vc_pr_comment":
    case "vc_pr_review":
    case "vc_pr_merged":
    case "vc_pr_closed":
    case "vc_collaborator":
    case "vc_release":
    case "vc_push":
    case "vc_check":
      return {
        icon: "account_tree",
        iconBg: "bg-indigo-500/15",
        iconColor: "text-indigo-400",
      };
  }
}

export function isVcNotificationType(type: Notification["type"]): boolean {
  return type.startsWith("vc_");
}

/** Parse VC notification ref_id: `vc:{workspaceId}:{projectId}:{extra}` */
export function parseVcNotificationRef(refId?: string | null): {
  workspaceId?: string;
  projectId?: string;
  extra?: string;
} {
  if (!refId?.startsWith("vc:")) return {};
  const parts = refId.split(":");
  return {
    workspaceId: parts[1] || undefined,
    projectId: parts[2] || undefined,
    extra: parts.slice(3).join(":") || undefined,
  };
}

export function getNotificationRoute(n: Notification): string {
  if (n.type === "mention" || n.type === "comment") return "/chat";
  if (n.type === "assignment" || n.type === "review") {
    return n.ref_id
      ? `/tasks?open=${encodeURIComponent(n.ref_id)}`
      : "/tasks";
  }
  if (
    n.type === "call_invite" ||
    n.type === "call_reminder" ||
    n.type === "call_summary"
  ) {
    return n.ref_id ? `/calls/${n.ref_id}` : "/calls";
  }
  if (n.type === "meeting_tasks_review") return "/calls?tab=review";
  if (
    n.type === "calendar_event" ||
    n.type === "calendar_invite" ||
    n.type === "calendar_update" ||
    n.type === "calendar_cancel"
  ) {
    return n.ref_id ? `/calendar?eventId=${n.ref_id}` : "/calendar";
  }
  if (isVcNotificationType(n.type)) {
    const parsed = parseVcNotificationRef(n.ref_id);
    const qs = new URLSearchParams();
    if (parsed.projectId) qs.set("projectId", parsed.projectId);
    if (parsed.extra?.startsWith("pr=")) {
      qs.set("pr", parsed.extra.slice(3));
    }
    const q = qs.toString();
    return q ? `/version-control?${q}` : "/version-control";
  }
  if (n.type === "system" && n.title?.toLowerCase().includes("file"))
    return "/files";
  return "/notifications";
}

export function getNotificationDateGroup(
  created_at: string,
): "Today" | "Yesterday" | "Earlier" {
  const d = parseISO(created_at);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return "Earlier";
}

export function formatRelativeTime(created_at: string): string {
  try {
    return formatDistanceToNow(parseISO(created_at), { addSuffix: true });
  } catch {
    return new Date(created_at).toLocaleDateString();
  }
}
