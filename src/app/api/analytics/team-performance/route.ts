import { NextResponse } from "next/server";
import { z } from "zod";
import { query, SCHEMA } from "@/lib/db";
import {
  requireSessionUser,
  requireWorkspaceMember,
  WorkspaceAccessError,
} from "@/lib/rbac/workspace-access";
import type {
  TeamPerformanceAnalytics,
  TeamScopeOption,
  TeamStatusCount,
  TeamTagBreakdown,
  TeamWorkloadMember,
  TeamRiskTask,
  AnalyticsTrendPoint,
} from "@/types/analytics";
import type { Status } from "@/types";

const querySchema = z.object({
  workspaceId: z.string().uuid("Missing or invalid workspaceId"),
  teamId: z.string().min(1).default("all"),
  sprintId: z.string().min(1).default("all"),
});

interface MemberRow {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  status: string | null;
}

interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  lead_id: string | null;
  member_ids: string[] | string | null;
}

interface TaskRow {
  id: string;
  title: string;
  status: Status;
  priority: string;
  assignee_id: string | null;
  due_date: string | null;
  estimated_hours: number | string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  tags: string[] | null;
}

interface TimeLogRow {
  task_id: string;
  user_id: string;
  hours: number | string;
}

function normalizeMemberIds(raw: TeamRow["member_ids"]): string[] {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    return raw.replace(/^{|}$/g, "").split(",").filter(Boolean);
  }
  return [];
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function getWeekKey(date: string): string {
  const weekStart = getWeekStart(new Date(date));
  return weekStart.toISOString().slice(0, 10);
}

function getWeekLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysOverdue(dueDate?: string | null): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diff = now.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}

