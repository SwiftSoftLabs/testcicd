"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WorkspaceFile,
  WorkspaceFolder,
  ViewMode,
  SortField,
  SortOrder,
} from "@/types/files";
import { FolderNode, BreadcrumbEntry, buildFolderTree } from "@/lib/folderTree";
import { FileItem } from "./FileItem";
import { FolderItem } from "./FolderItem";
import { FolderExplorer } from "./FolderExplorer";
import { FileUploadZone } from "./FileUploadZone";
import { ViewModeToggle } from "./ViewModeToggle";
import { useUIContext } from "@/context/UIContext";
import { formatStorageBytes } from "@/lib/billing/formatBytes";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function folderComparator(field: SortField, order: SortOrder) {
  return (a: WorkspaceFolder, b: WorkspaceFolder): number => {
    let cmp = 0;
    if (field === "date") {
      cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    } else {
      cmp = a.name.localeCompare(b.name);
    }
    return order === "asc" ? cmp : -cmp;
  };
}

function fileComparator(field: SortField, order: SortOrder) {
  return (a: WorkspaceFile, b: WorkspaceFile): number => {
    let cmp = 0;
    if (field === "name") {
      cmp = a.file_name.localeCompare(b.file_name);
    } else if (field === "date") {
      cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    } else if (field === "size") {
      cmp = a.file_size - b.file_size;
    } else if (field === "type") {
      cmp =
        a.file_type.localeCompare(b.file_type) ||
        a.file_name.localeCompare(b.file_name);
    }
    return order === "asc" ? cmp : -cmp;
  };
}

const SORT_OPTIONS: { label: string; field: SortField; order: SortOrder }[] = [
  { label: "Name (A–Z)", field: "name", order: "asc" },
  { label: "Name (Z–A)", field: "name", order: "desc" },
  { label: "Date (newest)", field: "date", order: "desc" },
  { label: "Date (oldest)", field: "date", order: "asc" },
  { label: "Size (largest)", field: "size", order: "desc" },
  { label: "Size (smallest)", field: "size", order: "asc" },
  { label: "Type (A–Z)", field: "type", order: "asc" },
];

interface FileBrowserProps {
  workspaceId: string;
}

