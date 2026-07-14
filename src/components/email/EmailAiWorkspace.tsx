"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import {
  AiGradientButton,
  AiHeading,
  AiPanel,
  aiGradientTextClass,
} from "@/components/ai/AiUi";

type AiTab =
  | "digest"
  | "thread_digest"
  | "reply_hint"
  | "reply_drafts"
  | "compare";

type Tone = "neutral" | "concise" | "formal" | "friendly";

type DigestPayload = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  evidence: { keyPointIndex: number; quote: string }[];
  sourceTruncated: boolean;
};

type ReplyHintPayload = {
  openQuestions: string[];
  missingInfo: string[];
  risks: string[];
  sourceTruncated: boolean;
};

type ReplyDraftsPayload = {
  drafts: { label: string; body: string }[];
  sourceTruncated: boolean;
};

type ComparePayload = {
  summary: string;
  differences: string[];
  whichIsNewer: "A" | "B" | "unknown";
};

function quoteForKeyPoint(
  evidence: DigestPayload["evidence"],
  idx: number,
): string | undefined {
  const hit = evidence.find((e) => e.keyPointIndex === idx);
  return hit?.quote;
}

export function EmailAiWorkspace({
  emailId,
  qsFolder,
  demoMailbox,
  compareCandidates,
}: {
  emailId: string;
  qsFolder: string;
  demoMailbox: boolean;
  compareCandidates: { id: string; subject: string }[];
}) {
  const { addTask, currentUser, selectedProjectId } = useAppContext();
  const { addToast } = useUIContext();

  const [tab, setTab] = useState<AiTab>("digest");
  const [tone, setTone] = useState<Tone>("neutral");
  const [instructions, setInstructions] = useState("");
  const [persist, setPersist] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [digest, setDigest] = useState<DigestPayload | null>(null);
  const [threadDigest, setThreadDigest] = useState<DigestPayload | null>(null);
  const [replyHint, setReplyHint] = useState<ReplyHintPayload | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<ReplyDraftsPayload | null>(
    null,
  );
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [compareOtherId, setCompareOtherId] = useState("");

  const permalink = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/email/${emailId}?folder=${encodeURIComponent(qsFolder)}`;
  }, [emailId, qsFolder]);

  useEffect(() => {
    setDigest(null);
    setThreadDigest(null);
    setReplyHint(null);
    setReplyDrafts(null);
    setCompare(null);
    setError(null);
    setCompareOtherId("");
  }, [emailId]);

  useEffect(() => {
    if (demoMailbox) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await api.email.getCachedEmailAi(emailId);
        if (cancelled || !cached) return;
        if (typeof cached.summary === "string") {
          setDigest({
            summary: cached.summary,
            keyPoints: Array.isArray(cached.keyPoints)
              ? (cached.keyPoints as string[])
              : [],
            actionItems: Array.isArray(cached.actionItems)
              ? (cached.actionItems as string[])
              : [],
            evidence: Array.isArray(cached.evidence)
              ? (cached.evidence as { keyPointIndex: number; quote: string }[])
              : [],
            sourceTruncated: Boolean(cached.sourceTruncated),
          });
        }
      } catch {
        /* no cache */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [emailId, demoMailbox]);

  const baseBody = useMemo(
    () => ({
      tone,
      instructions: instructions.trim() || undefined,
      store: persist,
      skipCache: false,
    }),
    [tone, instructions, persist],
  );

  const run = useCallback(async () => {
    if (demoMailbox) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "compare") {
        if (!compareOtherId) {
          setError("Pick another message to compare.");
          setLoading(false);
          return;
        }
        const data = (await api.email.requestEmailAi(emailId, {
          ...baseBody,
          kind: "compare",
          compareWithMessageId: compareOtherId,
          skipCache: Boolean(compare),
        })) as ComparePayload;
        setCompare(data);
        return;
      }
      const kind = tab;
      const hasResult =
        (kind === "digest" && digest) ||
        (kind === "thread_digest" && threadDigest) ||
        (kind === "reply_hint" && replyHint) ||
        (kind === "reply_drafts" && replyDrafts);
      const data = await api.email.requestEmailAi(emailId, {
        ...baseBody,
        kind,
        skipCache: Boolean(hasResult),
      });
      if (kind === "digest") setDigest(data as unknown as DigestPayload);
      if (kind === "thread_digest")
        setThreadDigest(data as unknown as DigestPayload);
      if (kind === "reply_hint")
        setReplyHint(data as unknown as ReplyHintPayload);
      if (kind === "reply_drafts")
        setReplyDrafts(data as unknown as ReplyDraftsPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [
    baseBody,
    compare,
    compareOtherId,
    demoMailbox,
    digest,
    emailId,
    replyDrafts,
    replyHint,
    tab,
    threadDigest,
  ]);

  const createTaskFromLine = async (line: string) => {
    const title = line.trim().slice(0, 220) || "Follow up from email";
    const description = [`From: ${permalink}`, "", line.trim()].join("\n");
    try {
      await addTask({
        title,
        description,
        status: "todo",
        priority: "medium",
        assigneeId: currentUser.id,
        tags: ["email"],
        commentsCount: 0,
        projectId: selectedProjectId || undefined,
      });
      addToast("Task created", "success");
    } catch (e) {
      console.error(e);
      addToast("Could not create task", "error");
    }
  };

  const activeDigest = tab === "thread_digest" ? threadDigest : digest;
  const showDigestPanel =
    (tab === "digest" && digest) || (tab === "thread_digest" && threadDigest);

  return (
    <section aria-label="AI email workspace">
      <AiPanel
        collapsible={false}
        open
        header={
          <AiHeading
            title="AI workspace"
            subtitle="Summaries, thread digest, reply coaching, drafts, and compare"
            className="flex-1"
          />
        }
      >
        <p className="text-xs text-text-secondary leading-relaxed max-w-lg -mt-1 mb-4">
          Optional: save results on the server for inbox hints (30-day
          retention).
        </p>

        <div className="flex flex-wrap gap-2 border-b border-border-dark/60 pb-3">
          {(
            [
              ["digest", "Summary"],
              ["thread_digest", "Thread"],
              ["reply_hint", "Reply coach"],
              ["reply_drafts", "Drafts"],
              ["compare", "Compare"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                tab === k
                  ? "bg-primary text-white shadow-sm shadow-primary/20"
                  : "text-text-secondary hover:text-main hover:bg-white/6"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
            Tone
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as Tone)}
              className="mt-1 w-full rounded-xl border border-border-dark bg-background-dark px-3 py-2 text-sm text-main outline-none focus:ring-2 focus:ring-primary/35"
            >
              <option value="neutral">Neutral</option>
              <option value="concise">Concise</option>
              <option value="formal">Formal</option>
              <option value="friendly">Friendly</option>
            </select>
          </label>
          <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary sm:col-span-2">
            Extra instructions (optional)
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              placeholder='e.g. "Emphasize risks" or "Bullets only"'
              className="mt-1 w-full rounded-xl border border-border-dark bg-background-dark px-3 py-2 text-sm text-main outline-none focus:ring-2 focus:ring-primary/35 resize-y min-h-[3rem]"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary sm:col-span-2 cursor-pointer">
            <input
              type="checkbox"
              checked={persist}
              onChange={(e) => setPersist(e.target.checked)}
              className="size-4 rounded border-border-dark"
            />
            Save AI output on this server (digest hints in inbox; 30-day TTL;
            audit log entry each run)
          </label>
        </div>

        {tab === "compare" ? (
          <div className="mt-3">
            <label className="block text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              Compare with
              <select
                value={compareOtherId}
                onChange={(e) => setCompareOtherId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border-dark bg-background-dark px-3 py-2 text-sm text-main outline-none focus:ring-2 focus:ring-primary/35"
              >
                <option value="">Select a message from this folder…</option>
                {compareCandidates
                  .filter((c) => c.id !== emailId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.subject || "(No subject)").slice(0, 80)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <AiGradientButton
            busy={loading}
            disabled={demoMailbox}
            icon="bolt"
            onClick={() => void run()}
            >
            Generate
          </AiGradientButton>
          {demoMailbox ? (
            <span className="text-xs text-text-secondary">
              Not available for the sample mailbox.
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-300/95 font-semibold">{error}</p>
        ) : null}

        {showDigestPanel && activeDigest ? (
          <div className="mt-5 space-y-5 border-t border-border-dark/60 pt-5">
            {activeDigest.sourceTruncated ? (
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400/90">
                Long text was shortened before analysis
              </p>
            ) : null}
            <p className="text-[15px] leading-relaxed text-main font-medium">
              {activeDigest.summary}
            </p>
            {activeDigest.keyPoints.length > 0 ? (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-2">
                  Key points
                </p>
                <ul className="list-disc pl-5 space-y-2 text-sm text-main/95">
                  {activeDigest.keyPoints.map((p, i) => {
                    const q = quoteForKeyPoint(activeDigest.evidence, i);
                    return (
                      <li key={i} className="leading-snug">
                        <span>{p}</span>
                        {q ? (
                          <span className="mt-1 block border-l-2 border-primary/35 pl-2 text-xs text-text-secondary italic">
                            “{q}”
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {activeDigest.actionItems.length > 0 ? (
              <div>
                <p
                  className={`text-[10px] font-black uppercase tracking-widest mb-2 ${aiGradientTextClass()}`}
                >
                  Action items
                </p>
                <ul className="space-y-2">
                  {activeDigest.actionItems.map((a, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center gap-2 text-sm text-main/95 leading-snug rounded-lg bg-background-dark/40 border border-border-dark/50 px-3 py-2"
                    >
                      <span className="material-symbols-outlined text-primary shrink-0 text-[18px]">
                        check_circle
                      </span>
                      <span className="flex-1 min-w-[12rem]">{a}</span>
                      <button
                        type="button"
                        onClick={() => void createTaskFromLine(a)}
                        className={`cursor-pointer shrink-0 text-[10px] font-black uppercase tracking-wide hover:underline ${aiGradientTextClass()}`}
                      >
                        Add task
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "reply_hint" && replyHint ? (
          <div className="mt-5 space-y-4 border-t border-border-dark/60 pt-5 text-sm">
            {replyHint.sourceTruncated ? (
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400/90">
                Long message was shortened before analysis
              </p>
            ) : null}
            <BlockList title="Open questions" items={replyHint.openQuestions} />
            <BlockList
              title="Missing / unclear"
              items={replyHint.missingInfo}
            />
            <BlockList title="Risks" items={replyHint.risks} />
          </div>
        ) : null}

        {tab === "reply_drafts" && replyDrafts ? (
          <div className="mt-5 space-y-4 border-t border-border-dark/60 pt-5">
            {replyDrafts.sourceTruncated ? (
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400/90">
                Long message was shortened before analysis
              </p>
            ) : null}
            {replyDrafts.drafts.map((d, i) => (
              <div
                key={i}
                className="rounded-xl border border-border-dark/60 bg-background-dark/35 p-3"
              >
                <p className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-2">
                  {d.label}
                </p>
                <pre className="whitespace-pre-wrap text-sm text-main/95 font-sans leading-relaxed">
                  {d.body}
                </pre>
                <button
                  type="button"
                  className="cursor-pointer mt-2 text-[10px] font-black uppercase tracking-wide text-primary hover:underline"
                  onClick={() => {
                    void navigator.clipboard.writeText(d.body).catch(() => {});
                  }}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "compare" && compare ? (
          <div className="mt-5 space-y-4 border-t border-border-dark/60 pt-5 text-sm">
            <p className="text-xs text-text-secondary">
              Newer message:{" "}
              <span className="font-bold text-main">
                {compare.whichIsNewer}
              </span>{" "}
              (A = this email, B = selected)
            </p>
            <p className="text-[15px] leading-relaxed text-main font-medium">
              {compare.summary}
            </p>
            {compare.differences.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1.5 text-main/95">
                {compare.differences.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </AiPanel>
    </section>
  );
}

function BlockList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-widest text-text-secondary mb-2">
        {title}
      </p>
      <ul className="list-disc pl-5 space-y-1 text-main/95">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
