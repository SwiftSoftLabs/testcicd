"use client";

import React, { useState } from "react";
import { FolderNode, BreadcrumbEntry, getFolderPath } from "@/lib/folderTree";
import { WorkspaceFolder } from "@/types/files";

interface FolderExplorerProps {
  tree: FolderNode[];
  allFolders: WorkspaceFolder[];
  activeFolderId: string | null;
  onNavigate: (folderId: string | null, breadcrumbs: BreadcrumbEntry[]) => void;
  isLoading: boolean;
  onDropFile?: (targetFolderId: string | null) => void;
  className?: string;
}

interface ExplorerNodeProps {
  node: FolderNode;
  allFolders: WorkspaceFolder[];
  depth: number;
  activeFolderId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (folderId: string | null, breadcrumbs: BreadcrumbEntry[]) => void;
  onDropFile?: (targetFolderId: string | null) => void;
}

function ExplorerNode({
  node,
  allFolders,
  depth,
  activeFolderId,
  expanded,
  onToggle,
  onNavigate,
  onDropFile,
}: ExplorerNodeProps) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = activeFolderId === node.id;
  const [isDragOver, setIsDragOver] = useState(false);

  const handleClick = () => {
    const path = getFolderPath(node.id, allFolders);
    onNavigate(node.id, [{ id: null, name: "Root" }, ...path]);
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
          isDragOver
            ? "ring-2 ring-accent bg-accent/5"
            : isActive
              ? "bg-accent/10 text-accent font-medium"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          onDropFile?.(node.id);
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle(node.id);
          }}
          className="cursor-pointer shrink-0 w-4 h-4 flex items-center justify-center"
        >
          {hasChildren ? (
            <span className="material-symbols-outlined text-sm leading-none">
              {isExpanded ? "expand_more" : "chevron_right"}
            </span>
          ) : null}
        </button>
        <button
          onClick={handleClick}
          className="cursor-pointer flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <span className="material-symbols-outlined text-base leading-none text-primary shrink-0">
            {isActive ? "folder_open" : "folder"}
          </span>
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <ExplorerNode
              key={child.id}
              node={child}
              allFolders={allFolders}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
              onDropFile={onDropFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FolderExplorer({
  tree,
  allFolders,
  activeFolderId,
  onNavigate,
  isLoading,
  onDropFile,
  className,
}: FolderExplorerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rootDragOver, setRootDragOver] = useState(false);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={`w-56 shrink-0 border-r border-border flex-col overflow-y-auto ${className ?? "flex"}`}>
      <div className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-text-secondary/60">
        Explorer
      </div>

      <div className="flex-1 px-1 pb-3">
        {/* Root entry */}
        <div
          className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors ${
            rootDragOver
              ? "ring-2 ring-accent bg-accent/5"
              : activeFolderId === null
                ? "bg-accent/10 text-accent font-medium"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          }`}
          onClick={() => onNavigate(null, [{ id: null, name: "Root" }])}
          onDragOver={(e) => {
            e.preventDefault();
            setRootDragOver(true);
          }}
          onDragLeave={() => setRootDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setRootDragOver(false);
            onDropFile?.(null);
          }}
        >
          <span className="w-4 h-4 shrink-0" />
          <span className="material-symbols-outlined text-base leading-none text-primary shrink-0">
            {activeFolderId === null ? "folder_open" : "folder"}
          </span>
          <span className="truncate">All Files</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary/60">
            <span className="material-symbols-outlined animate-spin text-sm">
              progress_activity
            </span>
            Loading…
          </div>
        ) : (
          tree.map((node) => (
            <ExplorerNode
              key={node.id}
              node={node}
              allFolders={allFolders}
              depth={0}
              activeFolderId={activeFolderId}
              expanded={expanded}
              onToggle={toggleExpand}
              onNavigate={onNavigate}
              onDropFile={onDropFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