function avatarUrl(name: string, avatar?: string | null): string {
  if (avatar) return avatar;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "U")}&background=random`;
}

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(request);
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      workspaceId: searchParams.get("workspaceId"),
      teamId: searchParams.get("teamId") ?? "all",
      sprintId: searchParams.get("sprintId") ?? "all",
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    }

    const { workspaceId, teamId, sprintId } = parsed.data;
    await requireWorkspaceMember(workspaceId, user.id);

    const memberResult = await query<MemberRow>(
      `SELECT
          p.id,
          COALESCE(NULLIF(p.full_name, ''), split_part(p.email, '@', 1)) AS name,
          p.email,
          p.avatar_url,
          p.status
       FROM ${SCHEMA}.workspace_members wm
       JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
       WHERE wm.workspace_id = $1
       ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email)`,
      [workspaceId],
    );

    const workspaceMembers = memberResult.rows.map((row) => ({
      id: row.id,
      name: row.name || "Anonymous",
      email: row.email,
      avatar: avatarUrl(row.name || "Anonymous", row.avatar_url),
      status: row.status || "offline",
    }));
    const workspaceMemberIds = new Set(workspaceMembers.map((member) => member.id));

    let scope: TeamScopeOption = {
      id: "all",
      name: "All Workspace",
      description: "All active workspace members",
      memberCount: workspaceMembers.length,
      source: "workspace",
      leadId: null,
    };
    let scopedMemberIds = workspaceMembers.map((member) => member.id);

    if (teamId !== "all") {
      const teamResult = await query<TeamRow>(
        `SELECT
            t.id,
            t.name,
            t.description,
            t.lead_id,
            COALESCE(json_agg(tm.user_id::text) FILTER (WHERE tm.user_id IS NOT NULL), '[]'::json) AS member_ids
         FROM ${SCHEMA}.teams t
         LEFT JOIN ${SCHEMA}.team_members tm ON tm.team_id = t.id
         WHERE t.workspace_id = $1 AND t.id = $2
         GROUP BY t.id`,
        [workspaceId, teamId],
      );

      const team = teamResult.rows[0];
      if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
      }

      const memberIds = normalizeMemberIds(team.member_ids).filter((id) =>
        workspaceMemberIds.has(id),
      );
      scope = {
        id: team.id,
        name: team.name,
        description: team.description || "Workspace team",
        memberCount: memberIds.length,
        source: "team",
        leadId: team.lead_id,
      };
      scopedMemberIds = memberIds;
    }

    const taskResult = await query<TaskRow>(
      `SELECT
          id,
          title,
          status::text,
          priority::text,
          assignee_id,
          due_date,
          estimated_hours,
          created_at,
          updated_at,
          completed_at,
          tags
       FROM ${SCHEMA}.tasks
       WHERE workspace_id = $1
         AND ($2 = 'all' OR sprint_id = $2::uuid)
       ORDER BY created_at DESC`,
      [workspaceId, sprintId],
    );

    const scopedMemberIdSet = new Set(scopedMemberIds);
    const tasks = taskResult.rows.filter(
      (task) => task.assignee_id && scopedMemberIdSet.has(task.assignee_id),
    );
    const taskIds = tasks.map((task) => task.id);

    const timeLogResult =
      taskIds.length > 0
        ? await query<TimeLogRow>(
            `SELECT task_id, user_id, hours
             FROM ${SCHEMA}.task_time_logs
             WHERE task_id = ANY($1::uuid[])`,
            [taskIds],
          )
        : { rows: [] as TimeLogRow[], rowCount: 0 };

    const memberMap = new Map(workspaceMembers.map((member) => [member.id, member]));
    const taskLogHours = new Map<string, number>();
    const memberLogHours = new Map<string, number>();

    timeLogResult.rows.forEach((row) => {
      const hours = Number(row.hours) || 0;
      taskLogHours.set(row.task_id, (taskLogHours.get(row.task_id) || 0) + hours);
      memberLogHours.set(row.user_id, (memberLogHours.get(row.user_id) || 0) + hours);
    });

    const completedTasks = tasks.filter((task) => task.status === "done");
    const inProgressTasks = tasks.filter((task) => task.status === "in-progress").length;
    const overdueTasks = tasks.filter(
      (task) => task.status !== "done" && daysOverdue(task.due_date) > 0,
    ).length;
    const estimatedHours = tasks.reduce(
      (sum, task) => sum + (Number(task.estimated_hours) || 0),
      0,
    );
    const loggedHours = Array.from(taskLogHours.values()).reduce(
      (sum, hours) => sum + hours,
      0,
    );

    const statusOrder: Status[] = [
      "backlog",
      "todo",
      "in-progress",
      "review",
      "done",
    ];
    const statusCounts: TeamStatusCount[] = statusOrder.map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length,
    }));

    const trendBuckets = new Map<string, AnalyticsTrendPoint>();
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const base = new Date(now);
      base.setDate(now.getDate() - i * 7);
      const weekStart = getWeekStart(base);
      const key = weekStart.toISOString().slice(0, 10);
      trendBuckets.set(key, {
        key,
        label: getWeekLabel(weekStart),
        created: 0,
        completed: 0,
      });
    }

    tasks.forEach((task) => {
      const createdKey = getWeekKey(task.created_at);
      const createdBucket = trendBuckets.get(createdKey);
      if (createdBucket) createdBucket.created += 1;

      const completedSource =
        task.completed_at || (task.status === "done" ? task.updated_at : null);
      if (!completedSource) return;
      const completedKey = getWeekKey(completedSource);
      const completedBucket = trendBuckets.get(completedKey);
      if (completedBucket) completedBucket.completed += 1;
    });

    const tagMap = new Map<string, { taskCount: number; estimatedHours: number }>();
    tasks.forEach((task) => {
      const tag = task.tags?.[0] || "other";
      const current = tagMap.get(tag) || { taskCount: 0, estimatedHours: 0 };
      current.taskCount += 1;
      current.estimatedHours += Number(task.estimated_hours) || 0;
      tagMap.set(tag, current);
    });

    const tagBreakdown: TeamTagBreakdown[] = Array.from(tagMap.entries())
      .map(([label, values]) => ({
        label,
        taskCount: values.taskCount,
        estimatedHours: values.estimatedHours,
      }))
      .sort((a, b) => b.taskCount - a.taskCount || b.estimatedHours - a.estimatedHours)
      .slice(0, 6);

    const members: TeamWorkloadMember[] = workspaceMembers
      .filter((member) => scopedMemberIdSet.has(member.id))
      .map((member) => {
        const memberTasks = tasks.filter((task) => task.assignee_id === member.id);
        const memberCompleted = memberTasks.filter((task) => task.status === "done").length;
        const memberOpen = memberTasks.filter((task) => task.status !== "done").length;
        const memberEstimated = memberTasks.reduce(
          (sum, task) => sum + (Number(task.estimated_hours) || 0),
          0,
        );
        const memberOverdue = memberTasks.filter(
          (task) => task.status !== "done" && daysOverdue(task.due_date) > 0,
        ).length;
        return {
          id: member.id,
          name: member.name,
          email: member.email,
          avatar: member.avatar,
          status: member.status,
          assignedTasks: memberTasks.length,
          openTasks: memberOpen,
          completedTasks: memberCompleted,
          overdueTasks: memberOverdue,
          completionRate:
            memberTasks.length > 0
              ? Math.round((memberCompleted / memberTasks.length) * 100)
              : 0,
          estimatedHours: memberEstimated,
          loggedHours: memberLogHours.get(member.id) || 0,
        };
      })
      .sort(
        (a, b) =>
          b.openTasks - a.openTasks ||
          b.overdueTasks - a.overdueTasks ||
          b.assignedTasks - a.assignedTasks,
      );

    const riskTasks: TeamRiskTask[] = tasks
      .filter(
        (task) =>
          task.status !== "done" &&
          (daysOverdue(task.due_date) > 0 ||
            task.priority === "urgent" ||
            task.priority === "high"),
      )
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.due_date || undefined,
        assigneeId: task.assignee_id || "",
        assigneeName: memberMap.get(task.assignee_id || "")?.name || "Unassigned",
        estimatedHours: Number(task.estimated_hours) || 0,
        loggedHours: taskLogHours.get(task.id) || 0,
        daysOverdue: daysOverdue(task.due_date),
      }))
      .sort(
        (a, b) =>
          b.daysOverdue - a.daysOverdue ||
          b.loggedHours - a.loggedHours ||
          b.estimatedHours - a.estimatedHours,
      )
      .slice(0, 8);

    const response: TeamPerformanceAnalytics = {
      scope,
      tasksCount: tasks.length,
      completedTasks: completedTasks.length,
      inProgressTasks,
      overdueTasks,
      completionRate: tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
      activeMembers: scope.memberCount,
      estimatedHours,
      loggedHours,
      avgEstimatedHours: tasks.length > 0 ? Number((estimatedHours / tasks.length).toFixed(1)) : 0,
      avgLoggedHours: tasks.length > 0 ? Number((loggedHours / tasks.length).toFixed(1)) : 0,
      statusCounts,
      trend: Array.from(trendBuckets.values()),
      tagBreakdown,
      members,
      riskTasks,
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    if (error instanceof WorkspaceAccessError) {
      const status = error.message === "Unauthorized" ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
