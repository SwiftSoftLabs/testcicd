"use client";

import React from "react";

interface OnboardingModalProps {
  onStart: () => void;
  variant?: "creator" | "joiner" | "joiner-empty";
  workspaceName?: string;
}

const OnboardingModal: React.FC<OnboardingModalProps> = ({
  onStart,
  variant = "creator",
  workspaceName,
}) => {
  const isJoiner = variant === "joiner";
  const isJoinerEmpty = variant === "joiner-empty";
  const title = isJoiner
    ? `Welcome to ${workspaceName || "your workspace"}!`
    : isJoinerEmpty
      ? `${workspaceName || "This workspace"} is ready for you`
      : "Welcome to OneWork";
  const description = isJoiner
    ? "You've been added to a team workspace. Let's show you around."
    : isJoinerEmpty
      ? "You've joined successfully. Projects and tasks will appear here once your team sets them up."
      : "Your unified workspace for tasks, code, and team communication. We'll guide you through the setup in a few quick steps.";
  const checklist = isJoiner
    ? [
        { icon: "folder_open", label: "See your team's projects" },
        { icon: "task_alt", label: "Find your tasks" },
      ]
    : isJoinerEmpty
      ? [
          { icon: "check_circle", label: "You have access to the workspace" },
          { icon: "groups", label: "Your team can now add projects and tasks" },
        ]
      : [
          { icon: "domain", label: "Create your workspace" },
          { icon: "folder_open", label: "Start your first project" },
          { icon: "group_add", label: "Invite your team" },
        ];
  const buttonLabel = isJoiner
    ? "Show me around →"
    : isJoinerEmpty
      ? "Got it"
      : "Get started →";

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-8 text-center flex flex-col items-center gap-6">
          <div className="size-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-3xl">
              work
            </span>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-white">{title}</h1>
            <p className="text-text-secondary text-sm leading-relaxed max-w-xs mx-auto">
              {description}
            </p>
          </div>
          <div className="w-full space-y-2 text-left bg-background-dark border border-border-dark rounded-xl p-4">
            {checklist.map(({ icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 text-sm text-text-secondary"
              >
                <span className="material-symbols-outlined text-primary text-base">
                  {icon}
                </span>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onStart}
            className="cursor-pointer w-full py-3 bg-primary text-white font-black text-sm uppercase tracking-widest rounded-xl shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all active:scale-95"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;
