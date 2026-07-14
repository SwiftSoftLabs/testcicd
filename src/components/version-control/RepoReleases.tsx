"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { RepoTagView } from "@/components/version-control/RepoTags";

export type RepoReleaseView = {
  id: number;
  tagName: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  htmlUrl: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  assetCount: number;
};

type RepoReleasesProps = {
  releases: RepoReleaseView[];
  tags: RepoTagView[];
  loading: boolean;
  readOnly?: boolean;
  defaultTarget?: string;
  onCreate?: (input: {
    tagName: string;
    target: string;
    name: string;
    body: string;
    prerelease: boolean;
  }) => Promise<void>;
};

export default function RepoReleases({
  releases,
  tags,
  loading,
  readOnly,
  defaultTarget = "main",
  onCreate,
}: RepoReleasesProps) {
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagName, setTagName] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [target, setTarget] = useState(defaultTarget);
  const [prerelease, setPrerelease] = useState(false);

  const submit = async () => {
    if (!onCreate) return;
    const tag = tagName.trim();
    if (!tag) return;
    setSaving(true);
    try {
      await onCreate({
        tagName: tag,
        target: target.trim() || defaultTarget,
        name: title.trim() || tag,
        body: notes,
        prerelease,
      });
      setCreating(false);
      setTagName("");
      setTitle("");
      setNotes("");
      setPrerelease(false);
      setTarget(defaultTarget);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-text-secondary text-sm">
        Loading releases…
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-10 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-main">Releases</h3>
        {!readOnly && onCreate ? (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="cursor-pointer h-9 px-3 rounded-lg bg-primary text-white text-xs font-bold"
          >
            {creating ? "Cancel" : "Create release"}
          </button>
        ) : null}
      </div>

      {creating && onCreate ? (
        <div className="rounded-xl border border-border-dark bg-surface-dark p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-xs text-text-secondary space-y-1">
              Tag name
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="v1.0.0"
                className="w-full h-9 rounded-lg border border-border-dark bg-background-dark px-3 text-sm text-main"
              />
            </label>
            <label className="block text-xs text-text-secondary space-y-1">
              Target
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={defaultTarget}
                className="w-full h-9 rounded-lg border border-border-dark bg-background-dark px-3 text-sm text-main font-mono"
              />
            </label>
          </div>
          <label className="block text-xs text-text-secondary space-y-1">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Release title"
              className="w-full h-9 rounded-lg border border-border-dark bg-background-dark px-3 text-sm text-main"
            />
          </label>
          <label className="block text-xs text-text-secondary space-y-1">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-border-dark bg-background-dark px-3 py-2 text-sm text-main"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={prerelease}
              onChange={(e) => setPrerelease(e.target.checked)}
              className="rounded border-border-dark"
            />
            Pre-release
          </label>
          <button
            type="button"
            disabled={saving || !tagName.trim()}
            onClick={() => void submit()}
            className="cursor-pointer h-9 px-4 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-40"
          >
            {saving ? "Publishing…" : "Publish release"}
          </button>
        </div>
      ) : null}

      <div className="space-y-4">
        {releases.map((rel) => (
          <article
            key={rel.id}
            className="bg-surface-dark border border-border-dark rounded-xl p-5 space-y-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-main">{rel.name}</h4>
              <span className="font-mono text-[10px] text-text-secondary">
                {rel.tagName}
              </span>
              {rel.draft ? (
                <span className="text-[10px] font-bold uppercase text-amber-400">
                  Draft
                </span>
              ) : null}
              {rel.prerelease ? (
                <span className="text-[10px] font-bold uppercase text-primary">
                  Pre-release
                </span>
              ) : null}
              {rel.htmlUrl ? (
                <a
                  href={rel.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-bold text-primary hover:underline ml-auto"
                >
                  Open
                </a>
              ) : null}
            </div>
            <p className="text-[10px] text-text-secondary">
              {rel.publishedAt || rel.createdAt
                ? new Date(
                    rel.publishedAt || rel.createdAt || "",
                  ).toLocaleString()
                : ""}
              {rel.assetCount > 0 ? ` · ${rel.assetCount} assets` : ""}
            </p>
            {rel.body.trim() ? (
              <div className="prose prose-invert prose-sm max-w-none border-t border-border-dark pt-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {rel.body}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-xs text-text-secondary italic">No release notes.</p>
            )}
          </article>
        ))}
        {releases.length === 0 ? (
          <div className="py-12 text-center text-text-secondary italic text-sm">
            No releases yet.
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="text-lg font-bold text-main mb-4">Tags</h3>
        <div className="space-y-3">
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
              {tag.message ? (
                <p className="text-xs text-text-secondary pl-7">{tag.message}</p>
              ) : null}
              <p className="text-[10px] font-mono text-text-secondary pl-7 truncate">
                {tag.commitSha.slice(0, 12)}
                {tag.createdAt
                  ? ` · ${new Date(tag.createdAt).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
          ))}
          {tags.length === 0 ? (
            <div className="py-8 text-center text-text-secondary italic text-sm">
              No tags yet.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
