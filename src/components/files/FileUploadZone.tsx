"use client";

import React, { useRef, useState } from "react";

const ALLOWED_EXTENSIONS =
  ".jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.txt,.csv,.md,.json,.pdf,.doc,.docx";

interface FileUploadZoneProps {
  onFiles: (files: File[]) => void;
  uploading: boolean;
  storageLimitLabel?: string;
}

export function FileUploadZone({ onFiles, uploading, storageLimitLabel }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };

  const borderClass = isDragging
    ? "border-accent bg-accent/5"
    : "border-border hover:border-border-hover";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`rounded-xl border-2 border-dashed transition-colors ${borderClass}`}
    >
      {/* Mobile: compact single-line strip */}
      <div className="flex sm:hidden items-center gap-3 px-4 py-3">
        <span className="material-symbols-outlined text-2xl text-text-secondary shrink-0">
          cloud_upload
        </span>
        <p className="text-sm text-text-secondary min-w-0">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer text-accent hover:underline"
            disabled={uploading}
          >
            Tap to upload
          </button>
          {" or drag & drop"}
        </p>
        {uploading && (
          <span className="material-symbols-outlined animate-spin text-base text-text-secondary shrink-0">
            progress_activity
          </span>
        )}
      </div>

      {/* Desktop: full upload zone */}
      <div className="hidden sm:flex flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-text-secondary">
          cloud_upload
        </span>
        <p className="text-sm text-text-secondary">
          Drag & drop files here, or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="cursor-pointer text-accent hover:underline"
            disabled={uploading}
          >
            browse
          </button>
        </p>
        <p className="text-xs text-text-secondary/60">
          Images, text, Markdown, JSON, PDF, Word
          {storageLimitLabel
            ? ` · ${storageLimitLabel} per workspace`
            : " · Workspace storage limit applies"}
        </p>
        {uploading && (
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="material-symbols-outlined animate-spin text-base">
              progress_activity
            </span>
            Uploading…
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS}
        multiple
        title="Upload files"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
