// Pure function — no Node.js-only APIs. Safe to import in 'use client' components.

export interface ParsedEnvVar {
    name: string;
    value: string;
    lineNumber: number;
}

export interface InvalidLine {
    line: string;
    lineNumber: number;
    reason: string;
}

export interface ParseDotenvResult {
    valid: ParsedEnvVar[];
    invalid: InvalidLine[];
}

import {
    isValidVaultVariableName,
    normalizeVaultVariableName,
    VAULT_VARIABLE_NAME_HINT,
} from '@/lib/vault/variable-names';

export function parseDotenv(text: string): ParseDotenvResult {
    const valid: ParsedEnvVar[] = [];
    const invalid: InvalidLine[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        const raw = lines[i];
        const trimmed = raw.trim();

        if (trimmed === '' || trimmed.startsWith('#')) continue;

        const eqIdx = raw.indexOf('=');
        if (eqIdx === -1) {
            invalid.push({ line: raw, lineNumber, reason: 'Missing = separator' });
            continue;
        }

        const rawName = raw.slice(0, eqIdx).trim();
        const name = normalizeVaultVariableName(rawName);
        let value = raw.slice(eqIdx + 1);

        // Strip surrounding quotes (single or double, must match)
        const quoteMatch = value.match(/^(['"])([\s\S]*)\1$/);
        if (quoteMatch) {
            value = quoteMatch[2];
        }

        if (!isValidVaultVariableName(name)) {
            invalid.push({
                line: raw,
                lineNumber,
                reason: `Invalid variable name "${rawName}" — ${VAULT_VARIABLE_NAME_HINT}`,
            });
            continue;
        }

        valid.push({ name, value, lineNumber });
    }

    // Deduplicate by name (last occurrence wins, matching standard .env behavior)
    const seen = new Map<string, ParsedEnvVar>();
    for (const entry of valid) {
        seen.set(entry.name, entry);
    }

    return { valid: Array.from(seen.values()), invalid };
}

export function getDotenvPreviewNames(result: ParseDotenvResult): string[] {
    return result.valid.map((v) => v.name);
}
