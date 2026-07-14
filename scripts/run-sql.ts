import { readFileSync } from 'fs';
import { resolve } from 'path';
import { loadEnvConfig } from '@next/env';

/**
 * Apply a .sql file against the InsForge cluster via the same rawsql bridge the app uses.
 * Usage: npx tsx scripts/run-sql.ts <path-to-file.sql>
 * Statements are split on top-level semicolons and run in order.
 */
async function main() {
    const fileArg = process.argv[2];
    if (!fileArg) {
        process.stderr.write('Usage: npx tsx scripts/run-sql.ts <path-to-file.sql>\n');
        process.exit(1);
    }

    // Load app env before importing lib/db.ts (it reads env at import time).
    loadEnvConfig(process.cwd());
    const { query, SCHEMA } = await import('@/lib/db');

    const path = resolve(process.cwd(), fileArg);
    const raw = readFileSync(path, 'utf8');

    const statements = raw
        // Naive split: breaks on ';' inside string literals or DO $$ blocks. Fine for plain DDL.
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.split('\n').every((line) => line.trim().startsWith('--') || line.trim() === ''));

    process.stdout.write(`Applying ${statements.length} statement(s) from ${fileArg} (schema: ${SCHEMA})\n`);

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]!;
        const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
        try {
            await query(stmt);
            process.stdout.write(`  [${i + 1}/${statements.length}] ok  — ${preview}\n`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`  [${i + 1}/${statements.length}] FAILED — ${preview}\n    ${message}\n`);
            process.exit(1);
        }
    }

    process.stdout.write('Migration complete.\n');
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`run-sql failed: ${message}\n`);
    process.exit(1);
});
