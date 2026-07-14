"use client";

import React, { useCallback, useEffect, useState } from "react";
import { WorkspaceFile, WorkspaceFolder } from "@/types/files";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
]);

function fileIcon(type: string): string {
  if (IMAGE_TYPES.has(type)) return "image";
  if (type === "application/json") return "data_object";
  if (type.includes("markdown") || type.includes("md")) return "description";
  if (type === "text/csv") return "table_chart";
  return "article";
}

interface BreadcrumbEntry {
  id: string | null;
  name: string;
}

interface WorkspaceFilePickerProps {
  workspaceId: string;
  onSelect: (file: WorkspaceFile) => void;
  onClose: () => void;
}

export function WorkspaceFilePicker({
  workspaceId,
  onSelect,
  onClose,
}: WorkspaceFilePickerProps) {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([
    { id: null, name: "Root" },
  ]);
  const [isLoading, setIsLoading] = useState(true);

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1].id;

  const fetchContents = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (currentFolderId) params.set("folder_id", currentFolderId);
      const res = await authenticatedFetch(`/api/files?${params}`);
      const data = (await res.json()) as {
        folders: WorkspaceFolder[];
        files: WorkspaceFile[];
      };
      setFolders(data.folders);
      setFiles(data.files);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, currentFolderId]);

  useEffect(() => {
    fetchContents();
  }, [fetchContents]);

  const openFolder = (folder: WorkspaceFolder) => {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 dismiss-backdrop"
      onClick={onClose}
    >
      <div
        className="cursor-pointer relative flex h-[480px] w-full max-w-md flex-col rounded-xl border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Attach from Files
          </h2>
          <button
            onClick={onClose}
            className="cursor-pointer text-text-secondary hover:text-text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 border-b border-border px-4 py-2 text-xs">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-text-secondary/40">/</span>}
              <button
                onClick={() => navigateTo(i)}
                className={`cursor-pointer rounded px-1 py-0.5 transition-colors ${
                  i === breadcrumbs.length - 1
                    ? "text-text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {/* Contents */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <span className="material-symbols-outlined animate-spin text-xl text-text-secondary">
                progress_activity
              </span>
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="material-symbols-outlined text-3xl text-text-secondary/40">
                folder_open
              </span>
              <p className="text-xs text-text-secondary">No files here</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => openFolder(folder)}
                  className="cursor-pointer flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-bg-hover transition-colors"
                >
                  <span className="material-symbols-outlined text-xl text-primary">
                    folder
                  </span>
                  <span className="text-sm text-text-primary truncate">
                    {folder.name}
                  </span>
                </button>
              ))}
              {files.map((file) => (
                <button
                  key={file.id}
                  onClick={() => onSelect(file)}
                  className="cursor-pointer flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-accent/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-xl text-text-secondary">
                    {fileIcon(file.file_type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">
                      {file.file_name}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {file.file_type}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
