"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useUIContext } from "@/context/UIContext";

interface DashboardHeaderStats {
  totalTasks: number;
  completedTasks: number;
}

interface DashboardHeaderProps {
  userName: string;
  stats: DashboardHeaderStats;
  showActions?: boolean;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  userName,
  stats,
  showActions = true,
}) => {
  const router = useRouter();
  const { openModal, addToast } = useUIContext();
  const completionRate =
    stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const handleViewTimeline = () => {
    router.push("/tasks");
    addToast("Switching to Timeline View...", "info");
  };

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="text-3xl font-black text-main tracking-tight leading-tight">
          {getGreeting()}, {userName}
        </h1>
        <p className="text-text-secondary">Welcome back to your workspace.</p>
      </div>
      {showActions && (
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <div className="min-w-[180px] max-w-[220px] flex-1 lg:flex-none">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                Flow State
              </span>
              <span className="text-sm font-black text-main">
                {completionRate}%
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background-dark">
              <div
                className="h-full rounded-full bg-primary shadow-[0_0_8px_rgba(25,93,230,0.5)] transition-all"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>
          <button
            onClick={handleViewTimeline}
            className="cursor-pointer px-4 py-2 bg-surface-dark border border-border-dark text-main rounded-lg text-sm font-semibold hover:bg-white/5 transition-colors"
          >
            View Timeline
          </button>
          <button
            onClick={() => openModal("new-task")}
            className="cursor-pointer px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold shadow-lg shadow-primary/20 hover:bg-blue-600 transition-colors"
          >
            + New Task
          </button>
        </div>
      )}
    </header>
  );
};
