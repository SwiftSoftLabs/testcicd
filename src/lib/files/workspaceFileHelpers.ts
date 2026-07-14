import { createClient } from "@insforge/sdk";
import { query, SCHEMA, buildInsert } from "@/lib/db";
import {
  checkWorkspaceStorage,
  getWorkspaceStorageUsed,
} from "@/lib/files/storageQuota";

export const WORKSPACE_FILES_BUCKET = "workspace-files";

const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
  anonKey: process.env.INSFORGE_API_KEY!,
});

/** Safe segment for storage path and display file names. */
export function sanitizeFileNameSegment(raw: string, maxLen = 80): string {
  const t = raw
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, maxLen);
  return t || "meeting";
}

export async function ensureWorkspaceFolder(
  workspaceId: string,
  parentId: string | null,
  name: string,
  userId: string,
): Promise<string> {
  const trimmed = name.trim();
  const existing = await query<{ id: string }>(
    `SELECT id FROM ${SCHEMA}.workspace_folders
     WHERE workspace_id = $1 AND name = $2
       AND parent_id IS NOT DISTINCT FROM $3::uuid`,
    [workspaceId, trimmed, parentId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const { sql, params } = buildInsert(`${SCHEMA}.workspace_folders`, {
    workspace_id: workspaceId,
    parent_id: parentId,
    name: trimmed,
    created_by: userId,
  });
  const ins = await query<{ id: string }>(sql, params);
  const id = ins.rows[0]?.id;
  if (!id) throw new Error("Failed to create folder");
  return id;
}

export async function removeWorkspaceFileFromStorageAndDb(
  workspaceFileId: string,
): Promise<void> {
  const fileRes = await query<{ storage_path: string }>(
    `SELECT storage_path FROM ${SCHEMA}.workspace_files WHERE id = $1`,
    [workspaceFileId],
  );
  const row = fileRes.rows[0];
  if (!row) return;
  await insforge.storage.from(WORKSPACE_FILES_BUCKET).remove(row.storage_path);
  await query(`DELETE FROM ${SCHEMA}.workspace_files WHERE id = $1`, [
    workspaceFileId,
  ]);
}

export interface CreateMarkdownFileParams {
  workspaceId: string;
  folderId: string;
  uploadedBy: string;
  /** Logical title line in markdown (first # heading). */
  documentTitle: string;
  /** Body under the title (summary text). */
  body: string;
  /** Desired file name including .md */
  fileName: string;
}

/** Creates Meeting-Summary style markdown in workspace-files. */
export async function createWorkspaceMarkdownFile(
  params: CreateMarkdownFileParams,
): Promise<{ id: string; file_name: string }> {
  const content = `# ${params.documentTitle}\n\n${params.body}`;
  const buffer = Buffer.from(content, "utf8");
  const storageCheck = await checkWorkspaceStorage(
    params.workspaceId,
    buffer.length,
  );
  if (!storageCheck.allowed) {
    throw new Error("WORKSPACE_STORAGE_LIMIT");
  }

  const segment = params.folderId;
  const path = `${params.workspaceId}/${segment}/${Date.now()}-${params.fileName}`;
  const blob = new Blob([new Uint8Array(buffer)], { type: "text/markdown" });

  const { data: uploadData, error: storageError } = await insforge.storage
    .from(WORKSPACE_FILES_BUCKET)
    .upload(path, blob);
  if (storageError) throw new Error(storageError.message);
  const storagePath = uploadData!.key;

  try {
    const { sql, params: insertParams } = buildInsert(
      `${SCHEMA}.workspace_files`,
      {
        workspace_id: params.workspaceId,
        folder_id: params.folderId,
        file_name: params.fileName,
        file_size: buffer.length,
        file_type: "text/markdown",
        storage_path: storagePath,
        uploaded_by: params.uploadedBy,
      },
    );
    const insertRes = await query<{ id: string; file_name: string }>(
      sql,
      insertParams,
    );
    const inserted = insertRes.rows[0];
    if (!inserted) {
      await insforge.storage.from(WORKSPACE_FILES_BUCKET).remove(storagePath);
      throw new Error("Database insert failed");
    }
    return inserted;
  } catch (e) {
    await insforge.storage.from(WORKSPACE_FILES_BUCKET).remove(storagePath);
    throw e;
  }
}

export interface UploadVideoWorkspaceFileParams {
  workspaceId: string;
  folderId: string;
  uploadedBy: string;
  displayFileName: string;
  buffer: Buffer;
  contentType: string;
}

export async function uploadVideoToWorkspaceFolder(
  params: UploadVideoWorkspaceFileParams,
): Promise<{ id: string; storage_path: string; file_name: string }> {
  const storageCheck = await checkWorkspaceStorage(
    params.workspaceId,
    params.buffer.length,
  );
  if (!storageCheck.allowed) {
    throw new Error("WORKSPACE_STORAGE_LIMIT");
  }

  const segment = params.folderId;
  const path = `${params.workspaceId}/${segment}/${Date.now()}-${params.displayFileName}`;
  const blob = new Blob([new Uint8Array(params.buffer)], {
    type: params.contentType,
  });

  const { data: uploadData, error: storageError } = await insforge.storage
    .from(WORKSPACE_FILES_BUCKET)
    .upload(path, blob);
  if (storageError) throw new Error(storageError.message);
  const storagePath = uploadData!.key;

  try {
    const { sql, params: insertParams } = buildInsert(
      `${SCHEMA}.workspace_files`,
      {
        workspace_id: params.workspaceId,
        folder_id: params.folderId,
        file_name: params.displayFileName,
        file_size: params.buffer.length,
        file_type: params.contentType,
        storage_path: storagePath,
        uploaded_by: params.uploadedBy,
      },
    );
    const insertRes = await query<{ id: string; storage_path: string; file_name: string }>(
      sql,
      insertParams,
    );
    const inserted = insertRes.rows[0];
    if (!inserted) {
      await insforge.storage.from(WORKSPACE_FILES_BUCKET).remove(storagePath);
      throw new Error("Database insert failed");
    }
    return inserted;
  } catch (e) {
    await insforge.storage.from(WORKSPACE_FILES_BUCKET).remove(storagePath);
    throw e;
  }
}

export async function downloadWorkspaceFileBlob(
  storagePath: string,
): Promise<Blob | null> {
  const { data, error } = await insforge.storage
    .from(WORKSPACE_FILES_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  return data;
}

export { getWorkspaceStorageUsed };
