"use client";

import React, { useEffect, useMemo, useState } from "react";
import { UpNextCard } from "@/components/dashboard/UpNextCard";
import { PriorityList } from "@/components/dashboard/PriorityList";
import { VelocityChart } from "@/components/dashboard/VelocityChart";
import { RecentComms } from "@/components/dashboard/RecentComms";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { RecentEmailsCard } from "@/components/dashboard/RecentEmailsCard";
import { UpcomingCallsCard } from "@/components/dashboard/UpcomingCallsCard";
import { useAppContext } from "@/context/AppContext";
import { useCreateProjectGuard } from "@/hooks/useCreateProjectGuard";
import { api } from "@/lib/api";
import { getDueUrgency, parseDueDateLocal } from "@/lib/tasks/dueUrgency";
import { EmailMessage, MailAccountStatus, Priority, Project, Task, User } from "@/types";
import Link from "next/link";

interface RecentMessage {
  id: string;
  content: string;
  created_at: string;
  sender?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

const PRIORITY_WEIGHT: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function getTaskUrgencyRank(task: Task): number {
  const dueUrgency = getDueUrgency(task.dueDate);
  if (dueUrgency === "overdue") return 0;
  if (dueUrgency === "today") return 1;
  if (dueUrgency === "future") return 2;
  return 3;
}

function getFutureDueTime(task: Task): number {
  if (!task.dueDate) return Number.POSITIVE_INFINITY;
  const dueDate = parseDueDateLocal(task.dueDate);
  return Number.isNaN(dueDate.getTime())
    ? Number.POSITIVE_INFINITY
    : dueDate.getTime();
}

function getRecencyTime(task: Task): number {
  const source = task.updatedAt ?? task.createdAt;
  if (!source) return 0;
  const parsed = Date.parse(source);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareUpNextTasks(a: Task, b: Task): number {
  const urgencyDelta = getTaskUrgencyRank(a) - getTaskUrgencyRank(b);
  if (urgencyDelta !== 0) return urgencyDelta;

  const futureDueDelta = getFutureDueTime(a) - getFutureDueTime(b);
  if (futureDueDelta !== 0) return futureDueDelta;

  const priorityDelta = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  if (priorityDelta !== 0) return priorityDelta;

  return getRecencyTime(b) - getRecencyTime(a);
}

function ProjectStarterPanel() {
  const openCreateProject = useCreateProjectGuard();

  return (
    <div className="lg:col-span-12 bg-surface-dark border border-border-dark rounded-2xl p-8 lg:p-12 min-h-[380px] flex flex-col justify-center">
      <div className="max-w-2xl">
        <h2 className="text-3xl lg:text-4xl font-black text-main tracking-tight leading-tight">
          Create your first project
        </h2>
        <p className="text-text-secondary mt-3">
          Create a project to start tracking work in this workspace.
        </p>
      </div>
      <div className="mt-8 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          data-tour="create-project"
          onClick={() => void openCreateProject()}
          className="h-14 px-6 cursor-pointer bg-primary text-white rounded-xl text-sm font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:bg-blue-600 transition-colors"
        >
          Create Project
        </button>
        <Link
          href="/settings/workspace"
          className="h-14 px-6 inline-flex items-center justify-center bg-white/5 border border-border-dark text-main rounded-xl text-sm font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
        >
          Manage Projects
        </Link>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const {
    currentUser,
    projects,
    tasks,
    users,
    commits,
    selectedProjectId,
    selectedWorkspaceId,
    workspaces,
    isLoading,
  } = useAppContext();
  const [recentMessages, setRecentMessages] = useState<RecentMessage[]>([]);
  const [recentEmails, setRecentEmails] = useState<EmailMessage[]>([]);
  const [mailboxStatus, setMailboxStatus] = useState<MailAccountStatus | null>(
    null,
  );
  const [emailsLoading, setEmailsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchRecentMessages() {
      if (!selectedWorkspaceId || !currentUser?.id) {
        setRecentMessages([]);
        return;
      }

      try {
        const params = new URLSearchParams({
          workspaceId: selectedWorkspaceId,
          userId: currentUser.id,
        });
        const res = await fetch(
          `/api/chat/messages/recent?${params.toString()}`,
        );
        if (!res.ok) {
          if (!cancelled) setRecentMessages([]);
          return;
        }
        const result = await res.json();
        if (!cancelled) {
          setRecentMessages(Array.isArray(result?.data) ? result.data : []);
        }
      } catch {
        if (!cancelled) setRecentMessages([]);
      }
    }

    void fetchRecentMessages();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, selectedWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function fetchRecentEmails() {
      setEmailsLoading(true);
      try {
        const [status, emails] = await Promise.all([
          api.email.accounts.status(),
          api.email.getRecentInbox(3),
        ]);
        if (!cancelled) {
          setMailboxStatus(status as MailAccountStatus);
          setRecentEmails(
            Array.isArray(emails) ? (emails as EmailMessage[]) : [],
          );
        }
      } catch {
        if (!cancelled) {
          setMailboxStatus({ connected: false, account: null });
          setRecentEmails([]);
        }
      } finally {
        if (!cancelled) setEmailsLoading(false);
      }
    }

    if (selectedWorkspaceId) void fetchRecentEmails();

    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceId]);

  const hasProjects = projects.length > 0;

  const dashboardTasks = useMemo(
    () =>
      selectedProjectId
        ? tasks.filter((task) => task.projectId === selectedProjectId)
        : tasks,
    [selectedProjectId, tasks],
  );

  const priorityTasks = useMemo(
    () =>
      dashboardTasks
        .filter((task) => task.status !== "done")
        .map((task) => ({
          id: task.id,
          title: task.title,
          priority: task.priority,
        })),
    [dashboardTasks],
  );

  const openDashboardTasks = useMemo(
    () =>
      dashboardTasks.filter(
        (task) => task.status !== "done" && !task.parentTaskId,
      ),
    [dashboardTasks],
  );

  const upNextTask = useMemo(() => {
    if (openDashboardTasks.length === 0) return null;
    return [...openDashboardTasks].sort(compareUpNextTasks)[0] ?? null;
  }, [openDashboardTasks]);

  const upNextProject = useMemo<Project | null>(() => {
    if (!upNextTask?.projectId) return null;
    return projects.find((project) => project.id === upNextTask.projectId) ?? null;
  }, [projects, upNextTask]);

  const upNextAssignee = useMemo<User | null>(() => {
    if (!upNextTask?.assigneeId) return null;
    return users.find((user) => user.id === upNextTask.assigneeId) ?? null;
  }, [upNextTask, users]);

  const upNextCounts = useMemo(() => {
    const overdue = openDashboardTasks.filter((task) => {
      return getDueUrgency(task.dueDate) === "overdue";
    }).length;

    const dueToday = openDashboardTasks.filter((task) => {
      return getDueUrgency(task.dueDate) === "today";
    }).length;

    return {
      open: openDashboardTasks.length,
      overdue,
      dueToday,
    };
  }, [openDashboardTasks]);

  const statsData = useMemo(
    () => ({
      totalTasks: dashboardTasks.length,
      completedTasks: dashboardTasks.filter((task) => task.status === "done")
        .length,
      activeProjects: projects.filter((project) => project.status === "active")
        .length,
    }),
    [projects, dashboardTasks],
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background-dark">
        <div className="flex flex-col items-center gap-4">
          <div className="size-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-text-secondary font-bold animate-pulse uppercase tracking-widest text-xs">
            Loading Workspace...
          </p>
        </div>
      </div>
    );
  }

  if (!selectedWorkspaceId) {
    const hasWorkspaces = workspaces.length > 0;
    return (
      <div className="h-full flex items-center justify-center bg-background-dark p-6">
        <div className="max-w-md text-center">
          <span className="material-symbols-outlined text-5xl text-text-secondary/30 mb-4">
            workspaces
          </span>
          <h1 className="text-2xl font-black text-main">
            {hasWorkspaces
              ? "Select a workspace"
              : "Create your first workspace"}
          </h1>
          <p className="text-sm text-text-secondary mt-2">
            {hasWorkspaces
              ? "Choose a workspace from the left sidebar to load your dashboard."
              : "Use Create Workspace in the left sidebar to get started."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 lg:p-8 custom-scrollbar">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-8">
        <DashboardHeader
          userName={currentUser.name}
          stats={statsData}
          showActions={hasProjects}
        />

        {hasProjects ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 auto-rows-fr">
            {selectedWorkspaceId && (
              <UpcomingCallsCard
                workspaceId={selectedWorkspaceId}
                className="lg:col-span-3"
              />
            )}
            <UpNextCard
              task={upNextTask}
              project={upNextProject}
              assignee={upNextAssignee}
              counts={upNextCounts}
            />
            <PriorityList tasks={priorityTasks.slice(0, 4)} />
            <VelocityChart
              tasks={dashboardTasks}
              commits={commits}
              className="lg:col-span-6"
            />
            <RecentEmailsCard
              emails={recentEmails}
              isLoading={emailsLoading}
              connected={Boolean(mailboxStatus?.connected)}
              className="lg:col-span-3"
            />
            <RecentComms messages={recentMessages} className="lg:col-span-3" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 auto-rows-fr">
            <ProjectStarterPanel />
            <RecentEmailsCard
              emails={recentEmails}
              isLoading={emailsLoading}
              connected={Boolean(mailboxStatus?.connected)}
              className="lg:col-span-6"
            />
            <RecentComms messages={recentMessages} className="lg:col-span-6" />
          </div>
        )}
      </div>
      <div className="h-20" />
    </div>
  );
}
