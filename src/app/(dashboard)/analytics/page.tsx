"use client";

import React, { Suspense, useState, useMemo } from "react";
import type { TeamPerformanceAnalytics, TeamScopeOption } from "@/types/analytics";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { usePageProjectScope } from "@/hooks/usePageProjectScope";
import { api } from "@/lib/api";
import {
  buildWorkspaceCSV,
  buildProjectCSV,
  buildTeamCSV,
  downloadCSV,
} from "@/lib/analytics-export";

type AnalyticsView = "workspace" | "project" | "team";

// Returns ISO week label like "W18"
function getISOWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = Math.ceil(
    ((d.getTime() - jan4.getTime()) / 86_400_000 + jan4.getDay() + 1) / 7,
  );
  return `W${week}`;
}

// Returns YYYY-W## key for grouping
function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = Math.ceil(
    ((d.getTime() - jan4.getTime()) / 86_400_000 + jan4.getDay() + 1) / 7,
  );
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function formatDueDate(dateStr?: string): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STATUS_STYLE: Record<string, string> = {
  done: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  review: "bg-purple-500/10 border-purple-500/20 text-purple-400",
  "in-progress": "bg-orange-500/10 border-orange-500/20 text-orange-400",
  todo: "bg-blue-500/10 border-blue-500/20 text-blue-400",
  backlog: "bg-white/5 border-border-dark text-text-secondary",
};

const STATUS_BAR_STYLE: Record<string, string> = {
  done: "bg-emerald-400",
  review: "bg-purple-400",
  "in-progress": "bg-orange-400",
  todo: "bg-blue-400",
  backlog: "bg-white/20",
};

function buildVelocity(sourceTasks: {
  status: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}[]) {
  const doneTasks = sourceTasks.filter(
    (task) => task.status === "done" && (task.completedAt || task.updatedAt || task.createdAt),
  );
  const counts: Record<string, number> = {};
  doneTasks.forEach((task) => {
    const source = task.completedAt || task.updatedAt || task.createdAt;
    if (!source) return;
    const key = getWeekKey(source);
    counts[key] = (counts[key] || 0) + 1;
  });
  const weeks: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i * 7);
    const key = getWeekKey(date.toISOString());
    weeks.push({ key, label: getISOWeekLabel(date.toISOString()) });
  }
  const result = weeks.map((week) => ({
    label: week.label,
    count: counts[week.key] || 0,
  }));
  const max = Math.max(...result.map((item) => item.count), 1);
  return result.map((item) => ({
    ...item,
    pct: Math.round((item.count / max) * 100),
  }));
}

