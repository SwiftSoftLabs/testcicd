import bcrypt from 'bcryptjs';
import { query, SCHEMA } from '@/lib/db';
import type { VaultCliToken } from '@/types/vault';
import {
    computeCliTokenLookup,
    generateCliTokenPlaintext,
    getCliTokenPepper,
    isCliTokenFormat,
} from '@/lib/vault/cli-token-lookup';

export { TOKEN_PREFIX } from '@/lib/vault/cli-token-lookup';

const BCRYPT_COST = 10;

export interface GeneratedToken {
    plaintext: string;
    hash: string;
    lookup: string;
}

export function generateCliToken(): GeneratedToken {
    const plaintext = generateCliTokenPlaintext();
    const pepper = getCliTokenPepper();
    return {
        plaintext,
        hash: bcrypt.hashSync(plaintext, BCRYPT_COST),
        lookup: computeCliTokenLookup(plaintext, pepper),
    };
}

type CliTokenRow = VaultCliToken & {
    token_hash: string;
    allowed_environments: string[] | null;
};

export async function verifyCliToken(presented: string): Promise<VaultCliToken | null> {
    if (!isCliTokenFormat(presented)) return null;

    try {
        const pepper = getCliTokenPepper();
        const lookup = computeCliTokenLookup(presented, pepper);

        const result = await query<CliTokenRow>(
            `SELECT id, project_id, workspace_id, user_id, name, scopes, allowed_environments,
                    expires_at, last_used_at, revoked_at, created_at, token_hash
             FROM ${SCHEMA}.vault_cli_tokens
             WHERE token_lookup = $1
               AND revoked_at IS NULL
               AND expires_at > NOW()
             LIMIT 1`,
            [lookup],
        );

        const row = result.rows[0];
        if (!row) return null;

        const match = await bcrypt.compare(presented, row.token_hash);
        if (!match) return null;

        const { token_hash: _hash, ...token } = row;
        return token;
    } catch (err) {
        console.error('[verifyCliToken]', err);
        return null;
    }
}

export async function getProjectCliTokenCount(projectId: string): Promise<number> {
    const result = await query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM ${SCHEMA}.vault_cli_tokens
         WHERE project_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [projectId],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
}
