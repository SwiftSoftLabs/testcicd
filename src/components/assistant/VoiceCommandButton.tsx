"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAppContext } from "@/context/AppContext";
import { useAssistantPageContextBridge } from "@/context/AssistantPageContextBridge";
import { useAssistantSession } from "@/context/AssistantSessionContext";
import { useUIContext } from "@/context/UIContext";
import {
  isBrowserSpeechRecognitionAvailable,
  startBrowserSpeechSession,
} from "@/lib/assistant/browserSpeechRecognition";
import { executeAssistantClientActions } from "@/lib/assistant/executeClientActions";
import { api } from "@/lib/api";
import type { AssistantPageContext } from "@/types/assistant";

const ICON_BUTTON_CLASSES =
  "flex size-10 cursor-pointer touch-none select-none items-center justify-center rounded-full text-text-secondary transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:text-text-main focus-visible:bg-white/10 focus-visible:outline-none";

const MIN_SPEECH_MS = 400;
const MAX_SPEECH_MS = 30_000;

function previewTranscript(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 72) return trimmed;
  return `${trimmed.slice(0, 72)}…`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

interface VoiceCommandButtonProps {
  className?: string;
  conversationId?: string | null;
  emailMessageId?: string | null;
  taskId?: string | null;
}

export default function VoiceCommandButton({
  className,
  conversationId,
  emailMessageId,
  taskId,
}: VoiceCommandButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    selectedWorkspaceId,
    selectedProjectId,
    switchWorkspace,
    setSelectedProjectId,
    calendars,
    projects,
    fetchNativeEvents,
    updateTask,
    bulkUpdateTasks,
  } = useAppContext();
  const bridge = useAssistantPageContextBridge();
  const { setSession, clearSession } = useAssistantSession();
  const { addToast, openModal, openGlobalSearch } = useUIContext();

  const browserSpeechRef = useRef<ReturnType<
    typeof startBrowserSpeechSession
  > | null>(null);
  const speechStartedAtRef = useRef(0);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopInFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [typedCommand, setTypedCommand] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);

  const clearMaxDurationTimer = useCallback(() => {
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const cleanupSpeech = useCallback(() => {
    clearMaxDurationTimer();
    browserSpeechRef.current = null;
  }, [clearMaxDurationTimer]);

  useEffect(() => {
    return () => {
      cleanupSpeech();
      abortControllerRef.current?.abort();
      clearSession();
    };
  }, [cleanupSpeech, clearSession]);

  const buildPageContext = useCallback((): AssistantPageContext => {
    return {
      pathname: pathname ?? "/dashboard",
      workspaceId: selectedWorkspaceId,
      projectId: selectedProjectId,
      conversationId: conversationId ?? bridge.conversationId ?? null,
      emailMessageId: emailMessageId ?? bridge.emailMessageId ?? null,
      taskId: taskId ?? bridge.taskId ?? null,
    };
  }, [
    pathname,
    selectedWorkspaceId,
    selectedProjectId,
    conversationId,
    emailMessageId,
    taskId,
    bridge.conversationId,
    bridge.emailMessageId,
    bridge.taskId,
  ]);

  const cancelActiveSession = useCallback(() => {
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    const speechSession = browserSpeechRef.current;
    if (speechSession) {
      speechSession.abort();
      browserSpeechRef.current = null;
    }

    cleanupSpeech();
    stopInFlightRef.current = false;
    setListening(false);
    setProcessing(false);
    setShowTextInput(false);
    setLiveTranscript("");
    clearSession();
  }, [cleanupSpeech, clearSession]);

  const runCommand = useCallback(
    async (transcript: string, fromVoice = false) => {
      const trimmed = transcript.trim();
      if (!trimmed) {
        setShowTextInput(true);
        addToast("No speech detected. Try again or type below.", "warning");
        return;
      }

      cancelledRef.current = false;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setProcessing(true);
      setSession({
        phase: "processing",
        statusLabel: "Thinking…",
        hintText: previewTranscript(trimmed),
        onCancel: () => cancelActiveSession(),
      });

      try {
        const result = await api.assistant.command(
          {
            transcript: trimmed,
            source: fromVoice ? "voice" : "typed",
            pageContext: buildPageContext(),
          },
          abortController.signal,
        );

        if (cancelledRef.current || abortController.signal.aborted) {
          return;
        }

        const isUnsupported = result.unsupported === true;
        const toastType = isUnsupported ? "warning" : "success";
        const toastMessage = fromVoice
          ? `Heard: “${previewTranscript(trimmed)}” — ${result.spokenReply}`
          : result.spokenReply;
        addToast(toastMessage, toastType);
        if (!isUnsupported && result.clientActions.length > 0) {
          executeAssistantClientActions(result.clientActions, {
            router,
            openModal,
            openGlobalSearch,
            switchWorkspace,
            setSelectedProjectId,
            addToast,
            pathname: pathname ?? "/dashboard",
            calendars,
            projects,
            workspaceId: selectedWorkspaceId,
            projectId: selectedProjectId,
            fetchNativeEvents,
            updateTask,
            bulkUpdateTasks,
          });
        }
        setShowTextInput(false);
        setTypedCommand("");
        setLiveTranscript("");
      } catch (e: unknown) {
        if (cancelledRef.current || isAbortError(e)) {
          return;
        }
        const msg =
          e instanceof Error ? e.message : "Voice command failed.";
        addToast(msg, "error");
        setShowTextInput(true);
      } finally {
        abortControllerRef.current = null;
        setProcessing(false);
        if (!cancelledRef.current) {
          clearSession();
        }
      }
    },
    [
      addToast,
      buildPageContext,
      calendars,
      cancelActiveSession,
      clearSession,
      fetchNativeEvents,
      openGlobalSearch,
      openModal,
      pathname,
      projects,
      router,
      selectedProjectId,
      selectedWorkspaceId,
      setSelectedProjectId,
      setSession,
      switchWorkspace,
      updateTask,
      bulkUpdateTasks,
    ],
  );

  const finalizeVoiceInput = useCallback(
    async (browserTranscript: string, durationMs: number) => {
      if (cancelledRef.current) {
        return;
      }

      const browserText = browserTranscript.trim();

      if (browserText.length >= 2) {
        setLiveTranscript(browserText);
        await runCommand(browserText, true);
        return;
      }

      clearSession();
      setShowTextInput(true);
      if (durationMs < MIN_SPEECH_MS) {
        addToast(
          "Hold the mic longer while you speak, or type your command below.",
          "warning",
        );
        return;
      }

      addToast(
        "Could not hear that. Check your mic, then try again or type below.",
        "warning",
      );
    },
    [addToast, clearSession, runCommand],
  );

  const stopListening = useCallback(async () => {
    if (stopInFlightRef.current) return;
    stopInFlightRef.current = true;
    setListening(false);
    clearMaxDurationTimer();

    const speechSession = browserSpeechRef.current;
    browserSpeechRef.current = null;
    const durationMs = Date.now() - speechStartedAtRef.current;

    const browserTranscript = speechSession
      ? await speechSession.stop()
      : "";

    cleanupSpeech();
    stopInFlightRef.current = false;

    if (cancelledRef.current) {
      return;
    }

    await finalizeVoiceInput(browserTranscript, durationMs);
  }, [cleanupSpeech, clearMaxDurationTimer, finalizeVoiceInput]);

  const startListening = useCallback(async () => {
    if (processing || listening) return;

    if (!isBrowserSpeechRecognitionAvailable()) {
      setShowTextInput(true);
      addToast(
        "Voice recognition is not available in this browser. Type your command below.",
        "warning",
      );
      return;
    }

    cancelledRef.current = false;
    cleanupSpeech();
    stopInFlightRef.current = false;
    setShowTextInput(true);
    setLiveTranscript("");
    setListening(true);

    setSession({
      phase: "listening",
      statusLabel: "Listening…",
      hintText: "Release the mic when you are done",
      onCancel: () => cancelActiveSession(),
    });

    const session = startBrowserSpeechSession({
      onPartialTranscript: (text) => {
        if (!cancelledRef.current) {
          setLiveTranscript(text);
        }
      },
    });

    if (!session) {
      setListening(false);
      clearSession();
      setShowTextInput(true);
      addToast(
        "Could not start voice recognition. Type your command below.",
        "warning",
      );
      return;
    }

    browserSpeechRef.current = session;
    speechStartedAtRef.current = Date.now();

    maxDurationTimerRef.current = setTimeout(() => {
      void stopListening();
    }, MAX_SPEECH_MS);
  }, [
    addToast,
    cancelActiveSession,
    cleanupSpeech,
    clearSession,
    listening,
    processing,
    setSession,
    stopListening,
  ]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (processing || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void startListening();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (listening) void stopListening();
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runCommand(typedCommand);
  };

  const busy = listening || processing;
  const inputValue =
    processing && liveTranscript
      ? liveTranscript
      : listening
        ? liveTranscript || "Listening…"
        : typedCommand;

  const buttonClass = `${ICON_BUTTON_CLASSES} ${className ?? ""} ${
    listening ? "bg-primary/20 text-primary ring-2 ring-primary/40" : ""
  } ${processing ? "pointer-events-none opacity-60" : ""}`;

  return (
    <div
      className="relative flex flex-col items-center"
      data-assistant-session-ignore
    >
      <button
        type="button"
        className={buttonClass}
        title={
          listening
            ? "Listening… speak now, release when done"
            : "Hold and speak your command"
        }
        aria-label={
          listening ? "Recording voice command" : "Voice command"
        }
        aria-pressed={listening}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (!listening && !processing) void startListening();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            if (listening) void stopListening();
          }
        }}
      >
        <span className="material-symbols-outlined text-[22px]">
          {busy ? "graphic_eq" : "mic"}
        </span>
      </button>

      {(showTextInput || listening || processing) && (
        <form
          onSubmit={handleTextSubmit}
          data-assistant-session-ignore
          className="pointer-events-auto absolute bottom-full z-50 mb-2 flex w-72 items-center gap-2 rounded-xl border border-border-dark bg-surface-dark/95 p-2 shadow-lg backdrop-blur-xl"
        >
          {busy && (
            <span className="material-symbols-outlined shrink-0 animate-pulse text-primary text-[20px]">
              graphic_eq
            </span>
          )}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              if (!listening && !processing) setTypedCommand(e.target.value);
            }}
            readOnly={listening || processing}
            placeholder={
              listening ? "Listening… release when done" : "Type a command…"
            }
            className="min-w-0 flex-1 rounded-lg border border-border-dark bg-background-dark px-2 py-1.5 text-sm text-text-main outline-none focus:border-primary"
            disabled={processing}
          />
          <button
            type="submit"
            disabled={processing || !typedCommand.trim() || listening}
            className="rounded-lg bg-primary px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Go
          </button>
        </form>
      )}
    </div>
  );
}
