"use client";

import React from "react";
import { useUIContext } from "@/context/UIContext";

const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useUIContext();

  return (
    <div className="fixed bottom-6 right-6 z-[120] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto min-w-[300px] flex items-center justify-between gap-4 px-4 py-3 rounded-xl border shadow-2xl animate-in slide-in-from-right-10 fade-in duration-300 ${
            toast.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : toast.type === "error"
                ? "bg-red-500/10 border-red-500/20 text-red-400"
                : toast.type === "warning"
                  ? "bg-orange-500/10 border-orange-500/20 text-orange-400"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-400"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[20px]">
              {toast.type === "success"
                ? "check_circle"
                : toast.type === "error"
                  ? "error"
                  : toast.type === "warning"
                    ? "warning"
                    : "info"}
            </span>
            <span className="text-sm font-bold">{toast.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick();
                  removeToast(toast.id);
                }}
                className="cursor-pointer text-current text-xs font-bold underline underline-offset-2 opacity-80 hover:opacity-100"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => removeToast(toast.id)}
              className="cursor-pointer text-current opacity-60 hover:opacity-100"
            >
              <span className="material-symbols-outlined text-[18px]">
                close
              </span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
