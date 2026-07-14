"use client";

import React from "react";

interface ConsentModalProps {
  recordingEnabled: boolean;
  aiEnabled: boolean;
  joining?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function ConsentModal({
  recordingEnabled,
  aiEnabled,
  joining = false,
  onAccept,
  onDecline,
}: ConsentModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-surface-dark border border-border-dark rounded-2xl max-w-md w-full p-6 shadow-xl">
        <h2 className="text-lg font-bold text-white mb-2">Before you join</h2>
        <ul className="text-sm text-text-secondary space-y-2 mb-6 list-disc pl-5">
          {recordingEnabled && (
            <li>
              This meeting may be{" "}
              <strong className="text-white">recorded</strong> and transcribed
              for your workspace.
            </li>
          )}
          {aiEnabled && (
            <li>
              An <strong className="text-white">AI voice assistant</strong> may
              join as a participant to help capture action items (tasks require
              your approval).
            </li>
          )}
          <li>Only workspace members can access call artifacts.</li>
        </ul>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onDecline}
            disabled={joining}
            className="cursor-pointer px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={joining}
            className="cursor-pointer px-4 py-2 rounded-lg text-sm font-bold bg-primary text-white hover:bg-blue-600 disabled:opacity-60 flex items-center gap-2"
          >
            {joining && (
              <span className="size-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {joining ? "Joining…" : "I understand, join"}
          </button>
        </div>
      </div>
    </div>
  );
}
