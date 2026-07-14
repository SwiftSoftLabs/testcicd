import crypto from 'crypto';
import { VaultKeyMismatchError, VaultNotConfiguredError } from '@/lib/vault/vault-errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_BYTES = 32;

function decodeKey(raw: string | undefined, label: string): Buffer {
    if (!raw) {
        if (label === 'VAULT_MASTER_KEY') {
            throw new VaultNotConfiguredError();
        }
        throw new Error(`${label} environment variable is required but not set`);
    }
    const buf = Buffer.from(raw.trim(), 'base64');
    if (buf.length !== KEY_BYTES) {
        if (label === 'VAULT_MASTER_KEY') {
            throw new VaultNotConfiguredError(
                'VAULT_MASTER_KEY must be a base64-encoded 32-byte key',
            );
        }
        throw new Error(
            `${label} must be a base64-encoded 32-byte key (got ${buf.length} bytes)`
        );
    }
    return buf;
}

// VAULT_MASTER_KEY must be a base64-encoded 32-byte key.
// Generate with: openssl rand -base64 32
// Unlike git/email crypto, this key is NOT SHA-256 hashed — it is decoded directly.
export function getVaultMasterKey(): Buffer {
    return decodeKey(process.env.VAULT_MASTER_KEY, 'VAULT_MASTER_KEY');
}

export function getVaultMasterKeyCandidates(): Buffer[] {
    const keys = [getVaultMasterKey()];
    const previous = process.env.VAULT_MASTER_KEY_PREVIOUS?.trim();
    if (previous) {
        keys.push(decodeKey(previous, 'VAULT_MASTER_KEY_PREVIOUS'));
    }
    return keys;
}

export function generateDek(): Buffer {
    return crypto.randomBytes(KEY_BYTES);
}

export function wrapDek(
    dek: Buffer,
    kek: Buffer
): { wrappedDek: string; dekIv: string; dekAuthTag: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, kek, iv);
    const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        wrappedDek: encrypted.toString('base64'),
        dekIv: iv.toString('base64'),
        dekAuthTag: tag.toString('base64'),
    };
}

export function unwrapDek(
    wrapped: { wrappedDek: string; dekIv: string; dekAuthTag: string },
    kek: Buffer
): Buffer {
    const iv = Buffer.from(wrapped.dekIv, 'base64');
    const tag = Buffer.from(wrapped.dekAuthTag, 'base64');
    const data = Buffer.from(wrapped.wrappedDek, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function unwrapDekWithCandidates(
    wrapped: { wrappedDek: string; dekIv: string; dekAuthTag: string },
    keks: Buffer[]
): Buffer {
    let lastError: Error | null = null;
    for (const kek of keks) {
        try {
            return unwrapDek(wrapped, kek);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }
    const detail = lastError ? `: ${lastError.message}` : '';
    throw new VaultKeyMismatchError(
        `Failed to unwrap DEK with provided vault master key candidates${detail}`,
    );
}

export function encryptValue(
    plaintext: string,
    dek: Buffer
): { ciphertext: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        ciphertext: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: tag.toString('base64'),
    };
}

export function decryptValue(
    encrypted: { ciphertext: string; iv: string; authTag: string },
    dek: Buffer
): string {
    const iv = Buffer.from(encrypted.iv, 'base64');
    const tag = Buffer.from(encrypted.authTag, 'base64');
    const data = Buffer.from(encrypted.ciphertext, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
