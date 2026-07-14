import React from "react";

interface DashboardStats {
  totalTasks: number;
  completedTasks: number;
}

export const StatCard: React.FC<{ stats: DashboardStats }> = ({ stats }) => {
  const completionRate =
    stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  return (
    <div className="lg:col-span-3 bg-surface-dark border border-border-dark p-6 rounded-2xl relative overflow-hidden group">
      <div className="absolute -right-8 -top-8 size-32 bg-primary/20 rounded-full blur-3xl group-hover:bg-primary/30 transition-all"></div>
      <div className="flex justify-between items-start z-10 relative">
        <span className="text-text-secondary text-xs font-bold uppercase tracking-wider">
          Flow State
        </span>
        <span className="material-symbols-outlined text-primary">bolt</span>
      </div>
      <div className="mt-6 z-10 relative">
        <div className="flex items-baseline gap-2">
          <h3 className="text-5xl font-black text-main">{completionRate}%</h3>
          <span className="text-emerald-400 text-xs font-bold">Completion</span>
        </div>
        <div className="w-full h-1.5 bg-background-dark rounded-full mt-4 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full shadow-[0_0_8px_rgba(25,93,230,0.5)]"
            style={{ width: `${completionRate}%` }}
          ></div>
        </div>
      </div>
    </div>
  );
};
