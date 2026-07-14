"use client";

import React from "react";

import type { DiffFile } from "@/types";

type DiffFilesViewProps = {
  diffFiles: DiffFile[];
  /** When true, line comment affordances stay disabled (e.g. commits / read-only). */
  readOnly?: boolean;
  emptyMessage?: string;
  /** If set, each file section gets `id={`${fileAnchorPrefix}-${index}`}` for in-page navigation. */
  fileAnchorPrefix?: string;
  onLineComment?: (input: {
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
  }) => void;
};

export default function DiffFilesView({
  diffFiles,
  readOnly = true,
  emptyMessage = "No diff data available.",
  fileAnchorPrefix,
  onLineComment,
}: DiffFilesViewProps) {
  if (!diffFiles.length) {
    return (
      <div className="p-10 text-center text-text-secondary italic">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {diffFiles.map((file, fileIndex) => (
        <div
          key={`${file.filename}-${fileIndex}`}
          id={fileAnchorPrefix ? `${fileAnchorPrefix}-${fileIndex}` : undefined}
          className="bg-background-dark border border-border-dark rounded-xl overflow-hidden shadow-sm scroll-mt-24"
        >
          <div className="px-4 py-2.5 bg-white/[0.03] border-b border-border-dark flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="material-symbols-outlined text-[18px] text-text-secondary shrink-0">
                description
              </span>
              <div className="min-w-0 flex flex-col sm:flex-row sm:items-center sm:gap-2">
                <span className="text-xs font-mono font-bold text-main truncate">
                  {file.filename}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary shrink-0">
                  {file.status}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-bold text-emerald-400">
                +{file.additions}
              </span>
              <span className="text-[10px] font-bold text-red-400">
                -{file.deletions}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto bg-[#0d1117]">
            <table className="w-full border-collapse font-mono text-[12px] leading-tight">
              <tbody>
                {file.lines.map((line, lineIdx) => (
                  <tr
                    key={`${fileIndex}-L-${lineIdx}`}
                    className={`group ${
                      line.type === "addition"
                        ? "bg-emerald-900/20 text-emerald-100"
                        : line.type === "deletion"
                          ? "bg-red-900/20 text-red-100"
                          : "text-slate-300"
                    }`}
                  >
                    <td className="w-12 text-center py-0.5 border-r border-border-dark/30 text-text-secondary select-none opacity-50">
                      {line.number}
                    </td>
                    <td className="w-8 text-center py-0.5 select-none opacity-50">
                      {line.type === "addition"
                        ? "+"
                        : line.type === "deletion"
                          ? "-"
                          : " "}
                    </td>
                    <td className="px-4 py-0.5 whitespace-pre relative">
                      {line.content}
                      <button
                        type="button"
                        disabled={readOnly || !onLineComment}
                        onClick={() => {
                          if (!onLineComment || readOnly) return;
                          const side =
                            line.type === "deletion" ? "LEFT" : "RIGHT";
                          onLineComment({
                            path: file.filename,
                            line: line.number,
                            side,
                          });
                        }}
                        title={
                          readOnly || !onLineComment
                            ? "Read-only — comments disabled"
                            : "Add line comment"
                        }
                        className="cursor-pointer absolute right-2 top-0.5 opacity-0 group-hover:opacity-100 bg-primary/20 text-primary size-5 rounded flex items-center justify-center transition-all shadow-lg disabled:opacity-0 disabled:pointer-events-none"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          add_comment
                        </span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
