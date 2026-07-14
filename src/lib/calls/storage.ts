import { createClient } from "@insforge/sdk";
import { CALL_RECORDINGS_BUCKET } from "@/lib/calls/constants";
import { query, SCHEMA } from "@/lib/db";
import { downloadWorkspaceFileBlob } from "@/lib/files/workspaceFileHelpers";

const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
  anonKey: process.env.INSFORGE_API_KEY!,
});

export function recordingStoragePath(
  workspaceId: string,
  callId: string,
  fileName = "recording.mp4",
): string {
  return `${workspaceId}/${callId}/${fileName}`;
}

/** Legacy: recordings stored only in `call-recordings` bucket. */
export async function uploadRecordingBuffer(
  path: string,
  data: Buffer,
  contentType = "video/mp4",
): Promise<string> {
  const blob = new Blob([new Uint8Array(data)], { type: contentType });
  const { data: uploadData, error } = await insforge.storage
    .from(CALL_RECORDINGS_BUCKET)
    .upload(path, blob);
  if (error) throw new Error(error.message);
  return uploadData!.key;
}

export async function downloadRecording(
  storageKey: string,
): Promise<Blob | null> {
  const { data, error } = await insforge.storage
    .from(CALL_RECORDINGS_BUCKET)
    .download(storageKey);
  if (error || !data) return null;
  return data;
}

/**
 * Download the latest recording for a call — prefers Files-module
 * (`workspace_files` via `workspace_file_id`), else legacy `storage_key` in
 * `call-recordings`.
 */
export async function downloadCallRecordingBlob(
  callSessionId: string,
): Promise<{
  blob: Blob | null;
  pathForMime: string;
  storedFileType: string | null;
}> {
  const rec = await query<{
    storage_key: string | null;
    wf_path: string | null;
    wf_file_type: string | null;
  }>(
    `SELECT cr.storage_key, wf.storage_path AS wf_path, wf.file_type AS wf_file_type
     FROM ${SCHEMA}.call_recordings cr
     LEFT JOIN ${SCHEMA}.workspace_files wf ON wf.id = cr.workspace_file_id
     WHERE cr.call_session_id = $1
     ORDER BY cr.created_at DESC LIMIT 1`,
    [callSessionId],
  );
  const row = rec.rows[0];
  if (!row) return { blob: null, pathForMime: "", storedFileType: null };
  if (row.wf_path) {
    const blob = await downloadWorkspaceFileBlob(row.wf_path);
    return {
      blob,
      pathForMime: row.wf_path,
      storedFileType: row.wf_file_type,
    };
  }
  if (row.storage_key) {
    const blob = await downloadRecording(row.storage_key);
    return {
      blob,
      pathForMime: row.storage_key,
      storedFileType: null,
    };
  }
  return { blob: null, pathForMime: "", storedFileType: null };
}

export async function deleteRecordingFromStorage(
  storageKey: string,
): Promise<void> {
  const { error } = await insforge.storage
    .from(CALL_RECORDINGS_BUCKET)
    .remove(storageKey);
  if (error) throw new Error(error.message);
}
