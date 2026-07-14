import type { TranscriptSegment } from "@/types/calls";

/** Stable numeric key from LiveKit transcription segment id (e.g. SG_…). */
export function livekitSegmentSentenceId(segmentId: string): number {
  let h = 0;
  for (let i = 0; i < segmentId.length; i++) {
    h = Math.imul(31, h) + segmentId.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** True when Agora started a new phrase (do not overwrite the previous line). */
export function isNewUtterance(
  last: TranscriptSegment | undefined,
  incoming: TranscriptSegment,
): boolean {
  if (!last) return false;

  const lastSid = last.sentence_id;
  const nextSid = incoming.sentence_id;
  if (
    lastSid != null &&
    nextSid != null &&
    lastSid !== nextSid
  ) {
    return true;
  }

  if (last.is_final) return true;

  const prev = last.text.trim();
  const next = incoming.text.trim();
  if (!prev || !next) return false;

  if (next.length < prev.length * 0.6 && !prev.startsWith(next) && !next.startsWith(prev)) {
    return true;
  }

  if (
    incoming.start_ms > 0 &&
    last.start_ms > 0 &&
    incoming.start_ms - last.start_ms > 4000
  ) {
    return true;
  }

  return false;
}

/** LiveKit agent often sends startTime 0 per utterance — map to call elapsed time. */
export function normalizeLiveSegmentTimes(
  segment: TranscriptSegment,
  existing: TranscriptSegment[],
  callElapsedMs: number,
): TranscriptSegment {
  if (segment.start_ms > 0) {
    return {
      ...segment,
      end_ms:
        segment.end_ms > segment.start_ms ? segment.end_ms : callElapsedMs,
    };
  }

  const sid = segment.sentence_id;
  if (sid != null) {
    const prior = existing.find((s) => s.sentence_id === sid);
    if (prior && prior.start_ms > 0) {
      return {
        ...segment,
        start_ms: prior.start_ms,
        end_ms: Math.max(prior.end_ms, callElapsedMs),
      };
    }
  }

  const last = existing[existing.length - 1];
  if (last && !isNewUtterance(last, segment) && last.start_ms > 0) {
    return {
      ...segment,
      start_ms: last.start_ms,
      end_ms: Math.max(segment.end_ms, callElapsedMs),
    };
  }

  return {
    ...segment,
    start_ms: callElapsedMs,
    end_ms: Math.max(segment.end_ms, callElapsedMs),
  };
}

function finalize(segment: TranscriptSegment): TranscriptSegment {
  return segment.is_final ? segment : { ...segment, is_final: true };
}

/** Merge streaming partials; start a new line when the speaker moves to a new phrase. */
export function upsertTranscriptSegment(
  segments: TranscriptSegment[],
  segment: TranscriptSegment,
): TranscriptSegment[] {
  const last = segments[segments.length - 1];

  if (isNewUtterance(last, segment)) {
    const committed = segments.map((s, i) =>
      i === segments.length - 1 && last && !last.is_final ? finalize(s) : s,
    );
    return [...committed, segment];
  }

  const sid = segment.sentence_id;
  if (sid != null) {
    const idx = segments.findIndex((s) => s.sentence_id === sid);
    if (idx >= 0) {
      const next = [...segments];
      next[idx] = segment;
      return next;
    }
    return [...segments, segment];
  }

  if (
    last &&
    !last.is_final &&
    segment.participant_identity != null &&
    last.participant_identity === segment.participant_identity
  ) {
    const next = [...segments];
    next[next.length - 1] = segment;
    return next;
  }

  return [...segments, segment];
}

export function fullTextFromSegments(
  segments: TranscriptSegment[],
): string | null {
  const lines = segments
    .map((s) => s.text.trim())
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

/** Prefer stored full_text; fall back to joined segment lines. */
export function buildTranscriptText(
  segments: TranscriptSegment[],
  fullText: string | null | undefined,
): string {
  const stored = fullText?.trim();
  if (stored) return stored;
  return fullTextFromSegments(segments) ?? "";
}
