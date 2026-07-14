import type { Task, User, Project } from "@/types";
import type { TeamPerformanceAnalytics, TeamScopeOption } from "@/types/analytics";

interface Stats {
  completed: number;
  inProgress: number;
  total: number;
  members: number;
  projectCount: number;
  completionRate: number;
}

interface StatusCounts {
  done: number;
  inProgress: number;
  review: number;
  todo: number;
  backlog: number;
}

interface VelocityPoint {
  label: string;
  count: number;
  pct: number;
}

interface MemberWorkload extends User {
  taskCount: number;
}

export interface WorkspaceExportArgs {
  tasks: Task[];
  users: User[];
  projects: Project[];
  stats: Stats;
  velocityData: VelocityPoint[];
  statusCounts: StatusCounts;
  overdueCount: number;
}

export interface ProjectExportArgs {
  tasks: Task[];
  users: User[];
  project: Project | null;
  stats: Stats;
  statusCounts: StatusCounts;
  memberWorkload: MemberWorkload[];
}

export interface TeamExportArgs {
  tasks: Task[];
  users: User[];
  selectedTeam: TeamScopeOption | null;
  analytics: TeamPerformanceAnalytics | null;
}

function esc(val: unknown): string {
  const str = val == null ? "" : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...fields: unknown[]): string {
  return fields.map(esc).join(",");
}

function section(title: string, ...lines: string[]): string {
  return [`${title}`, ...lines, ""].join("\n");
}

export function buildWorkspaceCSV(args: WorkspaceExportArgs): string {
  const {
    tasks,
    users,
    projects,
    stats,
    velocityData,
    statusCounts,
    overdueCount,
  } = args;
  const date = new Date().toISOString().split("T")[0];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const total = stats.total || 1;

  const parts: string[] = [];

  parts.push(section(`OneWork Workspace Report,${date}`));

  parts.push(
    section(
      "=== KPI SUMMARY ===",
      row("Metric", "Value"),
      row("Total Tasks", stats.total),
      row("Completed Tasks", stats.completed),
      row("In Progress", stats.inProgress),
      row("Overdue Tasks", overdueCount),
      row("Total Projects", stats.projectCount),
      row("Active Members", stats.members),
      row("Completion Rate", `${stats.completionRate}%`),
    ),
  );

  parts.push(
    section(
      "=== STATUS DISTRIBUTION ===",
      row("Status", "Count", "% of Total"),
      row(
        "Done",
        statusCounts.done,
        `${Math.round((statusCounts.done / total) * 100)}%`,
      ),
      row(
        "In Progress",
        statusCounts.inProgress,
        `${Math.round((statusCounts.inProgress / total) * 100)}%`,
      ),
      row(
        "Review",
        statusCounts.review,
        `${Math.round((statusCounts.review / total) * 100)}%`,
      ),
      row(
        "Todo",
        statusCounts.todo,
        `${Math.round((statusCounts.todo / total) * 100)}%`,
      ),
      row(
        "Backlog",
        statusCounts.backlog,
        `${Math.round((statusCounts.backlog / total) * 100)}%`,
      ),
    ),
  );

  parts.push(
    section(
      "=== 7-WEEK TASK VELOCITY ===",
      row("Week", "Tasks Completed", "% of Peak"),
      ...velocityData.map((v) => row(v.label, v.count, `${v.pct}%`)),
    ),
  );

  parts.push(
    section(
      "=== ALL TASKS ===",
      row(
        "Task ID",
        "Title",
        "Status",
        "Priority",
        "Assignee",
        "Project",
        "Tags",
        "Due Date",
        "Est. Hours",
        "Created At",
      ),
      ...tasks.map((t) =>
        row(
          t.id,
          t.title,
          t.status,
          t.priority,
          userMap.get(t.assigneeId)?.name ?? "",
          t.projectId ? (projectMap.get(t.projectId)?.name ?? "") : "",
          (t.tags ?? []).join("; "),
          t.dueDate ?? "",
          t.estimatedHours ?? "",
          t.createdAt ?? "",
        ),
      ),
    ),
  );

  return parts.join("");
}

