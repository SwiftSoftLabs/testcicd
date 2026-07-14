"use client";

import React from "react";
import { useUIContext } from "@/context/UIContext";

export interface Task {
  id: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
}

interface PriorityListProps {
  tasks: Task[];
}

export const PriorityList: React.FC<PriorityListProps> = ({ tasks }) => {
  const { addToast, openModal } = useUIContext();

  return (
    <div className="lg:col-span-6 bg-surface-dark border border-border-dark rounded-2xl flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-border-dark flex justify-between items-center bg-white/[0.01]">
        <h3 className="text-main font-bold">Priority Tasks</h3>
        <button
          onClick={() => addToast("Opening full priority list...", "info")}
          className="cursor-pointer text-text-secondary hover:text-main transition-colors"
        >
          <span className="material-symbols-outlined">more_horiz</span>
        </button>
      </div>
      <div className="p-4 flex-1 space-y-1 overflow-y-auto no-scrollbar">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => openModal("task-detail", { task })}
            className="flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-all cursor-pointer group"
          >
            <div className="size-5 rounded-full border-2 border-border-dark flex items-center justify-center text-transparent hover:border-primary transition-all">
              <span className="material-symbols-outlined text-[14px]">
                check
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-main truncate group-hover:text-primary transition-colors">
                {task.title}
              </p>
              <div className="flex items-center gap-3 mt-0.5">
                <span
                  className={`text-[10px] font-bold uppercase ${task.priority === "urgent" ? "text-red-400" : "text-orange-400"}`}
                >
                  {task.priority} Priority
                </span>
                <span className="text-[10px] text-text-secondary">
                  {task.id}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
