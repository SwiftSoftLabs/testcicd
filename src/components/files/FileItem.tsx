"use client";

import React from "react";
import { WorkspaceFile, ViewMode } from "@/types/files";
import { format } from "date-fns";

interface FileItemProps {
  file: WorkspaceFile;
  viewMode: ViewMode;
  isDragging?: boolean;
  onDelete: (file: WorkspaceFile) => void;
  onDownload: (file: WorkspaceFile) => void;
  onPreview: (file: WorkspaceFile) => void;
  onDuplicate: (file: WorkspaceFile) => void;
  onCopyTo: (file: WorkspaceFile) => void;
  onDragStart: (file: WorkspaceFile) => void;
  onDragEnd: () => void;
}

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
  if (type === "application/pdf") return "picture_as_pdf";
  if (type === "application/msword" || type.includes("wordprocessingml"))
    return "description";
  if (type === "application/json") return "data_object";
  if (type.includes("markdown") || type.includes("md")) return "description";
  if (type === "text/csv") return "table_chart";
  return "article";
}

function mimeLabel(type: string): string {
  if (IMAGE_TYPES.has(type)) return "Image";
  if (type === "application/pdf") return "PDF Document";
  if (type === "application/msword") return "Word Document";
  if (type.includes("wordprocessingml")) return "Word Document";
  if (type === "application/json") return "JSON";
  if (type.includes("markdown")) return "Markdown";
  if (type === "text/csv") return "CSV";
  if (type === "text/plain") return "Text";
  return "File";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function FileItem({
  file,
  viewMode,
  isDragging,
  onDelete,
  onDownload,
  onPreview,
  onDuplicate,
  onCopyTo,
  onDragStart,
  onDragEnd,
}: FileItemProps) {
  const draggingClass = isDragging ? "opacity-40" : "";

  if (viewMode === "icon") {
    return (
      <div
        draggable
        onDragStart={() => onDragStart(file)}
        onDragEnd={onDragEnd}
        className={`group relative flex w-36 flex-col items-center gap-2 rounded-xl border border-border bg-bg-secondary p-3 hover:border-border-hover transition-colors cursor-grab active:cursor-grabbing ${draggingClass}`}
        onClick={() => onPreview(file)}
      >
        <span className="material-symbols-outlined text-5xl text-text-secondary mt-1">
          {fileIcon(file.file_type)}
        </span>
        <p className="w-full truncate text-center text-xs font-medium text-text-primary">
          {file.file_name}
        </p>
        <div className="absolute inset-0 flex items-end justify-center gap-1 rounded-xl bg-bg-main/80 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPreview(file);
            }}
            className="cursor-pointer p-1.5 rounded-md bg-bg-surface hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Preview"
          >
            <span className="material-symbols-outlined text-sm">
              visibility
            </span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload(file);
            }}
            className="cursor-pointer p-1.5 rounded-md bg-bg-surface hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Download"
          >
            <span className="material-symbols-outlined text-sm">download</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(file);
            }}
            className="cursor-pointer p-1.5 rounded-md bg-bg-surface hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Duplicate"
          >
            <span className="material-symbols-outlined text-sm">
              content_copy
            </span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopyTo(file);
            }}
            className="cursor-pointer p-1.5 rounded-md bg-bg-surface hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Copy to folder"
          >
            <span className="material-symbols-outlined text-sm">
              drive_file_move
            </span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(file);
            }}
            className="cursor-pointer p-1.5 rounded-md bg-bg-surface hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
            title="Delete"
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
        draggable
        onDragStart={() => onDragStart(file)}
        onDragEnd={onDragEnd}
        className={`group grid grid-cols-[2fr_1fr] sm:grid-cols-[2fr_1fr_1fr] lg:grid-cols-[2fr_1fr_1fr_1fr] items-center gap-4 rounded-lg px-3 py-2 hover:bg-bg-hover transition-colors cursor-grab active:cursor-grabbing ${draggingClass}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-lg text-text-secondary shrink-0">
            {fileIcon(file.file_type)}
          </span>
          <button
            type="button"
            onClick={() => onPreview(file)}
            className="cursor-pointer truncate text-sm font-medium text-text-primary hover:text-accent text-left"
          >
            {file.file_name}
          </button>
        </div>
        <span className="hidden lg:block text-xs text-text-secondary">
          {mimeLabel(file.file_type)}
        </span>
        <span className="hidden sm:block text-xs text-text-secondary">
          {formatBytes(file.file_size)}
        </span>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-secondary">
            {format(new Date(file.created_at), "MMM d, yyyy")}
          </span>
          <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onPreview(file)}
              className="cursor-pointer p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title="Preview"
            >
              <span className="material-symbols-outlined text-sm">
                visibility
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDownload(file)}
              className="cursor-pointer p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title="Download"
            >
              <span className="material-symbols-outlined text-sm">
                download
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDuplicate(file)}
              className="cursor-pointer p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title="Duplicate"
            >
              <span className="material-symbols-outlined text-sm">
                content_copy
              </span>
            </button>
            <button
              type="button"
              onClick={() => onCopyTo(file)}
              className="cursor-pointer p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              title="Copy to folder"
            >
              <span className="material-symbols-outlined text-sm">
                drive_file_move
              </span>
            </button>
            <button
              type="button"
              onClick={() => onDelete(file)}
              className="cursor-pointer p-1 rounded hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
              title="Delete"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={() => onDragStart(file)}
      onDragEnd={onDragEnd}
      className={`group relative flex items-center gap-3 rounded-lg border border-border bg-bg-secondary p-3 hover:border-border-hover transition-colors cursor-grab active:cursor-grabbing ${draggingClass}`}
    >
      <span className="material-symbols-outlined text-2xl text-text-secondary shrink-0">
        {fileIcon(file.file_type)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">
          {file.file_name}
        </p>
        <p className="whitespace-nowrap text-xs text-text-secondary">
          {formatBytes(file.file_size)} ·{" "}
          {format(new Date(file.created_at), "MMM d, yyyy")}
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => onPreview(file)}
          className="cursor-pointer p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="Preview"
        >
          <span className="material-symbols-outlined text-base">
            visibility
          </span>
        </button>
        <button
          type="button"
          onClick={() => onDownload(file)}
          className="cursor-pointer p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="Download"
        >
          <span className="material-symbols-outlined text-base">download</span>
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(file)}
          className="cursor-pointer p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="Duplicate"
        >
          <span className="material-symbols-outlined text-base">
            content_copy
          </span>
        </button>
        <button
          type="button"
          onClick={() => onCopyTo(file)}
          className="cursor-pointer p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="Copy to folder"
        >
          <span className="material-symbols-outlined text-base">
            drive_file_move
          </span>
        </button>
        <button
          type="button"
          onClick={() => onDelete(file)}
          className="cursor-pointer p-1.5 rounded-md hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-colors"
          title="Delete"
        >
          <span className="material-symbols-outlined text-base">delete</span>
        </button>
      </div>
    </div>
  );
}
