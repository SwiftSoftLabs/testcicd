import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadEnvConfig } from '@next/env';
import { spawnSync } from 'child_process';

const MIGRATIONS = [
  'migrations/20260611120000_app-onework-task-keys.sql',
  'migrations/20260612120000_app-onework-name-based-project-keys.sql',
] as const;

async function runSqlFile(relativePath: string): Promise<void> {
  const path = resolve(process.cwd(), relativePath);
  if (!existsSync(path)) {
    throw new Error(`Migration file not found: ${relativePath}`);
  }
  loadEnvConfig(process.cwd());
  const { query, SCHEMA } = await import('@/lib/db');
  const sql = readFileSync(path, 'utf8');
  process.stdout.write(`Applying ${relativePath} (schema: ${SCHEMA})\n`);
  await query(sql);
  process.stdout.write(`  ok\n`);
}

function runRekeyScript(): void {
  process.stdout.write('Applying name-based project re-key (scripts/rekey-project-keys.ts)\n');
  const result = spawnSync('npx', ['tsx', 'scripts/rekey-project-keys.ts'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error('rekey-project-keys.ts failed');
  }
}

async function verify(): Promise<void> {
  const { query, SCHEMA } = await import('@/lib/db');
  const sample = await query<{
    name: string;
    key: string | null;
    task_key: string | null;
    title: string;
  }>(
    `SELECT p.name, p.key, t.task_key, t.title
     FROM ${SCHEMA}.projects p
     LEFT JOIN LATERAL (
       SELECT task_key, title FROM ${SCHEMA}.tasks
       WHERE project_id = p.id AND task_key IS NOT NULL
       ORDER BY created_at DESC LIMIT 1
     ) t ON true
     WHERE p.key IS NOT NULL
     ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
     LIMIT 8`,
  );
  process.stdout.write('\nSample project / task keys:\n');
  for (const row of sample.rows) {
    process.stdout.write(
      `  ${row.name}: ${row.key ?? '?'}${row.task_key ? ` (e.g. ${row.task_key})` : ''}\n`,
    );
  }
  const prKeys = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${SCHEMA}.projects
     WHERE key ~ '^PR[0-9]+$' OR key = 'PR'`,
  );
  const remaining = prKeys.rows[0]?.count ?? '0';
  process.stdout.write(`\nLegacy PR## project keys remaining: ${remaining}\n`);
}

async function main() {
  loadEnvConfig(process.cwd());

  for (const file of MIGRATIONS) {
    await runSqlFile(file);
  }

  runRekeyScript();
  await verify();
  process.stdout.write('\nTask key migrations complete.\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`apply-task-key-migrations failed: ${message}\n`);
  process.exit(1);
});
