"use client";

import React from "react";
import { WorkspaceFolder, ViewMode } from "@/types/files";
import { format } from "date-fns";

interface FolderItemProps {
  folder: WorkspaceFolder;
  viewMode: ViewMode;
  isDragOver?: boolean;
  onOpen: (folder: WorkspaceFolder) => void;
  onDelete: (folder: WorkspaceFolder) => void;
  onDragOver?: () => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
}

function dragProps(
  onDragOver?: () => void,
  onDragLeave?: () => void,
  onDrop?: () => void,
) {
  return {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      onDragOver?.();
    },
    onDragLeave: () => onDragLeave?.(),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      onDrop?.();
    },
  };
}

export function FolderItem({
  folder,
  viewMode,
  isDragOver,
  onOpen,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderItemProps) {
  const dropHandlers = dragProps(onDragOver, onDragLeave, onDrop);
  const ringClass = isDragOver ? "ring-2 ring-accent" : "";

  if (viewMode === "icon") {
    return (
      <div
        className={`group relative flex w-36 flex-col items-center gap-2 rounded-xl border border-border bg-bg-secondary p-3 hover:border-border-hover cursor-pointer transition-colors ${ringClass}`}
        onClick={() => onOpen(folder)}
        {...dropHandlers}
      >
        <span className="material-symbols-outlined text-5xl text-primary mt-1">
          folder
        </span>
        <p className="w-full truncate text-center text-xs font-medium text-text-primary">
          {folder.name}
        </p>
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(folder);
            }}
            className="cursor-pointer p-1 rounded-md hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
            title="Delete folder"
          >
            <span className="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      </div>
    );
  }

  if (viewMode === "details") {
    return (
      <div
        className={`group grid grid-cols-[2fr_1fr] sm:grid-cols-[2fr_1fr_1fr] lg:grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4 rounded-lg px-3 py-2 hover:bg-bg-hover cursor-pointer transition-colors ${ringClass}`}
        onClick={() => onOpen(folder)}
        {...dropHandlers}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-lg text-primary shrink-0">
            folder
          </span>
          <span className="truncate text-sm font-medium text-text-primary">
            {folder.name}
          </span>
        </div>
        <span className="hidden lg:block text-xs text-text-secondary">
          Folder
        </span>
        <span className="hidden sm:block text-xs text-text-secondary">—</span>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-secondary">
            {format(new Date(folder.created_at), "MMM d, yyyy")}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(folder);
            }}
            className="cursor-pointer hidden sm:block p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
            title="Delete folder"
          >
            <span className="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative flex items-center gap-3 rounded-lg border border-border bg-bg-secondary p-3 hover:border-border-hover cursor-pointer transition-colors ${ringClass}`}
      onClick={() => onOpen(folder)}
      {...dropHandlers}
    >
      <span className="material-symbols-outlined text-2xl text-primary shrink-0">
        folder
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
        {folder.name}
      </p>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(folder);
        }}
        className="cursor-pointer hidden sm:block p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
        title="Delete folder"
      >
        <span className="material-symbols-outlined text-base">delete</span>
      </button>
    </div>
  );
}
