import { z } from "zod";

import { query, SCHEMA } from "@/lib/db";

import { IntegrationNotFoundError, UpstreamError } from "./errors";
import { adminFetch, giteaJsonOrThrow } from "./gitea-admin";
import { isOneworkVcConfigured } from "./onework";
import { provisionOneworkForMemberIfNeeded } from "./provisioning";
import { fingerprintSha256, normalizePublicKey } from "./ssh-key-utils";
import type { GitSshKey } from "@/types/git";

const giteaKeySchema = z.object({
  id: z.number(),
  title: z.string(),
  key: z.string(),
  created_at: z.string(),
  read_only: z.boolean().optional(),
});

function mapGiteaKey(row: z.infer<typeof giteaKeySchema>): GitSshKey {
  return {
    id: String(row.id),
    provider: "onework",
    title: row.title,
    fingerprint: fingerprintSha256(row.key),
    keyPreview: row.key.split(/\s+/).slice(0, 2).join(" "),
    createdAt: row.created_at,
    readOnly: row.read_only ?? false,
  };
}

async function parseGiteaError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { message?: string };
    message = body.message || message;
  } catch {
    try {
      message = (await res.text()) || message;
    } catch {
      /* ignore */
    }
  }
  throw new UpstreamError(message, res.status);
}

export async function resolveOneworkGiteaUsername(
  workspaceId: string,
  userId: string,
): Promise<string> {
  if (!isOneworkVcConfigured()) {
    throw new IntegrationNotFoundError(
      "OneWork Version Control is not configured for this deployment.",
    );
  }

  let row = await query<{ gitea_username: string }>(
    `SELECT gitea_username FROM ${SCHEMA}.onework_vc_accounts WHERE user_id = $1`,
    [userId],
  );
  if (!row.rows[0]?.gitea_username) {
    const provision = await provisionOneworkForMemberIfNeeded({
      workspaceId,
      userId,
    });
    if (!provision.ok && provision.error !== "not_configured") {
      throw new IntegrationNotFoundError(
        "OneWork Version Control is still being set up for your workspace. Try again shortly.",
      );
    }
    row = await query<{ gitea_username: string }>(
      `SELECT gitea_username FROM ${SCHEMA}.onework_vc_accounts WHERE user_id = $1`,
      [userId],
    );
  }

  const username = row.rows[0]?.gitea_username;
  if (!username) {
    throw new IntegrationNotFoundError(
      "OneWork Version Control account not found. Open Version Control and retry setup.",
    );
  }
  return username;
}

export function getOneworkSshEndpointInfo(): {
  sshHost: string | null;
  sshPort: string | null;
} {
  if (!isOneworkVcConfigured()) {
    return { sshHost: null, sshPort: null };
  }
  const giteaUrl = process.env.ONEWORK_VC_GITEA_URL?.trim();
  const sshHost =
    process.env.ONEWORK_VC_GIT_SSH_HOST?.trim() ||
    (giteaUrl ? new URL(giteaUrl).hostname : null);
  const sshPort = process.env.ONEWORK_VC_GIT_SSH_PORT?.trim() || "2222";
  return { sshHost, sshPort };
}

export async function listOneworkSshKeys(
  giteaUsername: string,
): Promise<GitSshKey[]> {
  const res = await adminFetch(
    `/users/${encodeURIComponent(giteaUsername)}/keys`,
  );
  if (!res.ok) {
    await parseGiteaError(res, "Failed to list OneWork Version Control SSH keys");
  }
  const rows = z.array(giteaKeySchema).parse(await res.json());
  return rows.map(mapGiteaKey);
}

export async function createOneworkSshKey(
  giteaUsername: string,
  title: string,
  publicKeyRaw: string,
): Promise<GitSshKey> {
  const normalized = normalizePublicKey(publicKeyRaw);
  if (!normalized) {
    throw new UpstreamError(
      "Invalid public key. Paste a single-line OpenSSH public key (ssh-ed25519, ssh-rsa, etc.).",
      400,
    );
  }
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new UpstreamError("Key title is required.", 400);
  }

  const res = await adminFetch(
    `/admin/users/${encodeURIComponent(giteaUsername)}/keys`,
    {
      method: "POST",
      body: JSON.stringify({
        title: trimmedTitle,
        key: normalized.canonical,
        read_only: false,
      }),
    },
  );
  if (!res.ok) {
    await parseGiteaError(res, "Failed to add OneWork Version Control SSH key");
  }
  return mapGiteaKey(giteaKeySchema.parse(await res.json()));
}

export async function deleteOneworkSshKey(
  giteaUsername: string,
  keyId: string,
): Promise<void> {
  if (!/^\d+$/.test(keyId)) {
    throw new UpstreamError("Invalid key id.", 400);
  }
  const res = await adminFetch(
    `/admin/users/${encodeURIComponent(giteaUsername)}/keys/${keyId}`,
    { method: "DELETE" },
  );
  if (res.status === 404) return;
  if (!res.ok && res.status !== 204) {
    await parseGiteaError(res, "Failed to delete OneWork Version Control SSH key");
  }
}
