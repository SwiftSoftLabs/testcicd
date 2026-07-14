"use client";

import React, { useMemo } from "react";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip } from "recharts";
import { Commit, Task } from "@/types";

interface VelocityChartProps {
  tasks: Task[];
  commits: Commit[];
  className?: string;
}

function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const VelocityChart: React.FC<VelocityChartProps> = ({
  tasks,
  commits,
  className = "lg:col-span-12",
}) => {
  const data = useMemo(() => {
    const days: Array<{
      key: string;
      label: string;
      tasks: number;
      commits: number;
    }> = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(now);
      day.setDate(now.getDate() - i);
      days.push({
        key: toDayKey(day),
        label: day.toLocaleDateString([], { weekday: "short" }),
        tasks: 0,
        commits: 0,
      });
    }

    const dayIndex = new Map(days.map((day) => [day.key, day]));

    tasks.forEach((task) => {
      if (task.status !== "done") return;
      const source = task.updatedAt || task.createdAt;
      if (!source) return;
      const key = toDayKey(new Date(source));
      const bucket = dayIndex.get(key);
      if (bucket) bucket.tasks += 1;
    });

    commits.forEach((commit) => {
      if (!commit.created_at) return;
      const key = toDayKey(new Date(commit.created_at));
      const bucket = dayIndex.get(key);
      if (bucket) bucket.commits += 1;
    });

    return days;
  }, [tasks, commits]);

  return (
    <div
      className={`${className} bg-surface-dark border border-border-dark rounded-2xl p-6 flex flex-col min-h-[340px]`}
    >
      <div className="flex items-center justify-between mb-8">
        <div>
          <h3 className="text-main text-lg font-bold">Velocity Metrics</h3>
          <p className="text-text-secondary text-xs">
            Last 7 days: completed tasks and commits
          </p>
        </div>
        <div className="flex gap-3">
          <span className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="size-2 rounded-full bg-primary" />
            Commits
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span className="size-2 rounded-full bg-emerald-500" />
            Tasks
          </span>
        </div>
      </div>
      <div className="flex-1 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis
              dataKey="label"
              stroke="#484f58"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--bg-surface)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                color: "var(--text-primary)",
              }}
              itemStyle={{ fontSize: "12px" }}
              cursor={{ fill: "rgba(255,255,255,0.05)" }}
            />
            <Bar dataKey="commits" fill="#195de6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="tasks" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