export function FileBrowser({ workspaceId }: FileBrowserProps) {
  const { addToast, openModal } = useUIContext();

  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [storageUsed, setStorageUsed] = useState(0);
  const [storageLimit, setStorageLimit] = useState(0);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([
    { id: null, name: "Root" },
  ]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [showSidebar, setShowSidebar] = useState(false);
  const [allFolders, setAllFolders] = useState<WorkspaceFolder[]>([]);
  const [folderTree, setFolderTree] = useState<FolderNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);

  // Sort
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Drag & drop
  const draggedFileRef = useRef<WorkspaceFile | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [dragOverId, setDragOverId] = useState<string | "root" | null>(null);

  // Copy picker
  const [copyingFile, setCopyingFile] = useState<WorkspaceFile | null>(null);

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1].id;

  const sortedFolders = useMemo(
    () => [...folders].sort(folderComparator(sortField, sortOrder)),
    [folders, sortField, sortOrder],
  );
  const sortedFiles = useMemo(
    () => [...files].sort(fileComparator(sortField, sortOrder)),
    [files, sortField, sortOrder],
  );

  const fetchFolderTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await authenticatedFetch(
        `/api/files?workspace_id=${workspaceId}&tree=true`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { folders: WorkspaceFolder[] };
      setAllFolders(data.folders);
      setFolderTree(buildFolderTree(data.folders));
    } catch {
      // non-fatal: sidebar just won't show folders
    } finally {
      setTreeLoading(false);
    }
  }, [workspaceId]);

  const fetchContents = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      if (currentFolderId) params.set("folder_id", currentFolderId);
      const res = await authenticatedFetch(`/api/files?${params}`);
      if (!res.ok) throw new Error("Failed to load files");
      const data = (await res.json()) as {
        folders: WorkspaceFolder[];
        files: WorkspaceFile[];
        storage_used: number;
        storage_limit: number;
      };
      setFolders(data.folders);
      setFiles(data.files);
      setStorageUsed(data.storage_used);
      setStorageLimit(data.storage_limit);
    } catch {
      addToast("Failed to load files", "error");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, currentFolderId, addToast]);

  useEffect(() => {
    fetchContents();
  }, [fetchContents]);
  useEffect(() => {
    fetchFolderTree();
  }, [fetchFolderTree]);

  const handleUpload = async (selectedFiles: File[]) => {
    setUploading(true);
    let successCount = 0;
    for (const file of selectedFiles) {
      if (storageLimit > 0 && file.size > storageLimit) {
        addToast(
          `"${file.name}" exceeds the ${formatStorageBytes(storageLimit)} workspace limit.`,
          "error",
        );
        continue;
      }
      if (storageLimit > 0 && storageUsed + file.size > storageLimit) {
        addToast(
          `Not enough storage (${formatStorageBytes(Math.max(0, storageLimit - storageUsed))} remaining).`,
          "error",
        );
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("workspace_id", workspaceId);
        if (currentFolderId) form.append("folder_id", currentFolderId);
        const res = await authenticatedFetch("/api/files/upload", {
          method: "POST",
          body: form,
        });
        if (res.ok) {
          successCount++;
        } else {
          let message = "Upload failed";
          try {
            const body = (await res.json()) as { error?: string };
            message = body.error ?? message;
          } catch {
            // response wasn't JSON (e.g. framework-level 413)
          }
          addToast(message, "error");
        }
      } catch {
        addToast(`Failed to upload "${file.name}"`, "error");
      }
    }
    setUploading(false);
    if (successCount > 0) {
      addToast(
        `${successCount} file${successCount > 1 ? "s" : ""} uploaded`,
        "success",
      );
      fetchContents();
    }
  };

  const handleDeleteFile = async (file: WorkspaceFile) => {
    const res = await authenticatedFetch(`/api/files/${file.id}`, { method: "DELETE" });
    if (res.ok) {
      addToast("File deleted", "success");
      fetchContents();
    } else {
      addToast("Failed to delete file", "error");
    }
  };

  const handleDownload = (file: WorkspaceFile) => {
    window.open(`/api/files/${file.id}/download`, "_blank");
  };

  const handlePreview = (file: WorkspaceFile) => {
    openModal("file-preview", {
      fileId: file.id,
      fileName: file.file_name,
      fileType: file.file_type,
    });
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    const res = await authenticatedFetch("/api/files/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        parent_id: currentFolderId,
        name: newFolderName.trim(),
      }),
    });
    if (res.ok) {
      setNewFolderName("");
      setShowFolderInput(false);
      addToast("Folder created", "success");
      fetchContents();
      fetchFolderTree();
    } else {
      addToast("Failed to create folder", "error");
    }
  };

  const handleDeleteFolder = async (folder: WorkspaceFolder) => {
    const res = await authenticatedFetch(`/api/files/folders/${folder.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      addToast("Folder deleted", "success");
      fetchContents();
      fetchFolderTree();
    } else {
      addToast("Failed to delete folder", "error");
    }
  };

  const openFolder = (folder: WorkspaceFolder) => {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleExplorerNavigate = (
    folderId: string | null,
    newBreadcrumbs: BreadcrumbEntry[],
  ) => {
    setBreadcrumbs(newBreadcrumbs);
  };

  // Drag & drop handlers
  const handleDragStart = (file: WorkspaceFile) => {
    draggedFileRef.current = file;
  };

  const handleDragEnd = () => {
    draggedFileRef.current = null;
    setDragOverId(null);
  };

  const handleDropOnFolder = async (targetFolderId: string | null) => {
    const file = draggedFileRef.current;
    setDragOverId(null);
    if (!file) return;
    if (file.folder_id === targetFolderId) return;

    const res = await authenticatedFetch(`/api/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: targetFolderId }),
    });
    if (res.ok) {
      addToast("File moved", "success");
      fetchContents();
    } else {
      addToast("Failed to move file", "error");
    }
  };

  // Duplicate & copy handlers
  const handleDuplicate = async (file: WorkspaceFile) => {
    const res = await authenticatedFetch(`/api/files/${file.id}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        folder_id: file.folder_id,
      }),
    });
    if (res.ok) {
      addToast("File duplicated", "success");
      fetchContents();
    } else {
      let message = "Failed to duplicate file";
      try {
        const body = (await res.json()) as { error?: string };
        message = body.error ?? message;
      } catch {
        /* ignore */
      }
      addToast(message, "error");
    }
  };

  const handleCopyTo = (file: WorkspaceFile) => {
    setCopyingFile(file);
  };

  const handleCopyConfirm = async (targetFolderId: string | null) => {
    const file = copyingFile;
    if (!file) return;
    setCopyingFile(null);

    const res = await authenticatedFetch(`/api/files/${file.id}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        folder_id: targetFolderId,
      }),
    });
    if (res.ok) {
      addToast("File copied", "success");
      fetchContents();
    } else {
      let message = "Failed to copy file";
      try {
        const body = (await res.json()) as { error?: string };
        message = body.error ?? message;
      } catch {
        /* ignore */
      }
      addToast(message, "error");
    }
  };

  const usedPct =
    storageLimit > 0
      ? Math.min((storageUsed / storageLimit) * 100, 100)
      : 0;
  const storageRemaining =
    storageLimit > 0 ? Math.max(0, storageLimit - storageUsed) : 0;
  const isEmpty = folders.length === 0 && files.length === 0;

  useEffect(() => {
    if (progressBarRef.current) {
      progressBarRef.current.style.width = `${usedPct}%`;
    }
  }, [usedPct]);

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.field === sortField && o.order === sortOrder)
      ?.label ?? "Sort";

  const renderContents = () => {
    if (isLoading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <span className="material-symbols-outlined animate-spin text-2xl text-text-secondary">
            progress_activity
          </span>
        </div>
      );
    }

    if (isEmpty) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <span className="material-symbols-outlined text-4xl text-text-secondary/40">
            folder_open
          </span>
          <p className="text-sm text-text-secondary">
            No files yet. Upload one above.
          </p>
        </div>
      );
    }

    if (viewMode === "icon") {
      return (
        <div className="flex flex-wrap gap-3">
          {sortedFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              viewMode="icon"
              isDragOver={dragOverId === folder.id}
              onOpen={openFolder}
              onDelete={handleDeleteFolder}
              onDragOver={() => setDragOverId(folder.id)}
              onDragLeave={() => setDragOverId(null)}
              onDrop={() => handleDropOnFolder(folder.id)}
            />
          ))}
          {sortedFiles.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              viewMode="icon"
              isDragging={draggedFileRef.current?.id === file.id}
              onDelete={handleDeleteFile}
              onDownload={handleDownload}
              onPreview={handlePreview}
              onDuplicate={handleDuplicate}
              onCopyTo={handleCopyTo}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          ))}
        </div>
      );
    }

    if (viewMode === "details") {
      return (
        <div className="flex flex-col">
          {sortedFolders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              viewMode="details"
              isDragOver={dragOverId === folder.id}
              onOpen={openFolder}
              onDelete={handleDeleteFolder}
              onDragOver={() => setDragOverId(folder.id)}
              onDragLeave={() => setDragOverId(null)}
              onDrop={() => handleDropOnFolder(folder.id)}
            />
          ))}
          {sortedFiles.map((file) => (
            <FileItem
              key={file.id}
              file={file}
              viewMode="details"
              isDragging={draggedFileRef.current?.id === file.id}
              onDelete={handleDeleteFile}
              onDownload={handleDownload}
              onPreview={handlePreview}
              onDuplicate={handleDuplicate}
              onCopyTo={handleCopyTo}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        {sortedFolders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            viewMode="list"
            isDragOver={dragOverId === folder.id}
            onOpen={openFolder}
            onDelete={handleDeleteFolder}
            onDragOver={() => setDragOverId(folder.id)}
            onDragLeave={() => setDragOverId(null)}
            onDrop={() => handleDropOnFolder(folder.id)}
          />
        ))}
        {sortedFiles.map((file) => (
          <FileItem
            key={file.id}
            file={file}
            viewMode="list"
            isDragging={draggedFileRef.current?.id === file.id}
            onDelete={handleDeleteFile}
            onDownload={handleDownload}
            onPreview={handlePreview}
            onDuplicate={handleDuplicate}
            onCopyTo={handleCopyTo}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Explorer sidebar — always visible on lg+, toggleable below */}
      <FolderExplorer
        tree={folderTree}
        allFolders={allFolders}
        activeFolderId={currentFolderId}
        onNavigate={handleExplorerNavigate}
        isLoading={treeLoading}
        onDropFile={handleDropOnFolder}
        className={`${showSidebar ? "flex" : "hidden"} lg:flex`}
      />

      {/* Content area — fixed chrome on top, scrollable list below */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Fixed chrome: toolbar + storage bar + upload zone */}
        <div className="shrink-0 flex flex-col gap-3 p-3 md:p-4">
          {/* Toolbar */}
          <div className="flex items-center gap-2">
            {/* Sidebar toggle — hidden on lg+ */}
            <button
              type="button"
              onClick={() => setShowSidebar((s) => !s)}
              className="cursor-pointer lg:hidden p-1.5 rounded-md border border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors shrink-0"
              title="Toggle folder explorer"
            >
              <span className="material-symbols-outlined text-base leading-none">
                {showSidebar ? "menu_open" : "menu"}
              </span>
            </button>

            {/* Breadcrumbs */}
            <nav className="flex-1 min-w-0 flex items-center gap-1 text-sm overflow-hidden">
              {/* Mobile: back button + current folder name only */}
              {breadcrumbs.length > 1 && (
                <button
                  type="button"
                  onClick={() => navigateTo(breadcrumbs.length - 2)}
                  className="cursor-pointer sm:hidden p-1 rounded text-text-secondary hover:text-text-primary shrink-0 transition-colors"
                  title="Go back"
                >
                  <span className="material-symbols-outlined text-base leading-none">
                    arrow_back
                  </span>
                </button>
              )}
              <span className="sm:hidden flex-1 min-w-0 truncate text-sm font-medium text-text-primary px-1">
                {breadcrumbs[breadcrumbs.length - 1].name}
              </span>

              {/* Desktop: full breadcrumb trail */}
              <div className="hidden sm:flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                {breadcrumbs.map((crumb, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <span className="text-text-secondary/40 shrink-0">/</span>
                    )}
                    <button
                      type="button"
                      onClick={() => navigateTo(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDropOnFolder(crumb.id)}
                      className={`cursor-pointer rounded px-1.5 py-0.5 transition-colors shrink-0 ${
                        i === breadcrumbs.length - 1
                          ? "text-text-primary font-medium"
                          : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </nav>

            {/* Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Sort — full select on sm+, icon overlay on mobile */}
              <div className="relative hidden sm:block">
                <select
                  value={`${sortField}-${sortOrder}`}
                  onChange={(e) => {
                    const [field, order] = e.target.value.split("-") as [
                      SortField,
                      SortOrder,
                    ];
                    setSortField(field);
                    setSortOrder(order);
                  }}
                  className="appearance-none rounded-md border border-border bg-bg-secondary pl-3 pr-8 py-1.5 text-sm text-text-secondary hover:border-border-hover hover:text-text-primary transition-colors outline-none focus:border-accent cursor-pointer"
                  title={`Sort: ${currentSortLabel}`}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option
                      key={`${opt.field}-${opt.order}`}
                      value={`${opt.field}-${opt.order}`}
                    >
                      {opt.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-sm text-text-secondary">
                  sort
                </span>
              </div>

              {/* Sort — icon button with transparent native select on mobile */}
              <div className="relative sm:hidden">
                <select
                  value={`${sortField}-${sortOrder}`}
                  onChange={(e) => {
                    const [field, order] = e.target.value.split("-") as [
                      SortField,
                      SortOrder,
                    ];
                    setSortField(field);
                    setSortOrder(order);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  title={`Sort: ${currentSortLabel}`}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option
                      key={`${opt.field}-${opt.order}`}
                      value={`${opt.field}-${opt.order}`}
                    >
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="p-1.5 rounded-md border border-border bg-bg-secondary text-text-secondary pointer-events-none">
                  <span className="material-symbols-outlined text-base leading-none">
                    sort
                  </span>
                </div>
              </div>

              <ViewModeToggle mode={viewMode} onChange={setViewMode} />

              {showFolderInput ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") {
                        setShowFolderInput(false);
                        setNewFolderName("");
                      }
                    }}
                    placeholder="Folder name"
                    className="w-24 sm:w-36 rounded-md border border-border bg-bg-secondary px-2 sm:px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={handleCreateFolder}
                    className="cursor-pointer rounded-md bg-accent px-2 py-1.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
                    title="Create folder"
                  >
                    <span className="hidden sm:inline">Create</span>
                    <span className="material-symbols-outlined sm:hidden text-base leading-none">
                      check
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowFolderInput(false);
                      setNewFolderName("");
                    }}
                    className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                    title="Cancel"
                  >
                    <span className="hidden sm:inline">Cancel</span>
                    <span className="material-symbols-outlined sm:hidden text-base leading-none">
                      close
                    </span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowFolderInput(true)}
                  className="cursor-pointer flex items-center gap-1 rounded-md border border-border px-2 sm:px-3 py-1.5 text-sm text-text-secondary hover:border-border-hover hover:text-text-primary transition-colors"
                  title="New folder"
                >
                  <span className="material-symbols-outlined text-base leading-none">
                    create_new_folder
                  </span>
                  <span className="hidden sm:inline">New folder</span>
                </button>
              )}
            </div>
          </div>

          {/* Storage bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-bg-hover overflow-hidden">
              <div
                ref={progressBarRef}
                className={`h-full rounded-full transition-all ${usedPct > 85 ? "bg-red-500" : "bg-accent"}`}
              />
            </div>
            <span className="shrink-0 text-xs text-text-secondary">
              {formatBytes(storageUsed)} / {formatBytes(storageLimit)}
              {storageLimit > 0 && (
                <span className="text-text-secondary/70">
                  {" "}
                  · {formatBytes(storageRemaining)} left
                </span>
              )}
            </span>
          </div>

          {/* Upload zone */}
          <FileUploadZone
            onFiles={handleUpload}
            uploading={uploading}
            storageLimitLabel={
              storageLimit > 0 ? formatStorageBytes(storageLimit) : undefined
            }
          />
        </div>

        {/* Scrollable file list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 md:px-4 pb-3 md:pb-4">
          {/* Details view header */}
          {viewMode === "details" && !isLoading && !isEmpty && (
            <div className="grid grid-cols-[2fr_1fr] sm:grid-cols-[2fr_1fr_1fr] lg:grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-3 py-2 text-xs font-medium text-text-secondary uppercase tracking-wide border-b border-border mb-0.5">
              <span>Name</span>
              <span className="hidden lg:block">Type</span>
              <span className="hidden sm:block">Size</span>
              <span>Date</span>
            </div>
          )}
          {renderContents()}
        </div>
      </div>

      {/* Copy to folder picker */}
      {copyingFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dismiss-backdrop"
          onClick={() => setCopyingFile(null)}
        >
          <div
            className="cursor-pointer w-80 rounded-xl border border-border bg-bg-surface shadow-xl p-4 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">
                Copy to folder
              </h3>
              <button
                type="button"
                onClick={() => setCopyingFile(null)}
                className="cursor-pointer p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <p className="text-xs text-text-secondary truncate">
              {copyingFile.file_name}
            </p>
            <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
              <button
                type="button"
                onClick={() => handleCopyConfirm(null)}
                className="cursor-pointer flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-left"
              >
                <span className="material-symbols-outlined text-base text-primary">
                  folder
                </span>
                Root
              </button>
              {allFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => handleCopyConfirm(folder.id)}
                  className="cursor-pointer flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors text-left"
                >
                  <span className="material-symbols-outlined text-base text-primary">
                    folder
                  </span>
                  {folder.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
