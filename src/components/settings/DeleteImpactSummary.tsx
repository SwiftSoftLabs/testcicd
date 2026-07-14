"use client";

import React from "react";

export type ImpactItem = {
  id: string;
  label: string;
};

export type ImpactSection = {
  label: string;
  count: number;
  items: ImpactItem[];
  emptyMessage?: string;
};

export type ImpactResponse = {
  sections: ImpactSection[];
  previewLimit: number;
};

interface DeleteImpactSummaryProps {
  data: ImpactResponse | null;
  error?: string | null;
  heading?: string;
  notes?: string[];
  loading?: boolean;
  onRetry?: () => void;
}

const DeleteImpactSummary: React.FC<DeleteImpactSummaryProps> = ({
  data,
  error,
  heading,
  notes = [],
  loading = false,
  onRetry,
}) => {
  if (loading) {
    return (
      <div className="rounded-xl border border-border-dark bg-background-dark/40 p-4">
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <div className="size-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <span>Loading deletion summary...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 space-y-3">
        <p className="text-xs text-red-200">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="cursor-pointer inline-flex rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-bold text-red-100 transition-colors hover:bg-red-500/10"
          >
            Retry summary
          </button>
        )}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-3">
      {heading && (
        <p className="text-[11px] font-black uppercase tracking-widest text-main">
          {heading}
        </p>
      )}
      {notes.length > 0 && (
        <div className="space-y-1">
          {notes.map((note) => (
            <p
              key={note}
              className="text-xs leading-relaxed text-text-secondary"
            >
              {note}
            </p>
          ))}
        </div>
      )}
      {data.sections.map((section) => {
        const overflow = Math.max(0, section.count - section.items.length);
        return (
          <div
            key={section.label}
            className="rounded-xl border border-border-dark bg-background-dark/40 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-widest text-main">
                {section.label}
              </p>
              <span className="text-xs text-text-secondary">
                {section.count}
              </span>
            </div>
            {section.items.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => (
                  <li
                    key={item.id}
                    className="text-xs text-text-secondary truncate"
                  >
                    {item.label}
                  </li>
                ))}
                {overflow > 0 && (
                  <li className="text-xs text-text-secondary">
                    +{overflow} more
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-text-secondary">
                {section.emptyMessage ?? "Nothing in this section."}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DeleteImpactSummary;
