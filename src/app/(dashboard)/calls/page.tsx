"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { callRoomHref } from "@/lib/calls/joinSession";
import { format, isToday } from "date-fns";
import { useAppContext } from "@/context/AppContext";
import { api } from "@/lib/api";
import type { WorkspaceMember } from "@/lib/api";
import { NewCallModal } from "@/components/calls/NewCallModal";
import { MeetingReviewQueue } from "@/components/calls/MeetingReviewQueue";
import { CallProcessingProgressMiniRow } from "@/components/calls/CallProcessingProgress";
import type { CallSessionRow, MeetingTaskReviewRow } from "@/types/calls";

const TABS = ["home", "history", "review", "scheduled"] as const;
type CallsTab = (typeof TABS)[number];

type CallListRow = CallSessionRow & { active_count?: number };

type TabCacheEntry = {
  calls: CallListRow[];
  reviews: MeetingTaskReviewRow[];
  hasMore: boolean;
};

function buildHomeDisplayCalls(
  activeCalls: CallListRow[],
  upcoming: CallListRow | null,
): CallListRow[] {
  if (!upcoming) return activeCalls;
  const rest = activeCalls.filter((c) => c.id !== upcoming.id);
  return [upcoming, ...rest];
}

function callListWhenLabel(c: CallListRow, tab: CallsTab): string | null {
  if (c.status === "scheduled" && c.scheduled_start_at) {
    const start = new Date(c.scheduled_start_at);
    return isToday(start)
      ? `Today · ${format(start, "h:mm a")}`
      : format(start, "MMM d, yyyy · h:mm a");
  }
  if (tab === "home" && (c.status === "lobby" || c.status === "live")) {
    const when = c.started_at ?? c.created_at;
    return when ? format(new Date(when), "MMM d, yyyy · h:mm a") : null;
  }
  return null;
}

