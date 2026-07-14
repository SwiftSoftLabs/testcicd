"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import VoiceCommandButton from "@/components/assistant/VoiceCommandButton";
import { useAssistantPageContextBridge } from "@/context/AssistantPageContextBridge";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";

const PINNED_CLEARANCE = "6rem";
const HIDE_DELAY_MS = 140;

type QuickAction = {
  id: string;
  label: string;
  icon: string;
  onClick: () => void;
};

const PANEL_CLASSES =
  "mb-4 flex items-center gap-2 rounded-full border border-border-dark bg-surface-dark/95 px-3 py-2 text-text-main shadow-[0_16px_40px_rgba(0,0,0,0.18)] ring-1 ring-border-dark/80 backdrop-blur-xl transition-all duration-200";

const ICON_BUTTON_CLASSES =
  "flex size-10 cursor-pointer items-center justify-center rounded-full text-text-secondary transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:text-text-main focus-visible:bg-white/10 focus-visible:outline-none";

const DIVIDER_CLASSES = "h-8 w-px bg-border-dark";

export default function QuickTaskbar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    appSettings,
    updateAppSettings,
    saveSettingsToDb,
    selectedProjectId,
    selectedWorkspaceId,
  } = useAppContext();
  const { addToast, openModal } = useUIContext();
  const { conversationId, emailMessageId, taskId } =
    useAssistantPageContextBridge();

  const [isRevealed, setIsRevealed] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const pinned = appSettings.quickTaskbarPinned;
  const isCallRoom = /^\/calls\/[^/]+\/room(\/|$)/.test(pathname ?? "");

  useEffect(() => {
    if (isCallRoom) {
      document.documentElement.style.removeProperty("--quick-taskbar-clearance");
      return;
    }
    document.documentElement.style.setProperty(
      "--quick-taskbar-clearance",
      pinned ? PINNED_CLEARANCE : "0px",
    );
    return () => {
      document.documentElement.style.removeProperty(
        "--quick-taskbar-clearance",
      );
    };
  }, [pinned, isCallRoom]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const clearHideTimer = () => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  };

  const reveal = () => {
    clearHideTimer();
    setIsRevealed(true);
  };

  const scheduleHide = () => {
    if (pinned) return;
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setIsRevealed(false);
    }, HIDE_DELAY_MS);
  };

  const persistPinnedState = async (nextPinned: boolean) => {
    const nextSettings = {
      ...appSettings,
      quickTaskbarPinned: nextPinned,
    };

    updateAppSettings({ quickTaskbarPinned: nextPinned });
    setIsRevealed(true);

    try {
      if (saveSettingsToDb) {
        await saveSettingsToDb(nextSettings);
      }
    } catch (error: unknown) {
      updateAppSettings({ quickTaskbarPinned: pinned });
      setIsRevealed(pinned);
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save quick taskbar preference.";
      addToast(message, "error");
    }
  };

  const navigateToQuickPr = () => {
    if (!selectedWorkspaceId) {
      addToast("Select a workspace first.", "warning");
      return;
    }

    const params = new URLSearchParams();
    if (selectedProjectId) {
      params.set("projectId", selectedProjectId);
    }
    params.set("quickPr", "1");
    router.push(`/version-control?${params.toString()}`);
  };

  const quickActions: QuickAction[] = [
    {
      id: "new-task",
      label: "New Task",
      icon: "add_task",
      onClick: () =>
        openModal("new-task", {
          initialProjectId: selectedProjectId ?? undefined,
        }),
    },
    {
      id: "new-pr",
      label: "New Pull Request",
      icon: "merge_type",
      onClick: navigateToQuickPr,
    },
    {
      id: "new-message",
      label: "New Message",
      icon: "chat_bubble",
      onClick: () => openModal("new-message"),
    },
  ];

  const handleComposeClick = () => {
    if (pathname !== "/email/compose") {
      router.push("/email/compose");
    }
  };

  if (isCallRoom) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center">
      {!pinned && (
        <>
          <div
            className="pointer-events-auto absolute bottom-0 left-1/2 -translate-x-1/2 w-48 h-10"
            onMouseEnter={reveal}
            onMouseLeave={scheduleHide}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={reveal}
            className={`pointer-events-auto absolute bottom-2 inline-flex h-2.5 w-24 cursor-pointer items-center justify-center rounded-full border border-border-dark bg-surface-dark/90 shadow-md backdrop-blur transition-all hover:bg-white/10 ${
              isRevealed
                ? "translate-y-4 opacity-0"
                : "translate-y-0 opacity-100"
            }`}
            aria-label="Show quick taskbar"
          >
            <span className="block h-1 w-10 rounded-full bg-text-secondary/40" />
          </button>
        </>
      )}

      <div
        ref={panelRef}
        data-quick-taskbar-panel
        data-assistant-session-ignore
        className={`${PANEL_CLASSES} ${
          pinned || isRevealed
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none translate-y-16 opacity-0"
        }`}
        onMouseEnter={reveal}
        onMouseLeave={scheduleHide}
        onFocusCapture={reveal}
        onBlurCapture={(event) => {
          if (
            panelRef.current &&
            event.relatedTarget instanceof Node &&
            panelRef.current.contains(event.relatedTarget)
          ) {
            return;
          }
          scheduleHide();
        }}
      >
        <div className="flex items-center gap-1">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              className={ICON_BUTTON_CLASSES}
              title={action.label}
              aria-label={action.label}
            >
              <span className="material-symbols-outlined text-[22px]">
                {action.icon}
              </span>
            </button>
          ))}
        </div>

        <div className={DIVIDER_CLASSES} />

        <VoiceCommandButton
          conversationId={conversationId}
          emailMessageId={emailMessageId}
          taskId={taskId}
        />

        <button
          type="button"
          onClick={handleComposeClick}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:bg-blue-600 focus-visible:outline-none"
        >
          <span className="material-symbols-outlined text-[18px]">
            edit_square
          </span>
          <span>Compose</span>
        </button>

        <div className={DIVIDER_CLASSES} />

        <button
          type="button"
          onClick={() => void persistPinnedState(!pinned)}
          className={`flex size-10 cursor-pointer items-center justify-center rounded-full transition-all focus-visible:outline-none ${
            pinned
              ? "bg-white/10 text-text-main"
              : ICON_BUTTON_CLASSES
          }`}
          title={pinned ? "Unpin quick taskbar" : "Pin quick taskbar"}
          aria-label={pinned ? "Unpin quick taskbar" : "Pin quick taskbar"}
        >
          <span className="material-symbols-outlined text-[20px]">
            {pinned ? "keep_off" : "keep"}
          </span>
        </button>
      </div>
    </div>
  );
}
