"use client";

import React, { useEffect, useRef, useState } from "react";
import { useUIContext } from "@/context/UIContext";
import { useAppContext } from "@/context/AppContext";
import { Task, TaskAttachment } from "@/types";
import { WorkspaceFile } from "@/types/files";
import { api } from "@/lib/api";
import { insforgeNative } from "@/lib/insforge/native";
import { WorkspaceFilePicker } from "@/components/files/WorkspaceFilePicker";

type InsForgeStorage = {
  from: (bucket: string) => {
    upload: (
      path: string,
      file: File,
      opts?: { upsert?: boolean },
    ) => Promise<{ data: unknown; error: unknown }>;
    remove: (paths: string[]) => Promise<void>;
  };
};
const insforgeStorage = (
  insforgeNative as unknown as { storage: InsForgeStorage }
).storage;
import { format } from "date-fns";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface TaskAttachmentsProps {
  task: Task;
  readOnly?: boolean;
}

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const BUCKET = "task-attachments";

function isImageAttachment(att: TaskAttachment): boolean {
  const type = att.file_type?.toLowerCase();
  if (type && (IMAGE_TYPES.has(type) || type.startsWith("image/"))) {
    return true;
  }
  const ext = att.file_name.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

function getAttachmentDownloadUrl(taskId: string, att: TaskAttachment, inline = false): string {
  const query = inline ? "?inline=1" : "";
  if (att.source === "workspace" && att.workspace_file_id) {
    return `/api/files/${att.workspace_file_id}/download${query}`;
  }
  return `/api/tasks/${taskId}/attachments/${att.id}/download${query}`;
}

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export const TaskAttachments: React.FC<TaskAttachmentsProps> = ({ task, readOnly = false }) => {
  const { addToast, openModal } = useUIContext();
  const { currentUser, selectedWorkspaceId } = useAppContext();
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.tasks
      .getAttachments(task.id)
      .then((data) => setAttachments(data as TaskAttachment[]))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [task.id]);

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    try {
      const path = `${task.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await insforgeStorage
        .from(BUCKET)
        .upload(path, file, { upsert: false });

      if (uploadError) throw uploadError;

      const attachment = (await api.tasks.createAttachment(task.id, {
        file_name: file.name,
        file_size: file.size,
        file_type: file.type || guessMimeFromName(file.name),
        storage_path: path,
        uploaded_by: currentUser.id,
      })) as TaskAttachment;

      setAttachments((prev) => [...prev, attachment]);
      addToast(`${file.name} uploaded`, "success");
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setIsUploading(false);
    }
  };

  const uploadPastedImage = (file: File) => {
    const ext = file.type.split("/")[1] ?? "png";
    const namedFile = new File(
      [file],
      `pasted-${Date.now()}.${ext}`,
      { type: file.type || `image/${ext}` },
    );
    void uploadFile(namedFile);
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || readOnly) return;
    Array.from(files).forEach((f) => uploadFile(f));
  };

  const handlePaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    if (readOnly || !e.clipboardData) return;
    const imageItem = Array.from(e.clipboardData.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    uploadPastedImage(file);
  };

  useEffect(() => {
    if (readOnly) return;
    const onDocumentPaste = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener("paste", onDocumentPaste);
    return () => document.removeEventListener("paste", onDocumentPaste);
  }, [readOnly, task.id, currentUser.id]);

  const handleDownload = (att: TaskAttachment) => {
    window.open(getAttachmentDownloadUrl(task.id, att), "_blank");
  };

  const handlePreview = (att: TaskAttachment) => {
    openModal("attachment-preview", {
      url: getAttachmentDownloadUrl(task.id, att, true),
      downloadUrl: getAttachmentDownloadUrl(task.id, att),
      name: att.file_name,
    });
  };

  const handleDelete = async (att: TaskAttachment) => {
    try {
      if (att.source === "workspace" && att.workspace_file_id) {
        await authenticatedFetch(
          `/api/tasks/${task.id}/attachments/link?workspace_file_id=${att.workspace_file_id}`,
          { method: "DELETE" },
        );
      } else {
        await insforgeStorage.from(BUCKET).remove([att.storage_path]);
        await api.tasks.deleteAttachment(task.id, att.id);
      }
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    } catch {
      addToast("Failed to delete attachment", "error");
    }
  };

  const handleLinkWorkspaceFile = async (file: WorkspaceFile) => {
    setShowFilePicker(false);
    const res = await authenticatedFetch(`/api/tasks/${task.id}/attachments/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_file_id: file.id }),
    });
    if (res.ok) {
      setAttachments((prev) => [
        ...prev,
        {
          id: file.id,
          task_id: task.id,
          uploaded_by: file.uploaded_by,
          file_name: file.file_name,
          file_size: file.file_size,
          file_type: file.file_type,
          storage_path: file.storage_path,
          created_at: file.created_at,
          source: "workspace",
          workspace_file_id: file.id,
        },
      ]);
      addToast(`${file.file_name} attached`, "success");
    } else {
      addToast("Failed to attach file", "error");
    }
  };

  return (
    <div
      className="space-y-3 outline-none"
      onPaste={handlePaste}
      tabIndex={readOnly ? undefined : 0}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
          Attachments {attachments.length > 0 && `(${attachments.length})`}
        </h4>
        {!readOnly && (
          <div className="flex items-center gap-1.5">
            {selectedWorkspaceId && (
              <button
                onClick={() => setShowFilePicker(true)}
                className="cursor-pointer text-text-secondary hover:text-primary transition-colors"
                title="Attach from Files"
              >
                <span className="material-symbols-outlined text-[16px]">
                  folder_open
                </span>
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="cursor-pointer text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">
                upload
              </span>
            </button>
          </div>
        )}
      </div>
      {showFilePicker && selectedWorkspaceId && (
        <WorkspaceFilePicker
          workspaceId={selectedWorkspaceId}
          onSelect={handleLinkWorkspaceFile}
          onClose={() => setShowFilePicker(false)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,*/*"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {!readOnly && (
        <div
          ref={dropZoneRef}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${isDragging ? "border-primary bg-primary/5" : "border-border-dark hover:border-border-dark/80"} ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
        >
          {isUploading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="size-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <span className="text-xs text-text-secondary">Uploading...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <span className="material-symbols-outlined text-text-secondary text-2xl">
                attach_file
              </span>
              <span className="text-[11px] text-text-secondary">
                Drop files, paste an image (⌘V), or click to upload
              </span>
            </div>
          )}
        </div>
      )}

      {!isLoading && attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((att) => {
            const isImage = isImageAttachment(att);
            const previewUrl = getAttachmentDownloadUrl(task.id, att, true);
            return (
              <div
                key={`${att.source ?? "upload"}-${att.id}`}
                className="flex items-center gap-3 group p-2 rounded-lg bg-background-dark border border-border-dark hover:border-border-dark/80 transition-all"
              >
                {isImage ? (
                  <button
                    type="button"
                    onClick={() => handlePreview(att)}
                    className="size-12 shrink-0 overflow-hidden rounded-lg border border-border-dark bg-surface-dark hover:opacity-90 transition-opacity"
                    title="View full size"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      className="size-full object-cover"
                      alt={att.file_name}
                    />
                  </button>
                ) : (
                  <div className="size-12 bg-surface-dark rounded-lg flex items-center justify-center shrink-0 border border-border-dark">
                    <span className="material-symbols-outlined text-text-secondary text-xl">
                      description
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {att.file_name}
                  </p>
                  <p className="text-[10px] text-text-secondary">
                    {formatBytes(att.file_size)} ·{" "}
                    {format(new Date(att.created_at), "MMM d")}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {isImage && (
                    <button
                      type="button"
                      onClick={() => handlePreview(att)}
                      className="p-1.5 text-text-secondary hover:text-primary transition-colors"
                      title="View full size"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        open_in_full
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDownload(att)}
                    className="cursor-pointer p-1.5 text-text-secondary hover:text-primary transition-colors"
                    title="Download"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      download
                    </span>
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => handleDelete(att)}
                      className="cursor-pointer p-1.5 text-text-secondary hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        delete
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function guessMimeFromName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