function CallsPageInner() {
  const { selectedWorkspaceId, currentUser } = useAppContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const callsFrom =
    pathname +
    (searchParams.toString() ? `?${searchParams.toString()}` : "");
  const tab = (searchParams.get("tab") ?? "home") as CallsTab;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const [calls, setCalls] = useState<CallListRow[]>([]);
  const [reviews, setReviews] = useState<MeetingTaskReviewRow[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteModalCallId, setDeleteModalCallId] = useState<string | null>(null);
  const [deleteModalTitle, setDeleteModalTitle] = useState("");
  const [deletingCall, setDeletingCall] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadGenRef = useRef(0);
  const tabCacheRef = useRef<Partial<Record<CallsTab, TabCacheEntry>>>({});
  const membersWorkspaceRef = useRef<string | null>(null);
  const tabRawOffsetRef = useRef<Partial<Record<CallsTab, number>>>({});
  const homeActiveCallsRef = useRef<CallListRow[]>([]);
  const homeUpcomingCallRef = useRef<CallListRow | null>(null);

  const load = useCallback(async () => {
    if (!selectedWorkspaceId) return;

    const requestTab = tab;
    const gen = ++loadGenRef.current;
    const cached = tabCacheRef.current[requestTab];

    if (cached) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    if (membersWorkspaceRef.current !== selectedWorkspaceId) {
      membersWorkspaceRef.current = selectedWorkspaceId;
      api.users
        .getMembers(selectedWorkspaceId, { limit: 100 })
        .then((res) => setMembers(res.data ?? []))
        .catch(() => { membersWorkspaceRef.current = null; });
    }

    try {
      const listTab = requestTab === "review" ? "home" : requestTab;
      const [callList, reviewList, upcomingList] = await Promise.all([
        api.calls.list(selectedWorkspaceId, listTab),
        requestTab === "review"
          ? api.calls.reviews(selectedWorkspaceId)
          : Promise.resolve([] as MeetingTaskReviewRow[]),
        requestTab === "home"
          ? api.calls.upcoming(selectedWorkspaceId)
          : Promise.resolve([] as CallListRow[]),
      ]);

      if (gen !== loadGenRef.current) return;

      const fetchedCount = requestTab === "review" ? reviewList.length : callList.length;
      const nextHasMore = fetchedCount === 5;

      if (requestTab === "home") {
        homeActiveCallsRef.current = callList;
        homeUpcomingCallRef.current = upcomingList[0] ?? null;
        tabRawOffsetRef.current["home"] = callList.length;
      } else if (requestTab === "review") {
        tabRawOffsetRef.current["review"] = reviewList.length;
      } else {
        tabRawOffsetRef.current[requestTab] = callList.length;
      }

      const displayCallList =
        listTab === "home"
          ? buildHomeDisplayCalls(callList, upcomingList[0] ?? null)
          : callList;

      const entry: TabCacheEntry = { calls: displayCallList, reviews: reviewList, hasMore: nextHasMore };
      tabCacheRef.current[requestTab] = entry;

      if (tabRef.current === requestTab) {
        setCalls(displayCallList);
        setReviews(reviewList);
        setHasMore(nextHasMore);
      }
    } catch {
      if (gen !== loadGenRef.current) return;
      if (tabRef.current === requestTab) {
        setCalls([]);
        if (requestTab === "review") setReviews([]);
      }
    } finally {
      if (gen === loadGenRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [selectedWorkspaceId, tab]);

  const confirmDeleteCall = async () => {
    if (!deleteModalCallId) return;
    setDeletingCall(true);
    try {
      await api.calls.deleteCall(deleteModalCallId);
      setDeleteModalCallId(null);
      tabCacheRef.current = {};
      void load();
    } catch {
      /* surface via empty list refresh */
    } finally {
      setDeletingCall(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (!selectedWorkspaceId || loadingMore) return;
    setLoadingMore(true);
    try {
      const offset = tabRawOffsetRef.current[tab] ?? 0;
      if (tab === "review") {
        const more = await api.calls.reviews(selectedWorkspaceId, offset);
        tabRawOffsetRef.current["review"] = offset + more.length;
        setReviews((prev) => [...prev, ...more]);
        setHasMore(more.length === 5);
      } else {
        const more = await api.calls.list(selectedWorkspaceId, tab, offset);
        tabRawOffsetRef.current[tab] = offset + more.length;
        if (tab === "home") {
          homeActiveCallsRef.current = [...homeActiveCallsRef.current, ...more];
          setCalls(
            buildHomeDisplayCalls(
              homeActiveCallsRef.current,
              homeUpcomingCallRef.current,
            ),
          );
        } else {
          setCalls((prev) => [...prev, ...more]);
        }
        setHasMore(more.length === 5);
      }
    } catch {
      // silently fail — list remains intact
    } finally {
      setLoadingMore(false);
    }
  }, [selectedWorkspaceId, loadingMore, tab]);

  useEffect(() => {
    tabCacheRef.current = {};
    tabRawOffsetRef.current = {};
    homeActiveCallsRef.current = [];
    homeUpcomingCallRef.current = null;
    setLoading(true);
    setCalls([]);
    setReviews([]);
    setHasMore(false);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const cached = tabCacheRef.current[tab];
    if (cached) {
      setCalls(cached.calls);
      setReviews(cached.reviews);
      setHasMore(cached.hasMore);
      setLoading(false);
    }
    void load();
  }, [load, tab]);

  if (!selectedWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary text-sm">
        Select a workspace to use Calls.
      </div>
    );
  }

  const showInitialLoading = loading && !tabCacheRef.current[tab];
  const showEmpty =
    !showInitialLoading &&
    (tab === "review" ? reviews.length === 0 : calls.length === 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Calls</h1>
          <p className="text-sm text-text-secondary">
            Workspace video meetings
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="cursor-pointer px-4 py-2 bg-primary text-white text-sm font-bold rounded-xl"
        >
          New call
        </button>
      </div>

      <nav className="px-4 sm:px-6 flex gap-1 border-b border-border-dark shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((t) => (
          <Link
            key={t}
            href={t === "home" ? "/calls" : `/calls?tab=${t}`}
            className={`px-2.5 sm:px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px whitespace-nowrap shrink-0 ${
              tab === t
                ? "border-primary text-white"
                : "border-transparent text-text-secondary"
            }`}
          >
            {t}
          </Link>
        ))}
        {refreshing && (
          <span className="ml-auto self-center size-3 border-2 border-text-secondary border-t-transparent rounded-full animate-spin" />
        )}
      </nav>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {showInitialLoading ? (
          <p className="text-text-secondary text-sm">Loading…</p>
        ) : tab === "review" ? (
          <>
            <MeetingReviewQueue
              workspaceId={selectedWorkspaceId}
              initialReviews={reviews}
            />
            {hasMore && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="cursor-pointer px-4 py-2 text-sm font-medium text-text-secondary hover:text-white disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "Show more"}
                </button>
              </div>
            )}
          </>
        ) : showEmpty ? (
          <p className="text-text-secondary text-sm">No calls yet.</p>
        ) : (
          <>
          <ul className="space-y-3">
            {calls.map((c) => {
              const isHost = currentUser?.id === c.created_by;
              const when = c.ended_at ?? c.created_at;
              const whenLabel = callListWhenLabel(c, tab);
              const minimalHistory =
                tab === "history" &&
                !c.recording_enabled &&
                !["live", "lobby", "scheduled"].includes(c.status);

              if (minimalHistory) {
                return (
                  <li
                    key={c.id}
                    className="p-3 sm:p-4 rounded-xl border border-border-dark bg-surface-dark flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3"
                  >
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white">{c.title}</h3>
                      <p className="text-xs text-text-secondary">
                        {when
                          ? format(new Date(when), "MMM d, yyyy · h:mm a")
                          : ""}
                      </p>
                    </div>
                    {isHost && (
                      <button
                        type="button"
                        className="cursor-pointer px-3 py-1.5 text-xs font-bold text-red-400 border border-red-500/40 rounded-lg hover:bg-red-500/10"
                        onClick={() => {
                          setDeleteModalCallId(c.id);
                          setDeleteModalTitle(c.title);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </li>
                );
              }

              return (
                <li
                  key={c.id}
                  className="p-3 sm:p-4 rounded-xl border border-border-dark bg-surface-dark flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3"
                >
                  <div className="min-w-0">
                    <h3 className="font-semibold text-white">{c.title}</h3>
                    <p className="text-xs text-text-secondary capitalize">
                      {c.status}
                      {callListWhenLabel(c, tab) ? ` · ${whenLabel}` : ""}
                      {c.active_count != null && c.active_count > 0
                        ? ` · ${c.active_count} in call`
                        : ""}
                    </p>
                    {c.status === "processing" ? (
                      <CallProcessingProgressMiniRow call={c} />
                    ) : null}
                  </div>
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    {(c.status === "live" || c.status === "lobby") && (
                      <Link
                        href={callRoomHref(c.id, callsFrom)}
                        className="px-3 py-1.5 text-xs font-bold bg-primary text-white rounded-lg"
                      >
                        Join
                      </Link>
                    )}
                    {c.status === "processing" ? (
                      <Link
                        href={`/calls/${c.id}/processing`}
                        className="px-3 py-1.5 text-xs font-bold bg-blue-600/80 text-white rounded-lg"
                      >
                        Progress
                      </Link>
                    ) : null}
                    <Link
                      href={`/calls/${c.id}`}
                      className="px-3 py-1.5 text-xs font-bold bg-white/10 text-white rounded-lg"
                    >
                      Details
                    </Link>
                    {isHost &&
                      (tab === "history" ||
                        (tab === "home" &&
                          (c.status === "lobby" || c.status === "live"))) && (
                        <button
                          type="button"
                          className="cursor-pointer px-3 py-1.5 text-xs font-bold text-red-400 border border-red-500/40 rounded-lg hover:bg-red-500/10"
                          onClick={() => {
                            setDeleteModalCallId(c.id);
                            setDeleteModalTitle(c.title);
                          }}
                        >
                          Delete
                        </button>
                      )}
                  </div>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="cursor-pointer px-4 py-2 text-sm font-medium text-text-secondary hover:text-white disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {showNew && (
        <NewCallModal
          workspaceId={selectedWorkspaceId}
          members={members}
          onClose={() => setShowNew(false)}
        />
      )}

      {deleteModalCallId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-dark border border-border-dark rounded-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Delete call history?</h3>
            <p className="text-xs text-text-secondary">
              Remove “{deleteModalTitle}” and all related AI summary, review-queue
              drafts, and recordings (including files in Meeting-Recording).
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="cursor-pointer px-3 py-1.5 text-sm text-text-secondary"
                onClick={() => setDeleteModalCallId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingCall}
                className="cursor-pointer px-3 py-1.5 text-sm font-bold bg-red-600 text-white rounded-lg disabled:opacity-50"
                onClick={() => void confirmDeleteCall()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CallsPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-text-secondary text-sm">
          Loading calls…
        </div>
      }
    >
      <CallsPageInner />
    </Suspense>
  );
}
