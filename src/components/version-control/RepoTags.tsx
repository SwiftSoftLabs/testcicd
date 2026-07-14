"use client";

import React from "react";

export interface RepoTagView {
  name: string;
  commitSha: string;
  message: string | null;
  createdAt: string | null;
}

type RepoTagsProps = {
  tags: RepoTagView[];
  loading: boolean;
};

export default function RepoTags({ tags, loading }: RepoTagsProps) {
  if (loading) {
    return (
      <div className="py-20 text-center text-text-secondary text-sm">
        Loading releases…
      </div>
    );
  }
  return (
    <div className="max-w-4xl space-y-4 animate-in fade-in duration-300">
      <h3 className="text-lg font-bold text-main mb-6">Tags &amp; Releases</h3>
      {tags.map((tag) => (
        <div
          key={tag.name}
          className="bg-surface-dark border border-border-dark rounded-xl p-4 flex flex-col gap-1"
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-text-secondary text-[18px]">
              sell
            </span>
            <span className="text-sm font-bold text-main">{tag.name}</span>
          </div>
          {tag.message && (
            <p className="text-xs text-text-secondary pl-7">{tag.message}</p>
          )}
          <p className="text-[10px] font-mono text-text-secondary pl-7 truncate">
            {tag.commitSha.slice(0, 12)}
            {tag.createdAt
              ? ` · ${new Date(tag.createdAt).toLocaleDateString()}`
              : ""}
          </p>
        </div>
      ))}
      {tags.length === 0 && (
        <div className="py-20 text-center text-text-secondary italic text-sm">
          No tags yet.
        </div>
      )}
    </div>
  );
}
