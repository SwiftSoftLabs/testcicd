"use client";

import React, { useState, useRef, useMemo } from "react";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { useClickOutside } from "@/hooks/useClickOutside";
import { api, WorkspaceMember } from "@/lib/api";

interface InviteToProjectModalProps {
  onClose: () => void;
  user?: WorkspaceMember;
  onInviteSuccess?: (projectId: string) => void;
}

const InviteToProjectModal: React.FC<InviteToProjectModalProps> = ({
  onClose,
  user,
  onInviteSuccess,
}) => {
  const { addToast } = useUIContext();
  const { workspaces, projects, selectedWorkspaceId } = useAppContext();
  const modalRef = useRef<HTMLDivElement>(null);
  const [workspace, setWorkspace] = useState(
    selectedWorkspaceId || (workspaces[0]?.id ?? ""),
  );
  const [project, setProject] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useClickOutside(modalRef, onClose);

  // Filter to UUID-only IDs — demo/mock projects (e.g. "proj-productivity-suite") are excluded
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const availableProjects = useMemo(
    () => projects.filter((p) => UUID_RE.test(p.id)),
    [projects],
  );
  const selectedProject = availableProjects.find((p) => p.id === project) ?? null;
  const readOnly = selectedProject?.quota_locked === true;

  // Set default project when availableProjects changes
  React.useEffect(() => {
    if (availableProjects.length > 0) {
      setProject(availableProjects[0].id);
    } else {
      setProject("");
    }
  }, [availableProjects]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) {
      addToast("This project is read-only because your workspace is over its plan limit.", "warning");
      return;
    }
    if (!project) {
      addToast("Please select a project.", "error");
      return;
    }
    if (!user?.id) {
      addToast("No user selected.", "error");
      return;
    }

    setIsSubmitting(true);
    try {
      await api.projectMembers.assign(project, user.id);
      const selectedProject = availableProjects.find((p) => p.id === project);
      addToast(
        `${user.name} assigned to ${selectedProject?.name || "Project"}`,
        "success",
      );
      if (onInviteSuccess) onInviteSuccess(project);
      onClose();
    } catch (err: unknown) {
      addToast(
        err instanceof Error ? err.message : "Failed to assign user.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={modalRef}
      className="w-full max-w-md mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 m-4"
    >
      <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            folder_shared
          </span>
          Assign to Project
        </h2>
        <button
          onClick={onClose}
          className="cursor-pointer text-text-secondary hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {user && (
          <div className="flex items-center gap-3 p-3 bg-background-dark/50 border border-border-dark rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={user.avatar}
              className="size-10 rounded-full border border-border-dark object-cover"
              alt=""
            />
            <div>
              <p className="text-sm font-bold text-white">{user.name}</p>
              <p className="text-[10px] text-text-secondary">{user.email}</p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {readOnly && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-200">
              This project is read-only because your workspace is over its plan limit. Upgrade to assign members.
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Select Workspace
            </label>
            <select
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all cursor-pointer outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Select Project
            </label>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all cursor-pointer outline-none"
              disabled={availableProjects.length === 0}
            >
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id} disabled={p.quota_locked === true}>
                  {p.name}{p.quota_locked ? " (read-only)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !project || readOnly}
            className="px-8 py-2.5 bg-primary text-white text-sm font-black rounded-xl shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
          >
            {isSubmitting ? "Assigning..." : "Assign User"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default InviteToProjectModal;
