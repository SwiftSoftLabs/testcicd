import { createHash } from 'crypto';

const ALLOWED_KEY_TYPES = new Set([
    'ssh-rsa',
    'ssh-dss',
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'sk-ssh-ed25519@openssh.com',
    'sk-ecdsa-sha2-nistp256@openssh.com',
]);

/** Normalize and validate an OpenSSH public key line. */
export function normalizePublicKey(raw: string): { canonical: string; type: string } | null {
    const line = raw
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('#'));
    if (!line) return null;

    const parts = line.split(/\s+/);
    if (parts.length < 2) return null;

    const type = parts[0];
    const isAllowed =
        ALLOWED_KEY_TYPES.has(type) ||
        type.startsWith('ecdsa-sha2-nistp') ||
        type.startsWith('sk-');
    if (!isAllowed) return null;

    const keyData = parts[1];
    if (!/^[A-Za-z0-9+/]+=*$/.test(keyData) || keyData.length < 32) return null;

    const comment = parts.length > 2 ? parts.slice(2).join(' ') : '';
    const canonical = comment ? `${type} ${keyData} ${comment}` : `${type} ${keyData}`;
    return { canonical, type };
}

export function fingerprintSha256(publicKeyLine: string): string {
    const parts = publicKeyLine.trim().split(/\s+/);
    if (parts.length < 2) return 'SHA256:unknown';
    const blob = Buffer.from(parts[1], 'base64');
    const hash = createHash('sha256').update(blob).digest('base64');
    return `SHA256:${hash.replace(/=+$/, '')}`;
}