export function buildProjectCSV(args: ProjectExportArgs): string {
  const { tasks, users, project, stats, statusCounts, memberWorkload } = args;
  const date = new Date().toISOString().split("T")[0];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const total = stats.total || 1;

  const priorityCounts = {
    urgent: tasks.filter((t) => t.priority === "urgent").length,
    high: tasks.filter((t) => t.priority === "high").length,
    medium: tasks.filter((t) => t.priority === "medium").length,
    low: tasks.filter((t) => t.priority === "low").length,
  };

  const parts: string[] = [];

  parts.push(section(`OneWork Project Report,${date}`));

  parts.push(
    section(
      "=== PROJECT SUMMARY ===",
      row(
        "Project",
        "Total Tasks",
        "Backlog",
        "Todo",
        "In Progress",
        "Review",
        "Done",
        "Completion %",
      ),
      row(
        project?.name ?? "All Projects",
        stats.total,
        statusCounts.backlog,
        statusCounts.todo,
        statusCounts.inProgress,
        statusCounts.review,
        statusCounts.done,
        `${stats.completionRate}%`,
      ),
    ),
  );

  parts.push(
    section(
      "=== PRIORITY DISTRIBUTION ===",
      row("Priority", "Count", "% of Total"),
      row(
        "Urgent",
        priorityCounts.urgent,
        `${Math.round((priorityCounts.urgent / total) * 100)}%`,
      ),
      row(
        "High",
        priorityCounts.high,
        `${Math.round((priorityCounts.high / total) * 100)}%`,
      ),
      row(
        "Medium",
        priorityCounts.medium,
        `${Math.round((priorityCounts.medium / total) * 100)}%`,
      ),
      row(
        "Low",
        priorityCounts.low,
        `${Math.round((priorityCounts.low / total) * 100)}%`,
      ),
    ),
  );

  parts.push(
    section(
      "=== TEAM WORKLOAD ===",
      row("Member", "Active Tasks"),
      ...memberWorkload.map((m) => row(m.name, m.taskCount)),
    ),
  );

  parts.push(
    section(
      "=== TASK DETAIL ===",
      row(
        "Task ID",
        "Title",
        "Status",
        "Priority",
        "Assignee",
        "Tags",
        "Due Date",
        "Est. Hours",
      ),
      ...tasks.map((t) =>
        row(
          t.id,
          t.title,
          t.status,
          t.priority,
          userMap.get(t.assigneeId)?.name ?? "",
          (t.tags ?? []).join("; "),
          t.dueDate ?? "",
          t.estimatedHours ?? "",
        ),
      ),
    ),
  );

  return parts.join("");
}

export function buildTeamCSV(args: TeamExportArgs): string {
  const { tasks, users, selectedTeam, analytics } = args;
  const date = new Date().toISOString().split("T")[0];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const parts: string[] = [];

  parts.push(section(`OneWork Team Report,${date}`));

  if (analytics) {
    parts.push(
      section(
        "=== TEAM SUMMARY ===",
        row(
          "Scope",
          "Members",
          "Tasks",
          "Completed",
          "In Progress",
          "Overdue",
          "Completion %",
          "Estimated Hours",
          "Logged Hours",
        ),
        row(
          analytics.scope.name,
          analytics.scope.memberCount,
          analytics.tasksCount,
          analytics.completedTasks,
          analytics.inProgressTasks,
          analytics.overdueTasks,
          `${analytics.completionRate}%`,
          analytics.estimatedHours,
          analytics.loggedHours,
        ),
      ),
    );

    parts.push(
      section(
        "=== MEMBER WORKLOAD ===",
        row(
          "Member",
          "Email",
          "Assigned Tasks",
          "Open Tasks",
          "Completed Tasks",
          "Overdue Tasks",
          "Completion %",
          "Estimated Hours",
          "Logged Hours",
        ),
        ...analytics.members.map((member) =>
          row(
            member.name,
            member.email,
            member.assignedTasks,
            member.openTasks,
            member.completedTasks,
            member.overdueTasks,
            `${member.completionRate}%`,
            member.estimatedHours,
            member.loggedHours,
          ),
        ),
      ),
    );

    parts.push(
      section(
        "=== STATUS DISTRIBUTION ===",
        row("Status", "Count"),
        ...analytics.statusCounts.map((status) =>
          row(status.status, status.count),
        ),
      ),
    );

    parts.push(
      section(
        "=== FLOW TREND ===",
        row("Week", "Created", "Completed"),
        ...analytics.trend.map((point) =>
          row(point.label, point.created, point.completed),
        ),
      ),
    );

    parts.push(
      section(
        "=== TAG BREAKDOWN ===",
        row("Tag", "Task Count", "Estimated Hours"),
        ...analytics.tagBreakdown.map((tag) =>
          row(tag.label, tag.taskCount, tag.estimatedHours),
        ),
      ),
    );

    parts.push(
      section(
        "=== AT-RISK TASKS ===",
        row(
          "Task",
          "Assignee",
          "Status",
          "Priority",
          "Days Overdue",
          "Estimated Hours",
          "Logged Hours",
        ),
        ...analytics.riskTasks.map((task) =>
          row(
            task.title,
            task.assigneeName,
            task.status,
            task.priority,
            task.daysOverdue,
            task.estimatedHours,
            task.loggedHours,
          ),
        ),
      ),
    );
  } else {
    parts.push(
      section(
        "=== TEAM SUMMARY ===",
        row("Scope", "Tasks"),
        row(selectedTeam?.name ?? "Team", tasks.length),
      ),
    );
  }

  parts.push(
    section(
      "=== TEAM TASK DETAIL ===",
      row(
        "Task ID",
        "Title",
        "Status",
        "Priority",
        "Assignee",
        "Tags",
        "Due Date",
        "Est. Hours",
      ),
      ...tasks.map((t) =>
        row(
          t.id,
          t.title,
          t.status,
          t.priority,
          userMap.get(t.assigneeId)?.name ?? "",
          (t.tags ?? []).join("; "),
          t.dueDate ?? "",
          t.estimatedHours ?? "",
        ),
      ),
    ),
  );

  return parts.join("");
}

export function downloadCSV(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
