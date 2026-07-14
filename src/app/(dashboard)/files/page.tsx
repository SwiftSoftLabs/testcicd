"use client";

import React from "react";
import { useAppContext } from "@/context/AppContext";
import { FileBrowser } from "@/components/files/FileBrowser";

export default function FilesPage() {
  const { selectedWorkspaceId } = useAppContext();

  if (!selectedWorkspaceId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span className="material-symbols-outlined text-4xl text-text-secondary/40">
          folder_off
        </span>
        <p className="text-sm text-text-secondary">
          Select a workspace to view files.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <h1 className="text-xl font-semibold text-text-primary">Files</h1>
        <p className="text-sm text-text-secondary">Workspace cloud storage</p>
      </div>
      <div className="flex-1 min-h-0">
        <FileBrowser workspaceId={selectedWorkspaceId} />
      </div>
    </div>
  );
}
