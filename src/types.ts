export interface User {
  id: string;
  name: string;
  avatar: string;
  role: string;
  email: string;
  status: string;
  onboarding_type?: "creator" | "joiner";
  pending_join_notification?: string | null;
}

export interface Project {
  id: string;
  name: string;
  key?: string;
  description?: string;
  status: "active" | "archived" | "empty";
  visibility: "public" | "private";
  color: string;
  quota_locked?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  role?: string;
  joined_at?: string;
}

export interface WorkspacePresence {
  workspace_id: string;
  user_id: string;
  status: "online" | "away" | "offline" | "invited";
  updated_at: string;
}

export interface WorkspaceUserSettings {
  developerMode: boolean;
  showOfflineStatus: boolean;
  quickTaskbarPinned: boolean;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  content: string;
  type:
    | "mention"
    | "assignment"
    | "comment"
    | "review"
    | "system"
    | "call_invite"
    | "call_reminder"
    | "call_summary"
    | "meeting_tasks_review"
    | "calendar_event"
    | "calendar_invite"
    | "calendar_update"
    | "calendar_cancel"
    | "vc_pr_opened"
    | "vc_pr_comment"
    | "vc_pr_review"
    | "vc_pr_merged"
    | "vc_pr_closed"
    | "vc_collaborator"
    | "vc_release"
    | "vc_push"
    | "vc_check";
  ref_id?: string;
  is_read: boolean;
  created_at: string;
}

export interface NotificationPreferences {
  globalDnd: boolean;
  browserNotifications: boolean;
  taskAssignments: boolean;
  taskComments: boolean;
  taskStatusChanges: boolean;
  pullRequestActivity: boolean;
  buildStatus: boolean;
  securityAlerts: boolean;
  newEmails: boolean;
  fileUploads: boolean;
  callInvites: boolean;
  callReminders: boolean;
  callSummaries: boolean;
  callMeetingTasksReview: boolean;
  calendarEmailEvents: boolean;
  calendarEventInvites: boolean;
  calendarEventInviteEmail: boolean;
}

export interface EmailMessage {
  id: string;
  workspace_id: string | null;
  sender_id: string;
  recipient_id: string;
  subject: string;
  content: string;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  is_draft: boolean;
  /** When set and in the future, message is hidden from inbox until this time. */
  snoozed_until?: string | null;
  created_at: string;
  /** External mailbox thread id when available. */
  thread_id?: string | null;
  /** First line of cached on-server digest (optional). */
  ai_digest_summary?: string | null;
  sender?: {
    id: string;
    full_name: string;
    avatar_url: string;
  };
  recipient?: {
    id: string;
    full_name: string;
    avatar_url: string;
  };
  delivery_error?: string;
  recipient_email?: string;
}

export interface MailAccountStatus {
  connected: boolean;
  unreadCount?: number;
  account: null | {
    id: string;
    emailAddress: string;
    providerType: "gmail" | "outlook" | "custom";
    status: "connected" | "error" | "disconnected";
    quota_locked?: boolean;
    lastSyncAt: string | null;
    syncedMessages: number;
    connectedAt: string;
    reconnectRequired?: boolean;
  };
}

export type Status = "backlog" | "todo" | "in-progress" | "review" | "done";
export type Priority = "urgent" | "high" | "medium" | "low";

export interface Task {
  id: string;
  taskKey?: string;
  taskNumber?: number;
  title: string;
  description?: string;
  priority: Priority;
  status: Status;
  assigneeId: string;
  projectId?: string | null;
  tags: string[];
  commentsCount: number;
  dueDate?: string;
  sourceCallId?: string;
  // Phase 3 fields
  parentTaskId?: string;
  sprintId?: string;
  estimatedHours?: number;
  subtaskCount?: number;
  subtaskDoneCount?: number;
  attachmentCount?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  source?: "local" | "plugin";
  sourceProvider?: "trello" | "jira" | "clickup" | "asana";
}

export interface Sprint {
  id: string;
  workspace_id: string;
  project_id?: string;
  name: string;
  start_date?: string;
  end_date?: string;
  duration_days?: number;
  status: "planning" | "active" | "completed";
  created_by?: string;
  created_at: string;
}

export interface TimeLog {
  id: string;
  task_id: string;
  user_id: string;
  hours: number;
  log_date: string;
  note?: string;
  created_at: string;
  profiles?: { full_name: string; avatar_url?: string };
}

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  depends_on?: Pick<Task, "id" | "title" | "status">;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  file_name: string;
  file_size?: number;
  file_type?: string;
  storage_path: string;
  created_at: string;
  url?: string;
  source?: "upload" | "workspace";
  workspace_file_id?: string;
}

export interface TaskTemplate {
  id: string;
  workspace_id: string;
  created_by?: string;
  name: string;
  title: string;
  description?: string;
  priority: Priority;
  tags: string[];
  default_assignee_id?: string;
  created_at: string;
}

export interface Commit {
  id: string;
  project_id: string;
  author_id: string;
  message: string;
  description?: string;
  files_changed: number;
  insertions: number;
  deletions: number;
  created_at: string;
  author?: {
    full_name: string;
    avatar_url: string;
  };
}

export interface LineComment {
  id: string;
  author: string;
  content: string;
  time: string;
}

export interface DiffLine {
  number: number;
  content: string;
  type: "addition" | "deletion" | "normal";
  comments: LineComment[];
}

export interface DiffFile {
  filename: string;
  status: "modified" | "added" | "removed";
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export type PullRequestMergeableState =
  | "mergeable"
  | "conflicting"
  | "unknown"
  | "blocked"
  | "checking";

export interface PullRequestActivityComment {
  id: string;
  body: string;
  author_login: string;
  author_avatar_url: string;
  created_at: string;
  html_url?: string | null;
  path?: string | null;
  line?: number | null;
  diff_hunk?: string | null;
}

export interface PullRequestActivityReview {
  id: string;
  author_login: string;
  state: string;
  body: string;
  submitted_at: string | null;
}

export interface PullRequestRequestedReviewer {
  login: string;
  avatar_url: string | null;
}

export interface PullRequestActivityCheck {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string | null;
}

export interface PullRequestActivity {
  comments: PullRequestActivityComment[];
  reviews: PullRequestActivityReview[];
  checks: PullRequestActivityCheck[];
  head_sha: string | null;
  mergeable: boolean | null;
  mergeable_state?: PullRequestMergeableState | null;
  requested_reviewers?: PullRequestRequestedReviewer[];
}

export interface PullRequest {
  id: string;
  project_id: string;
  author_id: string;
  title: string;
  description: string;
  status: "In Review" | "Approved" | "Merged" | "Changes Requested";
  base_branch: string;
  compare_branch: string;
  is_open: boolean;
  is_draft?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: PullRequestMergeableState | null;
  labels: string[];
  created_at: string;
  author?: {
    full_name: string;
    avatar_url: string;
  };
  commits_count?: number;
  files_changed_count?: number;
  diffFiles?: DiffFile[];
  /** Provider URL when known (e.g. after create or from API). */
  html_url?: string | null;
  /** Loaded with PR detail: comments, reviews, checks, merge metadata. */
  activity?: PullRequestActivity;
  /** OneWork VC: resolved workspace user id for the PR author (Gitea login → account). */
  author_user_id?: string | null;
  assignees?: Array<{ login: string; avatar_url?: string | null }>;
  milestone?: { title: string; number?: number | null } | null;
}

export interface Team {
  id: string;
  name: string;
  members: number;
  description: string;
  leadId: string;
  memberIds: string[];
}
