"use client";

import React, { useRef, useState } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";

export interface ConfirmActionModalProps {
  onClose: () => void;
  title: string;
  message?: string;
  content?: React.ReactNode;
  confirmLabel?: string;
  confirmInProgressLabel?: string;
  cancelLabel?: string;
  intent?: "danger" | "default";
  requireTextMatch?: string;
  confirmInputLabel?: string;
  confirmInputPlaceholder?: string;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<void> | void;
}

const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
  onClose,
  title,
  message,
  content,
  confirmLabel = "Confirm",
  confirmInProgressLabel = "Working...",
  cancelLabel = "Cancel",
  intent = "default",
  requireTextMatch,
  confirmInputLabel,
  confirmInputPlaceholder,
  confirmDisabled = false,
  onConfirm,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationText, setConfirmationText] = useState("");

  useClickOutside(
    modalRef,
    () => {
      if (!isSubmitting) onClose();
    },
    !isSubmitting,
  );

  const handleConfirm = async () => {
    if (confirmDisabled) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await onConfirm();
      onClose();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmButtonClass =
    intent === "danger"
      ? "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20"
      : "bg-primary text-white hover:bg-blue-600 shadow-lg shadow-primary/20";
  const requiresMatch = Boolean(requireTextMatch);
  const textMatches =
    !requiresMatch || confirmationText.trim() === requireTextMatch;
  const isConfirmBlocked = isSubmitting || confirmDisabled || !textMatches;

  return (
    <div
      ref={modalRef}
      className="w-full max-w-lg mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
    >
      <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
        <h2 className="text-xl font-bold text-white">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="cursor-pointer text-text-secondary hover:text-white transition-colors disabled:opacity-50"
          aria-label="Close dialog"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="p-6 space-y-5">
        {message && (
          <p className="text-sm text-text-secondary leading-relaxed">
            {message}
          </p>
        )}
        {content}

        {requiresMatch && (
          <div className="space-y-2">
            <label
              htmlFor="confirm-action-match"
              className="text-[11px] font-black uppercase tracking-widest text-main"
            >
              {confirmInputLabel ?? "Type the name to confirm"}
            </label>
            <input
              id="confirm-action-match"
              type="text"
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              placeholder={confirmInputPlaceholder ?? requireTextMatch}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-border-dark bg-background-dark px-4 py-3 text-sm text-white outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {errorMessage && (
          <div
            className="text-sm text-red-300 bg-red-500/10 border border-red-500/25 rounded-xl px-3 py-2"
            role="alert"
            aria-live="polite"
          >
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirmBlocked}
            className={`px-7 py-2.5 text-sm font-black rounded-xl transition-all active:scale-95 disabled:opacity-50 ${confirmButtonClass} cursor-pointer`}
          >
            {isSubmitting ? confirmInProgressLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmActionModal;
