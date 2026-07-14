import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const ivLength = 12;

function getEncryptionKey(): Buffer {
    const raw = process.env.GIT_INTEGRATION_TOKEN_KEY?.trim();
    if (!raw) {
        throw new Error('GIT_INTEGRATION_TOKEN_KEY is required for Vercel integration token encryption');
    }
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

export function encryptVercelToken(value: string): string {
    const iv = crypto.randomBytes(ivLength);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`;
}

export function decryptVercelToken(payload: string): string {
    const [ivHex, tagHex, dataHex] = payload.split('.');
    if (!ivHex || !tagHex || !dataHex) {
        throw new Error('Invalid encrypted Vercel token payload');
    }
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
