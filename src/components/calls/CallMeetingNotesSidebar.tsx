"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import type { CallNotesUpdatePayload } from "@/types/calls";

type TabId = "public" | "private";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface CallMeetingNotesSidebarHandle {
  flushPending: () => Promise<void>;
  handleNotesUpdate: (payload: CallNotesUpdatePayload) => void;
}

interface CallMeetingNotesSidebarProps {
  callId: string;
  currentUserId: string;
  /** Maps user id → display name for collaborator hint. */
  memberNameById?: Record<string, string>;
  realtimeConnected?: boolean;
  defaultCollapsed?: boolean;
}

function privateStorageKey(callId: string): string {
  return `ow-call-notes-private:${callId}`;
}

function loadPrivateDraft(callId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(privateStorageKey(callId)) ?? "";
  } catch {
    return "";
  }
}

function savePrivateDraft(callId: string, content: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(privateStorageKey(callId), content);
  } catch {
    /* quota */
  }
}

function clearPrivateDraft(callId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(privateStorageKey(callId));
}

export const CallMeetingNotesSidebar = forwardRef<
  CallMeetingNotesSidebarHandle,
  CallMeetingNotesSidebarProps
>(function CallMeetingNotesSidebar(
  {
    callId,
    currentUserId,
    memberNameById = {},
    realtimeConnected = false,
    defaultCollapsed = false,
  },
  ref,
) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [tab, setTab] = useState<TabId>("public");
  const [publicContent, setPublicContent] = useState("");
  const [privateContent, setPrivateContent] = useState("");
  const [publicUpdatedBy, setPublicUpdatedBy] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [loaded, setLoaded] = useState(false);

  const publicRef = useRef(publicContent);
  const privateRef = useRef(privateContent);
  const publicDirtyRef = useRef(false);
  const privateDirtyRef = useRef(false);
  const publicDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const privateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publicEditingRef = useRef(false);
  const publicEditingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  publicRef.current = publicContent;
  privateRef.current = privateContent;

  const savePublic = useCallback(async () => {
    if (!publicDirtyRef.current) return;
    publicDirtyRef.current = false;
    setSaveStatus("saving");
    try {
      const res = await api.calls.patchPublicMeetingNotes(
        callId,
        publicRef.current,
      );
      setPublicUpdatedBy(res.publicUpdatedBy);
      setSaveStatus("saved");
    } catch {
      publicDirtyRef.current = true;
      setSaveStatus("error");
    }
  }, [callId]);

  const savePrivate = useCallback(async () => {
    if (!privateDirtyRef.current) return;
    privateDirtyRef.current = false;
    savePrivateDraft(callId, privateRef.current);
    try {
      await api.calls.patchPrivateMeetingNotes(callId, privateRef.current);
    } catch {
      privateDirtyRef.current = true;
    }
  }, [callId]);

  const schedulePublicSave = useCallback(() => {
    publicDirtyRef.current = true;
    setSaveStatus("idle");
    if (publicDebounceRef.current) clearTimeout(publicDebounceRef.current);
    publicDebounceRef.current = setTimeout(() => {
      void savePublic();
    }, 400);
  }, [savePublic]);

  const schedulePrivateSave = useCallback(() => {
    privateDirtyRef.current = true;
    savePrivateDraft(callId, privateRef.current);
    if (privateDebounceRef.current) clearTimeout(privateDebounceRef.current);
    privateDebounceRef.current = setTimeout(() => {
      void savePrivate();
    }, 400);
  }, [callId, savePrivate]);

  const handleNotesUpdate = useCallback(
    (payload: CallNotesUpdatePayload) => {
      if (payload.updatedBy === currentUserId && publicEditingRef.current) {
        return;
      }
      setPublicContent(payload.publicContent);
      publicRef.current = payload.publicContent;
      publicDirtyRef.current = false;
      setPublicUpdatedBy(payload.updatedBy);
      setSaveStatus("saved");
    },
    [currentUserId],
  );

  const flushPending = useCallback(async () => {
    if (publicDebounceRef.current) {
      clearTimeout(publicDebounceRef.current);
      publicDebounceRef.current = null;
    }
    if (privateDebounceRef.current) {
      clearTimeout(privateDebounceRef.current);
      privateDebounceRef.current = null;
    }
    await Promise.all([savePublic(), savePrivate()]);
  }, [savePublic, savePrivate]);

  useImperativeHandle(
    ref,
    () => ({
      flushPending,
      handleNotesUpdate,
    }),
    [flushPending, handleNotesUpdate],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const notes = await api.calls.getMeetingNotes(callId);
        if (cancelled) return;
        setPublicContent(notes.publicContent);
        publicRef.current = notes.publicContent;
        const draft = loadPrivateDraft(callId);
        const priv =
          draft.trim().length > 0 ? draft : notes.privateContent;
        setPrivateContent(priv);
        privateRef.current = priv;
        setPublicUpdatedBy(notes.publicUpdatedBy);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  useEffect(() => {
    if (realtimeConnected) return undefined;
    const pollId = window.setInterval(() => {
      void api.calls
        .getMeetingNotes(callId)
        .then((notes) => {
          if (publicEditingRef.current) return;
          setPublicContent(notes.publicContent);
          publicRef.current = notes.publicContent;
          setPublicUpdatedBy(notes.publicUpdatedBy);
        })
        .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(pollId);
  }, [callId, realtimeConnected]);

  useEffect(() => {
    return () => {
      if (publicDebounceRef.current) clearTimeout(publicDebounceRef.current);
      if (privateDebounceRef.current) clearTimeout(privateDebounceRef.current);
      if (publicEditingTimerRef.current) {
        clearTimeout(publicEditingTimerRef.current);
      }
    };
  }, []);

  const onPublicChange = (value: string) => {
    publicEditingRef.current = true;
    if (publicEditingTimerRef.current) {
      clearTimeout(publicEditingTimerRef.current);
    }
    publicEditingTimerRef.current = setTimeout(() => {
      publicEditingRef.current = false;
    }, 1200);
    setPublicContent(value);
    publicRef.current = value;
    schedulePublicSave();
  };

  const onPrivateChange = (value: string) => {
    setPrivateContent(value);
    privateRef.current = value;
    schedulePrivateSave();
  };

  const collaboratorHint =
    publicUpdatedBy && publicUpdatedBy !== currentUserId
      ? memberNameById[publicUpdatedBy] ?? "Someone"
      : null;

  const statusLabel = (): string | null => {
    if (tab !== "public") return null;
    if (saveStatus === "saving") return "Saving…";
    if (saveStatus === "error") return "Could not save";
    if (saveStatus === "saved" && collaboratorHint) {
      return `Updated by ${collaboratorHint}`;
    }
    if (saveStatus === "saved") return "Saved";
    return null;
  };

  if (collapsed) {
    return (
      <aside className="flex flex-col shrink-0 w-12 border-r border-border-dark bg-surface-dark/80 items-center py-3 gap-3">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="size-9 rounded-lg bg-primary/20 text-primary flex items-center justify-center"
          title="Open meeting notes"
        >
          <span className="material-symbols-outlined text-[20px]">edit_note</span>
        </button>
      </aside>
    );
  }

  const status = statusLabel();

  return (
    <aside className="flex flex-col shrink-0 w-72 sm:w-80 xl:w-96 h-full max-h-full border-r border-border-dark bg-surface-dark/90 min-h-0 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-dark shrink-0">
        <span className="text-sm font-semibold text-white">Meeting notes</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="size-8 rounded-lg hover:bg-white/10 text-text-secondary flex items-center justify-center"
          title="Collapse"
        >
          <span className="material-symbols-outlined text-[18px]">
            chevron_left
          </span>
        </button>
      </div>

      <div className="flex border-b border-border-dark shrink-0">
        {(
          [
            ["public", "Public"],
            ["private", "Private"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 text-xs py-2 px-1 font-medium ${
              tab === id
                ? "text-primary border-b-2 border-primary"
                : "text-text-secondary hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-3 gap-2">
        {tab === "public" ? (
          <p className="text-[10px] text-text-secondary shrink-0">
            Visible to everyone in this call.
          </p>
        ) : (
          <p className="text-[10px] text-text-secondary shrink-0">
            Only you can see these notes.
          </p>
        )}
        {status ? (
          <p className="text-[10px] text-text-secondary/80 shrink-0">{status}</p>
        ) : null}
        <textarea
          value={tab === "public" ? publicContent : privateContent}
          onChange={(e) =>
            tab === "public"
              ? onPublicChange(e.target.value)
              : onPrivateChange(e.target.value)
          }
          placeholder={
            loaded
              ? tab === "public"
                ? "Shared notes for the room…"
                : "Your private notes…"
              : "Loading notes…"
          }
          disabled={!loaded}
          className="flex-1 min-h-0 w-full resize-none rounded-lg bg-white/5 border border-border-dark text-sm text-white/90 placeholder:text-text-secondary/50 p-3 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
    </aside>
  );
});

/** Clears private draft after successful export on leave. */
export function clearMeetingNotesPrivateDraft(callId: string): void {
  clearPrivateDraft(callId);
}
