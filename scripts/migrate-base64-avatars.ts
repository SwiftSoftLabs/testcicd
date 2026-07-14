import { loadEnvConfig } from '@next/env';

/**
 * One-off migration: move base64 data-URI avatars out of profiles.avatar_url
 * into the public `app_onework-avatars` storage bucket, replacing the column
 * value with a CDN URL. Base64 avatars (up to 2.28 MB each) were being inlined
 * into every message/member/conversation query response, causing 20 MB payloads
 * and InsForge gateway timeouts (500s).
 */

const BUCKET = 'app_onework-avatars';

const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/s;

const EXT_BY_MIME: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
};

async function main() {
    loadEnvConfig(process.cwd());
    const { query, SCHEMA } = await import('@/lib/db');
    const { createClient } = await import('@insforge/sdk');

    const apply = process.argv.includes('--apply');
    const mode = apply ? 'APPLY' : 'DRY-RUN';

    const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL!.replace(/\/$/, '');
    const insforge = createClient({
        baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL!,
        anonKey: process.env.INSFORGE_API_KEY!,
    });

    const res = await query<{ id: string; avatar_url: string }>(
        `SELECT id, avatar_url FROM ${SCHEMA}.profiles WHERE avatar_url LIKE 'data:%'`,
    );

    process.stdout.write(`[${mode}] Found ${res.rows.length} base64 avatar(s) to migrate.\n`);
    if (!apply) {
        process.stdout.write(`(No uploads or DB writes will happen. Re-run with --apply to migrate.)\n`);
    }

    let migrated = 0;
    let failed = 0;

    for (const row of res.rows) {
        const match = DATA_URI_RE.exec(row.avatar_url);
        if (!match) {
            process.stderr.write(`- ${row.id}: not a base64 data URI, skipping\n`);
            failed++;
            continue;
        }
        const mime = match[1].toLowerCase();
        const base64 = match[2];
        const ext = EXT_BY_MIME[mime] ?? 'png';
        const buffer = Buffer.from(base64, 'base64');
        const path = `${row.id}-${Date.now()}.${ext}`;
        const url = `${baseUrl}/api/storage/buckets/${BUCKET}/objects/${path}`;

        if (!apply) {
            process.stdout.write(`- ${row.id}: ${(buffer.length / 1024).toFixed(0)} kB ${mime} -> would upload to ${url}\n`);
            migrated++;
            continue;
        }

        const file = new File([buffer], path, { type: mime });
        const { error: uploadError } = await insforge.storage.from(BUCKET).upload(path, file);
        if (uploadError) {
            process.stderr.write(`- ${row.id}: upload failed: ${(uploadError as Error).message}\n`);
            failed++;
            continue;
        }

        await query(`UPDATE ${SCHEMA}.profiles SET avatar_url = $1 WHERE id = $2`, [url, row.id]);
        process.stdout.write(`- ${row.id}: ${(buffer.length / 1024).toFixed(0)} kB -> ${url}\n`);
        migrated++;
    }

    process.stdout.write(`\n[${mode}] Complete. ${apply ? 'Migrated' : 'Would migrate'}: ${migrated}, Failed: ${failed}\n`);
    if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Avatar migration failed: ${message}\n`);
    process.exit(1);
});