const AnalyticsPageInner = () => {
  const {
    projects,
    teams,
    tasks,
    users,
    selectedWorkspaceId,
    setSelectedProjectId,
    sprints,
  } = useAppContext();
  const { addToast } = useUIContext();
  const [activeView, setActiveView] = useState<AnalyticsView>("workspace");
  const [selectedTeamId, setSelectedTeamId] = useState("all");
  const [selectedSprintFilterId, setSelectedSprintFilterId] =
    useState<string>("all");
  const [teamAnalytics, setTeamAnalytics] =
    useState<TeamPerformanceAnalytics | null>(null);
  const [teamAnalyticsLoading, setTeamAnalyticsLoading] = useState(false);
  const [teamAnalyticsError, setTeamAnalyticsError] = useState<string | null>(null);
  const { selectedProjectId, setProjectId } = usePageProjectScope(projects, {
    storageKey: selectedWorkspaceId
      ? `ow-selected-project-id:${selectedWorkspaceId}`
      : null,
    syncUrl: false,
    onProjectChange: setSelectedProjectId,
  });

  const teamScopeOptions = useMemo<TeamScopeOption[]>(
    () => [
      {
        id: "all",
        name: "All Workspace",
        description: "All active workspace members",
        memberCount: users.length,
        source: "workspace",
      },
      ...teams.map((team) => ({
        id: team.id,
        name: team.name,
        description: team.description || "Workspace team",
        memberCount: team.memberIds.length,
        source: "team" as const,
        leadId: team.leadId || null,
      })),
    ],
    [teams, users.length],
  );

  React.useEffect(() => {
    if (!teamScopeOptions.some((scope) => scope.id === selectedTeamId)) {
      setSelectedTeamId("all");
    }
  }, [teamScopeOptions, selectedTeamId]);

  const selectedTeamScope = useMemo(
    () =>
      teamScopeOptions.find((scope) => scope.id === selectedTeamId) ??
      teamScopeOptions[0] ??
      null,
    [selectedTeamId, teamScopeOptions],
  );

  const selectedStoredTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  );

  const activeSprint = useMemo(
    () => sprints.find((s) => s.status === "active") ?? null,
    [sprints],
  );
  const completedSprints = useMemo(
    () =>
      [...sprints.filter((s) => s.status === "completed")].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    [sprints],
  );

  const sprintFilteredTasks = useMemo(
    () =>
      selectedSprintFilterId === "all"
        ? tasks
        : tasks.filter((t) => t.sprintId === selectedSprintFilterId),
    [tasks, selectedSprintFilterId],
  );

  // Team-scoped data (filters users + tasks to the selected team's members)
  const teamMemberIds = useMemo(
    () =>
      selectedTeamId === "all"
        ? new Set(users.map((user) => user.id))
        : new Set(selectedStoredTeam?.memberIds ?? []),
    [selectedStoredTeam, selectedTeamId, users],
  );
  const teamUsers = useMemo(
    () => users.filter((u) => teamMemberIds.has(u.id)),
    [users, teamMemberIds],
  );
  const teamTasks = useMemo(
    () => sprintFilteredTasks.filter((t) => teamMemberIds.has(t.assigneeId)),
    [sprintFilteredTasks, teamMemberIds],
  );

  const projectTasks = useMemo(
    () =>
      sprintFilteredTasks.filter(
        (task) => task.projectId === selectedProjectId,
      ),
    [selectedProjectId, sprintFilteredTasks],
  );

  const visibleTasks =
    activeView === "project"
      ? projectTasks
      : activeView === "team"
        ? teamTasks
        : sprintFilteredTasks;

  const stats = useMemo(() => {
    const completed = visibleTasks.filter((t) => t.status === "done").length;
    const inProgress = visibleTasks.filter(
      (t) => t.status === "in-progress",
    ).length;
    const total = visibleTasks.length;
    const members = users.length;
    const projectCount = projects.length;
    const completionRate =
      total > 0 ? Math.round((completed / total) * 100) : 0;
    return {
      completed,
      inProgress,
      total,
      members,
      projectCount,
      completionRate,
    };
  }, [visibleTasks, users, projects]);

  const statusCounts = useMemo(
    () => ({
      done: visibleTasks.filter((t) => t.status === "done").length,
      inProgress: visibleTasks.filter((t) => t.status === "in-progress").length,
      review: visibleTasks.filter((t) => t.status === "review").length,
      todo: visibleTasks.filter((t) => t.status === "todo").length,
      backlog: visibleTasks.filter((t) => t.status === "backlog").length,
    }),
    [visibleTasks],
  );

  const overdueCount = useMemo(
    () =>
      visibleTasks.filter(
        (t) =>
          t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done",
      ).length,
    [visibleTasks],
  );

  const velocityData = useMemo(
    () => buildVelocity(sprintFilteredTasks),
    [sprintFilteredTasks],
  );

  const recentUrgentTasks = useMemo(
    () =>
      visibleTasks
        .filter((t) => t.priority === "urgent" || t.priority === "high")
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, 5),
    [visibleTasks],
  );

  const memberWorkload = useMemo(
    () =>
      users
        .map((u) => ({
          ...u,
          taskCount: visibleTasks.filter(
            (t) => t.assigneeId === u.id && t.status !== "done",
          ).length,
        }))
        .filter((u) => u.taskCount > 0)
        .sort((a, b) => b.taskCount - a.taskCount)
        .slice(0, 5),
    [users, visibleTasks],
  );

  React.useEffect(() => {
    if (!selectedWorkspaceId || activeView !== "team") return;

    let cancelled = false;
    setTeamAnalyticsLoading(true);
    setTeamAnalyticsError(null);

    api.analytics
      .getTeamPerformance(selectedWorkspaceId, selectedTeamId, selectedSprintFilterId)
      .then((data) => {
        if (cancelled) return;
        setTeamAnalytics(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTeamAnalytics(null);
        setTeamAnalyticsError(
          error instanceof Error ? error.message : "Failed to load team analytics",
        );
      })
      .finally(() => {
        if (!cancelled) setTeamAnalyticsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, selectedSprintFilterId, selectedTeamId, selectedWorkspaceId]);

  const handleExport = () => {
    const date = new Date().toISOString().split("T")[0];
    if (activeView === "workspace") {
      const csv = buildWorkspaceCSV({
        tasks,
        users,
        projects,
        stats,
        velocityData,
        statusCounts,
        overdueCount,
      });
      downloadCSV(`onework-workspace-report-${date}.csv`, csv);
    } else if (activeView === "project") {
      const project = projects.find((p) => p.id === selectedProjectId) ?? null;
      const csv = buildProjectCSV({
        tasks: projectTasks,
        users,
        project,
        stats,
        statusCounts,
        memberWorkload,
      });
      const safeName = (project?.name ?? "report")
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase();
      downloadCSV(`onework-project-${safeName}-${date}.csv`, csv);
    } else {
      const csv = buildTeamCSV({
        tasks: teamTasks,
        users: teamUsers,
        selectedTeam: selectedTeamScope,
        analytics: teamAnalytics,
      });
      const safeName = (selectedTeamScope?.name ?? "report")
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase();
      downloadCSV(`onework-team-${safeName}-${date}.csv`, csv);
    }
    addToast(
      `${activeView.charAt(0).toUpperCase() + activeView.slice(1)} report downloaded`,
      "success",
    );
  };

  // ── Status donut percentages ──────────────────────────────────────────────
  const total =
    statusCounts.done +
      statusCounts.inProgress +
      statusCounts.review +
      statusCounts.todo +
      statusCounts.backlog || 1;
  const donePct = Math.round((statusCounts.done / total) * 100);
  const activePct = Math.round(
    ((statusCounts.inProgress + statusCounts.review) / total) * 100,
  );
  const pendingPct = 100 - donePct - activePct;

  // Task breakdown bar heights (project view)
  const breakdownValues = [
    statusCounts.backlog,
    statusCounts.todo,
    statusCounts.inProgress,
    statusCounts.review,
    statusCounts.done,
  ];
  const breakdownMax = Math.max(...breakdownValues, 1);

  const renderWorkspaceDashboard = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {[
          {
            label: "Total Tasks Completed",
            value: stats.completed.toString(),
            growth: "12.5%",
            icon: "task_alt",
            color: "text-primary",
            negative: false,
          },
          {
            label: "Total Projects",
            value: stats.projectCount.toString(),
            growth: "8.2%",
            icon: "rocket_launch",
            color: "text-purple-400",
            negative: false,
          },
          {
            label: "Active Team Members",
            value: stats.members.toString(),
            growth: "+2.1%",
            icon: "group",
            color: "text-orange-400",
            negative: false,
          },
          {
            label: "Overdue Tasks",
            value: overdueCount.toString(),
            growth: null,
            icon: "timer",
            color: "text-pink-400",
            negative: false,
          },
        ].map((kpi, idx) => (
          <div
            key={idx}
            className="bg-surface-dark border border-border-dark p-3 sm:p-6 rounded-2xl shadow-sm group hover:border-primary/30 transition-all"
          >
            <div className="flex justify-between items-start mb-4">
              <div
                className={`size-10 rounded-xl bg-background-dark border border-border-dark flex items-center justify-center ${kpi.color}`}
              >
                <span className="material-symbols-outlined">{kpi.icon}</span>
              </div>
              {kpi.growth && (
                <div
                  className={`flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full ${kpi.negative ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}
                >
                  <span className="material-symbols-outlined text-[12px]">
                    {kpi.negative ? "trending_down" : "trending_up"}
                  </span>
                  {kpi.growth}
                </div>
              )}
              {idx === 3 && overdueCount > 0 && (
                <div className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                  <span className="material-symbols-outlined text-[12px]">
                    warning
                  </span>
                  Needs attention
                </div>
              )}
            </div>
            <p className="text-text-secondary text-xs font-bold uppercase tracking-widest mb-1">
              {kpi.label}
            </p>
            <h3 className="text-xl sm:text-2xl lg:text-3xl font-black text-main truncate">{kpi.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 lg:gap-8">
        <div className="lg:col-span-8 bg-surface-dark border border-border-dark rounded-2xl p-8 flex flex-col min-h-[400px]">
          <div className="flex items-center justify-between mb-10">
            <h3 className="text-xl font-bold text-main">Task Velocity</h3>
            <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest bg-background-dark border border-border-dark px-3 py-1 rounded-lg">
              Weekly (tasks completed)
            </span>
          </div>
          <div className="flex-1 flex flex-col">
            <div className="flex-1 relative flex items-end gap-1.5 sm:gap-2 px-2 sm:px-4 pb-8">
              <div className="absolute inset-0 flex flex-col justify-between py-2 opacity-10">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-full h-px bg-white"></div>
                ))}
              </div>
              {velocityData.map((bar, i) => (
                <div
                  key={i}
                  className="flex-1 min-w-0 bg-primary/20 hover:bg-primary transition-all rounded-t-lg relative group cursor-pointer"
                  style={{ height: `${Math.max(bar.pct, 4)}%` }}
                >
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-surface-dark border border-border-dark text-[10px] font-bold text-main px-2 py-1 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap">
                    {bar.count} Tasks
                  </div>
                </div>
              ))}
            </div>
            <div className="flex px-2 sm:px-4 text-[10px] font-bold text-text-secondary uppercase tracking-widest pt-4 border-t border-white/5">
              {velocityData.map((bar) => (
                <span key={bar.label} className="flex-1 text-center">{bar.label}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-dark border border-border-dark rounded-2xl p-8 flex flex-col">
          <h3 className="text-xl font-bold text-main mb-10">Task Status</h3>
          <div className="flex-1 flex flex-col items-center justify-center relative">
            <div className="size-56 rounded-full border-[18px] border-primary/10 relative">
              <div className="absolute inset-0 rounded-full border-[18px] border-primary border-r-transparent border-b-transparent -rotate-12"></div>
              <div className="absolute inset-0 rounded-full border-[18px] border-emerald-400 border-t-transparent border-l-transparent border-b-transparent rotate-[80deg]"></div>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-main">
                  {stats.total}
                </span>
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
                  Tasks
                </span>
              </div>
            </div>
            <div className="mt-12 space-y-3 w-full">
              {[
                {
                  label: "Done",
                  value: `${donePct}%`,
                  color: "bg-emerald-400",
                },
                {
                  label: "Active (in progress + review)",
                  value: `${activePct}%`,
                  color: "bg-primary",
                },
                {
                  label: "Pending (todo + backlog)",
                  value: `${pendingPct}%`,
                  color: "bg-orange-400",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${stat.color}`}
                    ></span>
                    <span className="text-xs text-text-secondary font-medium">
                      {stat.label}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-main">
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-surface-dark border border-border-dark rounded-2xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-border-dark flex items-center justify-between">
          <h3 className="text-lg font-bold text-main">
            Recent High Priority Tasks
          </h3>
          <span className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
            {recentUrgentTasks.length} tasks
          </span>
        </div>
        {recentUrgentTasks.length === 0 ? (
          <div className="p-10 text-center text-text-secondary text-sm">
            No high priority tasks
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="bg-background-dark/30 border-b border-border-dark">
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Task Name
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Priority
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Status
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Due Date
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Est.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark/30">
                {recentUrgentTasks.map((task) => (
                  <tr
                    key={task.id}
                    className="hover:bg-white/1 transition-all"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        {task.priority === "urgent" && (
                          <span className="material-symbols-outlined text-red-400 text-[16px]">
                            error
                          </span>
                        )}
                        <span className="text-sm font-bold text-main line-clamp-1">
                          {task.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${task.priority === "urgent" ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-orange-500/10 border-orange-500/20 text-orange-400"}`}
                      >
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${STATUS_STYLE[task.status] || "bg-white/5 border-border-dark text-text-secondary"}`}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-xs text-text-secondary">
                      {formatDueDate(task.dueDate)}
                    </td>
                    <td className="px-6 py-5 text-xs text-text-secondary">
                      {task.estimatedHours ? `${task.estimatedHours}h` : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const renderProjectReport = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        {[
          {
            label: "Project Progress",
            value: stats.completionRate + "%",
            growth: "12%",
            icon: "trending_up",
            color: "text-primary",
          },
          {
            label: "Tasks Completed",
            value: `${stats.completed}/${stats.total}`,
            desc: `${stats.total - stats.completed} tasks remaining`,
            icon: "check_circle",
            color: "text-emerald-400",
          },
          {
            label: "Active Collaborators",
            value: stats.members.toString(),
            desc: "Members in workspace",
            icon: "group",
            color: "text-orange-400",
          },
          {
            label: "Overdue Tasks",
            value: overdueCount.toString(),
            desc: overdueCount > 0 ? "Need attention" : "All on track",
            icon: "flag",
            color: "text-purple-400",
          },
        ].map((kpi, idx) => (
          <div
            key={idx}
            className="bg-surface-dark border border-border-dark p-3 sm:p-6 rounded-2xl shadow-sm group hover:border-primary/30 transition-all"
          >
            <div className="flex justify-between items-start mb-4">
              <div
                className={`size-10 rounded-xl bg-background-dark border border-border-dark flex items-center justify-center ${kpi.color}`}
              >
                <span className="material-symbols-outlined">{kpi.icon}</span>
              </div>
              {kpi.growth && (
                <div className="flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                  <span className="material-symbols-outlined text-[12px]">
                    trending_up
                  </span>
                  +{kpi.growth}
                </div>
              )}
            </div>
            <p className="text-text-secondary text-[10px] font-bold uppercase tracking-widest mb-1">
              {kpi.label}
            </p>
            <h3 className="text-xl sm:text-2xl font-black text-main truncate">{kpi.value}</h3>
            {kpi.desc && (
              <p className="text-[10px] text-text-secondary mt-1 font-medium">
                {kpi.desc}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 lg:gap-8">
        <div className="lg:col-span-8 bg-surface-dark border border-border-dark rounded-2xl p-8">
          <div className="flex items-center justify-between mb-10">
            <h3 className="text-xl font-bold text-main">Task Breakdown</h3>
            <button className="cursor-pointer text-[10px] font-black text-primary uppercase tracking-[0.2em] hover:underline">
              View Details
            </button>
          </div>
          <div className="h-64 flex items-end gap-3 sm:gap-6 px-4 sm:px-10 border-b border-white/5 pb-6">
            {breakdownValues.map((val, i) => (
              <div
                key={i}
                className="flex-1 min-w-0 bg-primary/20 rounded-t-xl transition-all hover:bg-primary relative group cursor-pointer"
                style={{
                  height: `${Math.max(Math.round((val / breakdownMax) * 100), 4)}%`,
                }}
              >
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-main opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {val}
                </div>
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-text-secondary uppercase whitespace-nowrap">
                  {["Backlog", "Todo", "In Progress", "Review", "Done"][i]}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-14 space-y-4">
            <div className="flex justify-between items-center text-xs font-bold text-text-secondary uppercase">
              <span>Completion Status</span>
              <span className="text-main">
                {stats.completed}/{stats.total} Tasks
              </span>
            </div>
            <div className="h-2.5 w-full bg-background-dark rounded-full overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{
                  width: `${stats.total > 0 ? (statusCounts.done / stats.total) * 100 : 0}%`,
                }}
              ></div>
              <div
                className="h-full bg-purple-500 transition-all"
                style={{
                  width: `${stats.total > 0 ? (statusCounts.review / stats.total) * 100 : 0}%`,
                }}
              ></div>
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${stats.total > 0 ? (statusCounts.inProgress / stats.total) * 100 : 0}%`,
                }}
              ></div>
            </div>
            <div className="flex gap-6 pt-2">
              {[
                {
                  label: "Done",
                  color: "bg-emerald-500",
                  count: statusCounts.done,
                },
                {
                  label: "Review",
                  color: "bg-purple-500",
                  count: statusCounts.review,
                },
                {
                  label: "In Prog",
                  color: "bg-primary",
                  count: statusCounts.inProgress,
                },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-2">
                  <span className={`size-2 rounded-full ${l.color}`}></span>
                  <span className="text-[10px] font-black text-text-secondary uppercase">
                    {l.label} ({l.count})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-surface-dark border border-border-dark rounded-2xl p-8">
          <h3 className="text-xl font-bold text-main mb-8">Team Workload</h3>
          {memberWorkload.length === 0 ? (
            <p className="text-text-secondary text-sm">
              No active task assignments found.
            </p>
          ) : (
            <div className="space-y-6">
              {memberWorkload.map((member) => (
                <div key={member.id} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={member.avatar}
                        className="size-7 rounded-full border border-border-dark"
                        alt=""
                      />
                      <span className="text-sm font-bold text-main">
                        {member.name}
                      </span>
                    </div>
                    <span className="text-[10px] font-black text-text-secondary uppercase">
                      {member.taskCount} tasks
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-background-dark rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${memberWorkload[0]?.taskCount ? (member.taskCount / memberWorkload[0].taskCount) * 100 : 0}%`,
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 lg:gap-8">
        <div className="lg:col-span-5 bg-surface-dark border border-border-dark rounded-2xl p-8">
          <h3 className="text-xl font-bold text-main mb-8">
            Priority Breakdown
          </h3>
          <div className="space-y-5">
            {[
              {
                label: "Urgent",
                count: visibleTasks.filter((t) => t.priority === "urgent")
                  .length,
                color: "bg-red-400",
              },
              {
                label: "High",
                count: visibleTasks.filter((t) => t.priority === "high").length,
                color: "bg-orange-400",
              },
              {
                label: "Medium",
                count: visibleTasks.filter((t) => t.priority === "medium")
                  .length,
                color: "bg-yellow-400",
              },
              {
                label: "Low",
                count: visibleTasks.filter((t) => t.priority === "low").length,
                color: "bg-emerald-400",
              },
            ].map((p) => {
              const maxCount = Math.max(
                visibleTasks.filter((t) => t.priority === "urgent").length,
                visibleTasks.filter((t) => t.priority === "high").length,
                visibleTasks.filter((t) => t.priority === "medium").length,
                visibleTasks.filter((t) => t.priority === "low").length,
                1,
              );
              return (
                <div key={p.label} className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-bold">
                    <div className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${p.color}`}></span>
                      <span className="text-text-secondary uppercase">
                        {p.label}
                      </span>
                    </div>
                    <span className="text-main">{p.count} tasks</span>
                  </div>
                  <div className="h-2 w-full bg-background-dark rounded-full overflow-hidden">
                    <div
                      className={`h-full ${p.color} transition-all`}
                      style={{ width: `${(p.count / maxCount) * 100}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 bg-surface-dark border border-border-dark rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border-dark flex items-center justify-between">
            <h3 className="text-lg font-bold text-main">
              Recent High Priority Tasks
            </h3>
            <div className="flex gap-2">
              <button className="cursor-pointer material-symbols-outlined text-text-secondary hover:text-white">
                filter_list
              </button>
            </div>
          </div>
          {recentUrgentTasks.length === 0 ? (
            <div className="p-10 text-center text-text-secondary text-sm">
              No high priority tasks
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left">
                <thead>
                  <tr className="bg-background-dark/30 border-b border-border-dark">
                    <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                      Task Name
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                      Status
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                      Due Date
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                      Est.
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark/30">
                  {recentUrgentTasks.map((task) => (
                    <tr
                      key={task.id}
                      className="hover:bg-white/1 transition-all"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          {task.priority === "urgent" && (
                            <span className="material-symbols-outlined text-red-500 text-[18px]">
                              error
                            </span>
                          )}
                          <span className="text-sm font-bold text-main line-clamp-1">
                            {task.title}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${STATUS_STYLE[task.status] || ""}`}
                        >
                          {task.status}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-xs text-text-secondary">
                        {formatDueDate(task.dueDate)}
                      </td>
                      <td className="px-6 py-5 text-xs text-text-secondary">
                        {task.estimatedHours ? `${task.estimatedHours}h` : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const TAG_COLORS = [
    "bg-primary",
    "bg-emerald-400",
    "bg-orange-400",
    "bg-red-400",
  ];

  const renderTeamPerformance = () => {
    if (teamAnalyticsLoading) {
      return (
        <div className="bg-surface-dark border border-border-dark rounded-2xl p-10 text-center text-text-secondary">
          Loading team analytics...
        </div>
      );
    }

    if (teamAnalyticsError) {
      return (
        <div className="bg-surface-dark border border-red-500/30 rounded-2xl p-10 text-center text-red-300">
          {teamAnalyticsError}
        </div>
      );
    }

    if (!teamAnalytics) {
      return (
        <div className="bg-surface-dark border border-border-dark rounded-2xl p-10 text-center text-text-secondary">
          No team analytics available.
        </div>
      );
    }

    const trendPeak = Math.max(
      ...teamAnalytics.trend.map((point) =>
        Math.max(point.completed, point.created),
      ),
      1,
    );

    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              label: "Completion Rate",
              value: `${teamAnalytics.completionRate}%`,
              sub: `${teamAnalytics.completedTasks} of ${teamAnalytics.tasksCount} tasks`,
              icon: "percent",
              color: "text-primary",
            },
            {
              label: "Open Work",
              value: teamAnalytics.inProgressTasks.toString(),
              sub: "currently in progress",
              icon: "hourglass_top",
              color: "text-purple-400",
            },
            {
              label: "Overdue Risk",
              value: teamAnalytics.overdueTasks.toString(),
              sub:
                teamAnalytics.overdueTasks > 0
                  ? "needs attention"
                  : "all due dates healthy",
              icon: "warning",
              color: "text-orange-400",
            },
            {
              label: "Effort Logged",
              value: `${teamAnalytics.loggedHours.toFixed(1)}h`,
              sub: `${teamAnalytics.estimatedHours.toFixed(1)}h estimated`,
              icon: "timer",
              color: "text-pink-400",
            },
          ].map((kpi, idx) => (
            <div
              key={idx}
              className="bg-surface-dark border border-border-dark p-6 rounded-2xl shadow-sm hover:border-primary/30 transition-all"
            >
              <div className="flex justify-between items-start mb-4">
                <div
                  className={`size-10 rounded-xl bg-background-dark border border-border-dark flex items-center justify-center ${kpi.color}`}
                >
                  <span className="material-symbols-outlined">{kpi.icon}</span>
                </div>
                <span className="text-[10px] font-black text-text-secondary uppercase tracking-widest">
                  {teamAnalytics.scope.memberCount} members
                </span>
              </div>
              <p className="text-text-secondary text-[10px] font-bold uppercase tracking-widest mb-1">
                {kpi.label}
              </p>
              <div className="flex items-baseline gap-2">
                <h3 className="text-2xl font-black text-main">{kpi.value}</h3>
                <span className="text-[10px] text-text-secondary font-medium">
                  {kpi.sub}
                </span>
              </div>
              {idx === 0 && (
                <div className="mt-4 h-1 w-full bg-background-dark rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${teamAnalytics.completionRate}%` }}
                  ></div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 bg-surface-dark border border-border-dark rounded-2xl p-8">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-main">Flow Trend</h3>
              <div className="flex items-center gap-4 text-[10px] font-black text-text-secondary uppercase">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-primary"></span>
                  Completed
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-emerald-400"></span>
                  Created
                </span>
              </div>
            </div>
            <p className="text-xs text-text-secondary mb-12">
              Weekly created vs completed tasks for {teamAnalytics.scope.name}
            </p>
            <div className="h-72 flex items-end justify-between gap-3 px-2 relative">
              <div className="absolute inset-0 flex flex-col justify-between py-2 opacity-10 pointer-events-none">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="w-full h-px bg-white"></div>
                ))}
              </div>
              {teamAnalytics.trend.map((point) => (
                <div
                  key={point.key}
                  className="flex-1 flex items-end justify-center gap-2 h-full"
                >
                  <div
                    className="w-5 bg-emerald-400/80 rounded-t-lg relative group"
                    style={{
                      height: `${Math.max(Math.round((point.created / trendPeak) * 100), 4)}%`,
                    }}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-main opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {point.created} created
                    </div>
                  </div>
                  <div
                    className="w-5 bg-primary rounded-t-lg relative group"
                    style={{
                      height: `${Math.max(Math.round((point.completed / trendPeak) * 100), 4)}%`,
                    }}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-[10px] font-bold text-main opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {point.completed} completed
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between px-2 text-[10px] font-bold text-text-secondary uppercase tracking-widest pt-6 mt-2 border-t border-white/5">
              {teamAnalytics.trend.map((point) => (
                <span key={point.key}>{point.label}</span>
              ))}
            </div>
          </div>

          <div className="lg:col-span-4 bg-surface-dark border border-border-dark rounded-2xl p-8">
            <h3 className="text-xl font-bold text-main mb-8">Workload by Tag</h3>
            {teamAnalytics.tagBreakdown.length === 0 ? (
              <p className="text-sm text-text-secondary">
                No tagged tasks in this scope.
              </p>
            ) : (
              <div className="space-y-5">
                {teamAnalytics.tagBreakdown.map((item, index) => (
                  <div key={item.label} className="space-y-2">
                    <div className="flex justify-between items-center text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <span
                          className={`size-2 rounded-full ${TAG_COLORS[index] || "bg-white/30"}`}
                        ></span>
                        <span className="text-text-secondary uppercase">
                          {item.label}
                        </span>
                      </div>
                      <span className="text-main">
                        {item.taskCount} tasks
                      </span>
                    </div>
                    <div className="h-2 w-full bg-background-dark rounded-full overflow-hidden">
                      <div
                        className={`${TAG_COLORS[index] || "bg-white/30"} h-full`}
                        style={{
                          width: `${teamAnalytics.tasksCount > 0 ? (item.taskCount / teamAnalytics.tasksCount) * 100 : 0}%`,
                        }}
                      ></div>
                    </div>
                    <p className="text-[10px] text-text-secondary">
                      {item.estimatedHours.toFixed(1)} estimated hours
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 bg-surface-dark border border-border-dark rounded-2xl p-8 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-lg font-bold text-main">Member Workload</h3>
              <span className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                Health-first view
              </span>
            </div>
            {teamAnalytics.members.length === 0 ? (
              <p className="text-text-secondary text-sm">
                No assigned work in this scope yet.
              </p>
            ) : (
              <div className="space-y-5">
                {teamAnalytics.members.map((member) => (
                  <div
                    key={member.id}
                    className="border border-border-dark rounded-2xl p-4 bg-background-dark/30"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={member.avatar}
                          className="size-10 rounded-xl border border-border-dark"
                          alt=""
                        />
                        <div>
                          <p className="text-sm font-bold text-main">{member.name}</p>
                          <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                            {member.openTasks} open • {member.overdueTasks} overdue
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-right">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                            Completion
                          </p>
                          <p className="text-sm font-bold text-main">
                            {member.completionRate}%
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                            Estimated
                          </p>
                          <p className="text-sm font-bold text-main">
                            {member.estimatedHours.toFixed(1)}h
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-text-secondary">
                            Logged
                          </p>
                          <p className="text-sm font-bold text-main">
                            {member.loggedHours.toFixed(1)}h
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 h-2 w-full bg-background-dark rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${Math.min(member.completionRate, 100)}%`,
                        }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-surface-dark border border-border-dark rounded-2xl p-8 shadow-sm">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-lg font-bold text-main">Status Distribution</h3>
              <span className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                {teamAnalytics.tasksCount} scoped tasks
              </span>
            </div>
            <div className="space-y-5">
              {teamAnalytics.statusCounts.map((status) => (
                <div key={status.status} className="space-y-2">
                  <div className="flex justify-between items-center text-[11px] font-bold">
                    <span className="text-text-secondary capitalize">
                      {status.status.replace("-", " ")}
                    </span>
                    <span className="text-main">{status.count} tasks</span>
                  </div>
                  <div className="h-2 w-full bg-background-dark rounded-full overflow-hidden">
                    <div
                      className={`${STATUS_BAR_STYLE[status.status] || "bg-white/20"} h-full rounded-full`}
                      style={{
                        width: `${teamAnalytics.tasksCount > 0 ? (status.count / teamAnalytics.tasksCount) * 100 : 0}%`,
                      }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-surface-dark border border-border-dark rounded-2xl overflow-hidden shadow-sm">
          <div className="p-6 border-b border-border-dark flex items-center justify-between">
            <h3 className="text-lg font-bold text-main">At-Risk Tasks</h3>
            <span className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
              {teamAnalytics.riskTasks.length} tasks
            </span>
          </div>
          {teamAnalytics.riskTasks.length === 0 ? (
            <div className="p-10 text-center text-text-secondary text-sm">
              No overdue or high-risk tasks in this scope.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-background-dark/30 border-b border-border-dark">
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Task
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Assignee
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Status
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Due
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">
                    Effort
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark/30">
                {teamAnalytics.riskTasks.map((task) => (
                  <tr
                    key={task.id}
                    className="hover:bg-white/[0.01] transition-all"
                  >
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold text-main line-clamp-1">
                          {task.title}
                        </span>
                        <span className="text-[10px] uppercase tracking-widest text-text-secondary">
                          {task.priority}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-xs text-text-secondary">
                      {task.assigneeName}
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${STATUS_STYLE[task.status] || "bg-white/5 border-border-dark text-text-secondary"}`}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-xs text-text-secondary">
                      {task.daysOverdue > 0
                        ? `${task.daysOverdue}d overdue`
                        : formatDueDate(task.dueDate)}
                    </td>
                    <td className="px-6 py-5 text-xs text-text-secondary">
                      {task.loggedHours.toFixed(1)}h / {task.estimatedHours.toFixed(1)}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };


  return (
    <div className="h-full overflow-y-auto no-scrollbar bg-background-dark p-6 lg:p-10">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-8">
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6 border-b border-border-dark pb-8">
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span
                  className="text-text-secondary text-sm font-medium hover:text-main cursor-pointer transition-colors"
                  onClick={() => setActiveView("workspace")}
                >
                  Dashboard
                </span>
                {activeView !== "workspace" && (
                  <>
                    <span className="material-symbols-outlined text-[16px] text-text-secondary">
                      chevron_right
                    </span>
                    <span className="text-main font-bold capitalize">
                      {activeView} Reports
                    </span>
                  </>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-main tracking-tight leading-tight">
                {activeView === "workspace"
                  ? "Reporting & Analytics"
                  : activeView === "project"
                    ? "Project Progress Reports"
                    : "Team Performance"}
              </h1>
              <p className="text-text-secondary">
                Track key performance indicators and visualize workspace data.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:gap-3 sm:shrink-0">
            <div className="flex items-center justify-between sm:justify-end gap-2">
              <div className="flex items-center gap-2 p-1 bg-surface-dark border border-border-dark rounded-xl">
                {[
                  { id: "workspace", icon: "grid_view" },
                  { id: "project", icon: "folder" },
                  { id: "team", icon: "group" },
                ].map((view) => (
                  <button
                    type="button"
                    key={view.id}
                    onClick={() => setActiveView(view.id as AnalyticsView)}
                    className={`cursor-pointer size-9 rounded-lg flex items-center justify-center transition-all ${activeView === view.id ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-text-secondary hover:text-main"}`}
                    title={`${view.id.charAt(0).toUpperCase() + view.id.slice(1)} Analytics`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {view.icon}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleExport}
                className="cursor-pointer bg-primary hover:bg-blue-600 text-white px-3 sm:px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-primary/20 transition-all flex items-center gap-2 active:scale-95"
              >
                <span className="material-symbols-outlined text-[18px]">
                  download
                </span>
                <span className="hidden sm:inline">Export Report</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="relative group flex-1 sm:flex-none sm:w-48">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm">
                  sprint
                </span>
                <select
                  aria-label="Filter by sprint"
                  value={selectedSprintFilterId}
                  onChange={(e) => setSelectedSprintFilterId(e.target.value)}
                  className="w-full bg-surface-dark border border-border-dark rounded-xl pl-9 pr-8 py-2 text-xs font-bold text-main focus:ring-1 focus:ring-primary appearance-none cursor-pointer outline-none"
                >
                  <option value="all">All Sprints</option>
                  {activeSprint && (
                    <option value={activeSprint.id}>
                      Current Sprint — {activeSprint.name}
                    </option>
                  )}
                  {completedSprints.length > 0 && (
                    <optgroup label="Previous Sprints">
                      {completedSprints.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm pointer-events-none">
                  expand_more
                </span>
              </div>

              {activeView === "project" && (
                <div className="relative group flex-1 sm:flex-none sm:w-48">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm">
                    folder
                  </span>
                  <select
                    aria-label="Select project"
                    value={selectedProjectId || ""}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full bg-surface-dark border border-border-dark rounded-xl pl-9 pr-8 py-2 text-xs font-bold text-main focus:ring-1 focus:ring-primary appearance-none cursor-pointer outline-none"
                    disabled={projects.length === 0}
                  >
                    {projects.length === 0 ? (
                      <option value="">No projects</option>
                    ) : (
                      projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))
                    )}
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm pointer-events-none">
                    expand_more
                  </span>
                </div>
              )}

              {activeView === "team" && (
                <div className="relative group flex-1 sm:flex-none sm:w-48">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm">
                    group
                  </span>
                  <select
                    aria-label="Select team"
                    value={selectedTeamId}
                    onChange={(e) => setSelectedTeamId(e.target.value)}
                    className="w-full bg-surface-dark border-border-dark rounded-xl pl-9 pr-8 py-2 text-xs font-bold text-main focus:ring-1 focus:ring-primary appearance-none cursor-pointer outline-none"
                  >
                    {teamScopeOptions.map((scope) => (
                      <option key={scope.id} value={scope.id}>
                        {scope.name}
                      </option>
                    ))}
                  </select>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-text-secondary text-sm pointer-events-none">
                    expand_more
                  </span>
                </div>
              )}
            </div>
          </div>
        </header>

        {activeView === "workspace" && renderWorkspaceDashboard()}
        {activeView === "project" && renderProjectReport()}
        {activeView === "team" && renderTeamPerformance()}

        <div className="h-20"></div>
      </div>
    </div>
  );
};

export default function AnalyticsPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center bg-background-dark">
          <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <AnalyticsPageInner />
    </Suspense>
  );
}
