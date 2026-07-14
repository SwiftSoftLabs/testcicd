import { query, SCHEMA } from '@/lib/db';
import { getProjectWorkspaceId } from '@/lib/rbac/project-access';
import {
    generateDek,
    wrapDek,
    getVaultMasterKey,
    getVaultMasterKeyCandidates,
    unwrapDekWithCandidates,
} from './crypto';
import type { VaultProjectKeyRow } from '@/types/vault';

// In-process DEK cache — keyed by projectId. DEKs are immutable in P1
// (key rotation is a P2 feature), so caching indefinitely is safe.
const dekCache = new Map<string, Buffer>();

async function getProjectKeyRow(projectId: string): Promise<VaultProjectKeyRow | null> {
    const result = await query<VaultProjectKeyRow>(
        `SELECT id, project_id, workspace_id, wrapped_dek, dek_iv, dek_auth_tag,
                algorithm, key_version, created_at, updated_at
         FROM ${SCHEMA}.vault_project_keys
         WHERE project_id = $1
         LIMIT 1`,
        [projectId]
    );
    return result.rows[0] ?? null;
}

function dekFromRow(row: VaultProjectKeyRow): Buffer {
    return unwrapDekWithCandidates(
        { wrappedDek: row.wrapped_dek, dekIv: row.dek_iv, dekAuthTag: row.dek_auth_tag },
        getVaultMasterKeyCandidates()
    );
}

export interface VaultKekRotationFailure {
    id: string;
    error: string;
}

export interface VaultKekRotationResult {
    total: number;
    rewrapped: number;
    failed: number;
    failures: VaultKekRotationFailure[];
}

// Returns the plaintext DEK for a project that has already been initialized.
// Throws if the project has no vault key yet — callers that may encounter
// uninitialized projects should call ensureProjectVaultInitialized first.
export async function getProjectDek(projectId: string): Promise<Buffer> {
    const cached = dekCache.get(projectId);
    if (cached) return cached;

    const row = await getProjectKeyRow(projectId);
    if (!row) {
        throw new Error(`Vault not initialized for project ${projectId}`);
    }
    const dek = dekFromRow(row);
    dekCache.set(projectId, dek);
    return dek;
}

// Idempotent: creates the project DEK row and seeds the three system environments
// (development, preview, production) in a single CTE if they don't exist yet.
// Safe to call on every GET /api/vault/summary request.
export async function ensureProjectVaultInitialized(
    projectId: string,
    actorId: string
): Promise<Buffer> {
    const workspaceId = await getProjectWorkspaceId(projectId);
    if (!workspaceId) {
        throw new Error(`Project ${projectId} not found`);
    }

    const kek = getVaultMasterKey();
    const dek = generateDek();
    const { wrappedDek, dekIv, dekAuthTag } = wrapDek(dek, kek);

    // Single CTE: insert key (ON CONFLICT DO NOTHING) + seed system environments
    // if none exist yet. Returns whichever key row is current after the operation.
    const result = await query<VaultProjectKeyRow>(
        `WITH inserted_key AS (
            INSERT INTO ${SCHEMA}.vault_project_keys
                (project_id, workspace_id, wrapped_dek, dek_iv, dek_auth_tag, algorithm, key_version)
            VALUES ($1, $2, $3, $4, $5, 'aes-256-gcm', 1)
            ON CONFLICT (project_id) DO NOTHING
            RETURNING *
         ),
         seeded_envs AS (
            INSERT INTO ${SCHEMA}.vault_environments
                (project_id, workspace_id, name, is_system, created_by)
            SELECT $1, $2, v, true, $6
            FROM (VALUES ('development'), ('preview'), ('production')) AS t(v)
            WHERE NOT EXISTS (
                SELECT 1 FROM ${SCHEMA}.vault_environments
                WHERE project_id = $1 AND is_system = true
            )
            ON CONFLICT (project_id, name) DO NOTHING
         ),
         existing_key AS (
            SELECT * FROM ${SCHEMA}.vault_project_keys WHERE project_id = $1
         )
         SELECT * FROM inserted_key
         UNION ALL
         SELECT * FROM existing_key WHERE NOT EXISTS (SELECT 1 FROM inserted_key)`,
        [projectId, workspaceId, wrappedDek, dekIv, dekAuthTag, actorId]
    );

    const row = result.rows[0];
    if (!row) {
        throw new Error('Failed to initialize vault key for project');
    }

    // If the key was already there, decrypt the existing DEK (not the one we just generated)
    const resolvedDek = dekFromRow(row);
    dekCache.set(projectId, resolvedDek);
    return resolvedDek;
}

export async function rewrapAllProjectDeks(): Promise<VaultKekRotationResult> {
    const currentKek = getVaultMasterKey();
    const candidateKeks = getVaultMasterKeyCandidates();
    const rows = await query<Pick<VaultProjectKeyRow, 'id' | 'wrapped_dek' | 'dek_iv' | 'dek_auth_tag'>>(
        `SELECT id, wrapped_dek, dek_iv, dek_auth_tag
         FROM ${SCHEMA}.vault_project_keys
         ORDER BY created_at ASC`,
    );

    const result: VaultKekRotationResult = {
        total: rows.rowCount,
        rewrapped: 0,
        failed: 0,
        failures: [],
    };

    for (const row of rows.rows) {
        try {
            const dek = unwrapDekWithCandidates(
                {
                    wrappedDek: row.wrapped_dek,
                    dekIv: row.dek_iv,
                    dekAuthTag: row.dek_auth_tag,
                },
                candidateKeks
            );
            const { wrappedDek, dekIv, dekAuthTag } = wrapDek(dek, currentKek);
            await query(
                `UPDATE ${SCHEMA}.vault_project_keys
                 SET wrapped_dek = $2,
                     dek_iv = $3,
                     dek_auth_tag = $4,
                     updated_at = NOW()
                 WHERE id = $1`,
                [row.id, wrappedDek, dekIv, dekAuthTag]
            );
            result.rewrapped++;
        } catch (error) {
            result.failed++;
            result.failures.push({
                id: row.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return result;
}
