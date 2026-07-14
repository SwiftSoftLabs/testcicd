import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadEnvConfig } from '@next/env';

/**
 * Apply a .sql file as a single batch (supports DO $$ blocks).
 * Usage: npx tsx scripts/run-migration-once.ts <path-to-file.sql>
 */
async function main() {
    const fileArg = process.argv[2];
    if (!fileArg) {
        process.stderr.write('Usage: npx tsx scripts/run-migration-once.ts <path-to-file.sql>\n');
        process.exit(1);
    }

    loadEnvConfig(process.cwd());
    const { query, SCHEMA } = await import('@/lib/db');

    const path = resolve(process.cwd(), fileArg);
    const sql = readFileSync(path, 'utf8');

    process.stdout.write(`Applying migration from ${fileArg} (schema: ${SCHEMA})\n`);
    await query(sql);
    process.stdout.write('Migration complete.\n');
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Migration failed: ${message}\n`);
    process.exit(1);
});
