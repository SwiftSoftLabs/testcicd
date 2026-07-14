import { query, SCHEMA } from "@/lib/db";
import { deleteRecordingFromStorage } from "@/lib/calls/storage";
import { removeWorkspaceFileFromStorageAndDb } from "@/lib/files/workspaceFileHelpers";

/** Removes stored media for one `call_recordings` row (Files module + legacy bucket). */
export async function purgeCallRecordingStorage(
  workspaceFileId: string | null,
  storageKey: string | null,
): Promise<void> {
  if (workspaceFileId) {
    try {
      await removeWorkspaceFileFromStorageAndDb(workspaceFileId);
    } catch {
      /* best effort */
    }
  }
  if (storageKey) {
    try {
      await deleteRecordingFromStorage(storageKey);
    } catch {
      /* best effort */
    }
  }
}

export async function deleteCallRecordingRow(recordingId: string): Promise<void> {
  await query(`DELETE FROM ${SCHEMA}.call_recordings WHERE id = $1`, [
    recordingId,
  ]);
}
