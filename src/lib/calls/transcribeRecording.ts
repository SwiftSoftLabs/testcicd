import { query, SCHEMA } from "@/lib/db";
import { recordingMimeFromKey } from "@/lib/calls/localRecording";
import { downloadCallRecordingBlob } from "@/lib/calls/storage";
import {
  MEETING_TRANSCRIPTION_PROMPT,
  transcribeWithWhisperLargeV3,
} from "@/lib/ai/transcribeAudio";

export const TRANSCRIPT_PLACEHOLDER =
  "Transcript will be available when recording processing completes.";

/** Transcribe uploaded call recording via Whisper Large V3 (InsForge Model Gateway). */
export async function transcribeCallRecording(
  callId: string,
): Promise<boolean> {
  const recRes = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM ${SCHEMA}.call_recordings cr
       WHERE cr.call_session_id = $1
         AND cr.status = 'uploaded'
         AND (cr.workspace_file_id IS NOT NULL OR cr.storage_key IS NOT NULL)
     ) AS exists`,
    [callId],
  );
  if (!recRes.rows[0]?.exists) return false;

  const { blob, pathForMime } = await downloadCallRecordingBlob(callId);
  if (!blob || blob.size === 0) return false;

  const buffer = Buffer.from(await blob.arrayBuffer());
  const mimeType = recordingMimeFromKey(pathForMime, blob.type);

  let transcriptText = "";
  try {
    transcriptText = await transcribeWithWhisperLargeV3({
      buffer,
      mimeType,
      language: "en",
      prompt: MEETING_TRANSCRIPTION_PROMPT,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[transcribeCallRecording] Whisper failed:", message);
    await query(
      `UPDATE ${SCHEMA}.call_transcripts
       SET status = 'failed', updated_at = NOW()
       WHERE call_session_id = $1`,
      [callId],
    );
    return false;
  }

  if (!transcriptText) return false;

  const existing = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.call_transcripts WHERE call_session_id = $1 LIMIT 1`,
    [callId],
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE ${SCHEMA}.call_transcripts
       SET full_text = $2, status = 'ready', updated_at = NOW()
       WHERE call_session_id = $1`,
      [callId, transcriptText],
    );
  } else {
    await query(
      `INSERT INTO ${SCHEMA}.call_transcripts (call_session_id, full_text, status)
       VALUES ($1, $2, 'ready')`,
      [callId, transcriptText],
    );
  }
  return true;
}
