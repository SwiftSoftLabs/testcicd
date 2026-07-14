/**
 * Read-only audit: live InsForge schema vs SETUP_DATABASE.sql + migration SQL files.
 *
 * Usage:
 *   npm run audit-db-vs-setup
 *   npm run audit-db-vs-setup -- --json --out scripts/artifacts/db-audit.json
 *   npm run audit-db-vs-setup -- --fail-on-drift
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { loadEnvConfig } from '@next/env';

const SCHEMA = process.env.NEXT_PUBLIC_DB_SCHEMA || 'app_onework';

interface ColumnRow {
  table_name: string;
  column_name: string;
}

interface IndexRow {
  tablename: string;
  indexname: string;
}

interface LiveSchema {
  tables: string[];
  columns: Map<string, Set<string>>;
  indexes: IndexRow[];
  publicViews: string[];
  functions: { schema: string; name: string }[];
}

interface SqlArtifact {
  tables: Set<string>;
  columns: Map<string, Set<string>>;
}

interface MigrationSource {
  path: string;
  label: string;
}

interface AuditReport {
  generatedAt: string;
  schema: string;
  summary: {
    liveTableCount: number;
    setupTableCount: number;
    tablesInLiveNotSetup: number;
    tablesInSetupNotLive: number;
    columnGapsOnSharedTables: number;
    migrationFilesScanned: number;
    migrationFilesWithGaps: number;
  };
  taskKeys: {
    projectsKey: boolean;
    tasksTaskKey: boolean;
    taskKeyAliases: boolean;
    projectTaskCounters: boolean;
    workspaceTaskCounters: boolean;
    indexes: string[];
    legacyPrKeys: number;
  };
  tablesInLiveNotSetup: string[];
  tablesInSetupNotLive: string[];
  columnGaps: Array<{ table: string; column: string }>;
  migrationGaps: Array<{
    file: string;
    missingTables: string[];
    missingColumns: Array<{ table: string; column: string }>;
  }>;
  publicViewsInLive: string[];
}

const MIGRATION_GLOBS: Array<{ dir: string; pattern: RegExp }> = [
  { dir: 'migrations', pattern: /onework/i },
  { dir: 'sql', pattern: /\.sql$/i },
  { dir: 'scripts/migrations', pattern: /\.sql$/i },
];

function readSqlFile(relativePath: string): string {
  const path = resolve(process.cwd(), relativePath);
  return readFileSync(path, 'utf8');
}

function normalizeIdent(value: string): string {
  return value.replace(/"/g, '').trim().toLowerCase();
}

/** Best-effort SQL artifact extraction for app_onework (and public views). */
function parseSqlArtifacts(sql: string): SqlArtifact {
  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();

  const addColumn = (table: string, column: string) => {
    const t = normalizeIdent(table);
    const c = normalizeIdent(column);
    if (!t || !c || c === 'if' || c === 'constraint') return;
    tables.add(t);
    const set = columns.get(t) ?? new Set<string>();
    set.add(c);
    columns.set(t, set);
  };

  const createTableRe =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:app_onework|public)\.("?[\w]+"?)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = createTableRe.exec(sql)) !== null) {
    const table = normalizeIdent(match[1]);
    tables.add(table);

    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    const body = sql.slice(start, i - 1);
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('constraint')) continue;
      const colMatch = /^"?([\w]+)"?\s+/i.exec(trimmed);
      if (colMatch) addColumn(table, colMatch[1]);
    }
  }

  const alterRe =
    /alter\s+table\s+(?:only\s+)?(?:app_onework|public)\.("?[\w]+"?)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?("?[\w]+"?)/gi;
  while ((match = alterRe.exec(sql)) !== null) {
    addColumn(match[1], match[2]);
  }

  return { tables, columns };
}

function listMigrationSources(): MigrationSource[] {
  const out: MigrationSource[] = [
    { path: 'SETUP_DATABASE.sql', label: 'SETUP_DATABASE.sql' },
  ];

  for (const { dir, pattern } of MIGRATION_GLOBS) {
    const abs = resolve(process.cwd(), dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) {
      if (!pattern.test(name)) continue;
      out.push({ path: `${dir}/${name}`, label: basename(name) });
    }
  }

  return out;
}

async function fetchLiveSchema(): Promise<LiveSchema> {
  const { query } = await import('@/lib/db');

  const [tableRes, colRes, idxRes, viewRes, fnApp, fnPublic] = await Promise.all([
    query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [SCHEMA],
    ),
    query<ColumnRow>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = $1
       ORDER BY table_name, ordinal_position`,
      [SCHEMA],
    ),
    query<IndexRow>(
      `SELECT tablename, indexname FROM pg_indexes
       WHERE schemaname = $1
       ORDER BY tablename, indexname`,
      [SCHEMA],
    ),
    query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views
       WHERE table_schema = 'public' AND table_name LIKE 'onework_%'
       ORDER BY table_name`,
    ),
    query<{ routine_name: string }>(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = $1
       ORDER BY routine_name`,
      [SCHEMA],
    ),
    query<{ routine_name: string }>(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = 'public' AND routine_name LIKE '%onework%'
       ORDER BY routine_name`,
    ),
  ]);

  const columns = new Map<string, Set<string>>();
  for (const row of colRes.rows) {
    const t = normalizeIdent(row.table_name);
    const set = columns.get(t) ?? new Set<string>();
    set.add(normalizeIdent(row.column_name));
    columns.set(t, set);
  }

  return {
    tables: tableRes.rows.map((r) => normalizeIdent(r.table_name)),
    columns,
    indexes: idxRes.rows,
    publicViews: viewRes.rows.map((r) => r.table_name),
    functions: [
      ...fnApp.rows.map((r) => ({ schema: SCHEMA, name: r.routine_name })),
      ...fnPublic.rows.map((r) => ({ schema: 'public', name: r.routine_name })),
    ],
  };
}

function diffColumns(
  live: Set<string> | undefined,
  setup: Set<string> | undefined,
): string[] {
  if (!live) return [];
  const setupCols = setup ?? new Set<string>();
  return [...live].filter((c) => !setupCols.has(c)).sort();
}

function compareMigrationFile(
  relativePath: string,
  live: LiveSchema,
): { missingTables: string[]; missingColumns: Array<{ table: string; column: string }> } {
  const sql = readSqlFile(relativePath);
  const artifact = parseSqlArtifacts(sql);

  const missingTables = [...artifact.tables].filter((t) => !live.tables.includes(t)).sort();
  const missingColumns: Array<{ table: string; column: string }> = [];

  for (const [table, cols] of artifact.columns) {
    const liveCols = live.columns.get(table);
    if (!liveCols) continue;
    for (const col of cols) {
      if (!liveCols.has(col)) {
        missingColumns.push({ table, column: col });
      }
    }
  }

  missingColumns.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  return { missingTables, missingColumns };
}

async function fetchTaskKeyStatus(): Promise<AuditReport['taskKeys']> {
  const { query } = await import('@/lib/db');

  const has = (table: string) =>
    query<{ ok: number }>(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2 LIMIT 1`,
      [SCHEMA, table],
    ).then((r) => r.rows.length > 0);

  const hasCol = (table: string, column: string) =>
    query<{ ok: number }>(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = $3 LIMIT 1`,
      [SCHEMA, table, column],
    ).then((r) => r.rows.length > 0);

  const [projectsKey, tasksTaskKey, taskKeyAliases, projectTaskCounters, workspaceTaskCounters, legacy, indexes] =
    await Promise.all([
      hasCol('projects', 'key'),
      hasCol('tasks', 'task_key'),
      has('task_key_aliases'),
      has('project_task_counters'),
      has('workspace_task_counters'),
      query<{ cnt: number }>(
        `SELECT COUNT(*)::int AS cnt FROM ${SCHEMA}.projects WHERE key ~ '^PR[0-9]+$'`,
      ),
      query<IndexRow>(
        `SELECT tablename, indexname FROM pg_indexes
         WHERE schemaname = $1
           AND (indexname LIKE '%task_key%' OR indexname LIKE '%workspace_key%')
         ORDER BY tablename, indexname`,
        [SCHEMA],
      ),
    ]);

  return {
    projectsKey,
    tasksTaskKey,
    taskKeyAliases,
    projectTaskCounters,
    workspaceTaskCounters,
    indexes: indexes.rows.map((r) => `${r.tablename}.${r.indexname}`),
    legacyPrKeys: legacy.rows[0]?.cnt ?? 0,
  };
}

function buildReport(live: LiveSchema, setup: SqlArtifact, sources: MigrationSource[]): AuditReport {
  const setupTables = [...setup.tables].sort();
  const liveTables = [...live.tables].sort();

  const tablesInLiveNotSetup = liveTables.filter((t) => !setup.tables.has(t));
  const tablesInSetupNotLive = setupTables.filter((t) => !live.tables.includes(t));

  const columnGaps: Array<{ table: string; column: string }> = [];
  for (const table of liveTables) {
    if (!setup.tables.has(table)) continue;
    for (const col of diffColumns(live.columns.get(table), setup.columns.get(table))) {
      columnGaps.push({ table, column: col });
    }
  }

  const migrationGaps = sources
    .filter((s) => s.path !== 'SETUP_DATABASE.sql')
    .map((source) => {
      const { missingTables, missingColumns } = compareMigrationFile(source.path, live);
      return {
        file: source.path,
        missingTables,
        missingColumns,
      };
    })
    .filter((g) => g.missingTables.length > 0 || g.missingColumns.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    schema: SCHEMA,
    summary: {
      liveTableCount: liveTables.length,
      setupTableCount: setupTables.length,
      tablesInLiveNotSetup: tablesInLiveNotSetup.length,
      tablesInSetupNotLive: tablesInSetupNotLive.length,
      columnGapsOnSharedTables: columnGaps.length,
      migrationFilesScanned: sources.length - 1,
      migrationFilesWithGaps: migrationGaps.length,
    },
    taskKeys: {
      projectsKey: false,
      tasksTaskKey: false,
      taskKeyAliases: false,
      projectTaskCounters: false,
      workspaceTaskCounters: false,
      indexes: [],
      legacyPrKeys: 0,
    },
    tablesInLiveNotSetup,
    tablesInSetupNotLive,
    columnGaps,
    migrationGaps,
    publicViewsInLive: live.publicViews,
  };
}

function formatMarkdown(report: AuditReport): string {
  const lines: string[] = [
    '# Database vs SETUP_DATABASE audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Schema: \`${report.schema}\``,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|------:|`,
    `| Live tables | ${report.summary.liveTableCount} |`,
    `| SETUP tables (parsed) | ${report.summary.setupTableCount} |`,
    `| In live, not in SETUP | ${report.summary.tablesInLiveNotSetup} |`,
    `| In SETUP, not in live | ${report.summary.tablesInSetupNotLive} |`,
    `| Column gaps (shared tables) | ${report.summary.columnGapsOnSharedTables} |`,
    `| Migration files with gaps | ${report.summary.migrationFilesWithGaps} / ${report.summary.migrationFilesScanned} |`,
    '',
    '## Task keys (live DB)',
    '',
    `| Check | Status |`,
    `|-------|--------|`,
    `| projects.key | ${report.taskKeys.projectsKey ? 'yes' : 'no'} |`,
    `| tasks.task_key | ${report.taskKeys.tasksTaskKey ? 'yes' : 'no'} |`,
    `| task_key_aliases table | ${report.taskKeys.taskKeyAliases ? 'yes' : 'no'} |`,
    `| project_task_counters table | ${report.taskKeys.projectTaskCounters ? 'yes' : 'no'} |`,
    `| workspace_task_counters table | ${report.taskKeys.workspaceTaskCounters ? 'yes' : 'no'} |`,
    `| Legacy PR## keys | ${report.taskKeys.legacyPrKeys} |`,
    '',
  ];

  if (report.taskKeys.indexes.length > 0) {
    lines.push('Indexes:', ...report.taskKeys.indexes.map((i) => `- ${i}`), '');
  }

  lines.push(
    `## Tables in live DB missing from SETUP_DATABASE (${report.tablesInLiveNotSetup.length})`,
    '',
  );
  for (const t of report.tablesInLiveNotSetup) lines.push(`- ${t}`);
  lines.push('');

  if (report.tablesInSetupNotLive.length > 0) {
    lines.push(
      `## Tables in SETUP_DATABASE missing from live DB (${report.tablesInSetupNotLive.length})`,
      '',
    );
    for (const t of report.tablesInSetupNotLive) lines.push(`- ${t}`);
    lines.push('');
  }

  if (report.columnGaps.length > 0) {
    lines.push(`## Column gaps on tables SETUP defines (${report.columnGaps.length})`, '', '| Table | Column |', '|-------|--------|');
    for (const g of report.columnGaps) lines.push(`| ${g.table} | ${g.column} |`);
    lines.push('');
  }

  lines.push(`## Public views in live DB (${report.publicViewsInLive.length})`, '');
  for (const v of report.publicViewsInLive) lines.push(`- ${v}`);
  lines.push('');

  if (report.migrationGaps.length > 0) {
    lines.push(`## Migration files with objects not found in live DB (${report.migrationGaps.length})`, '');
    for (const gap of report.migrationGaps) {
      lines.push(`### ${gap.file}`);
      if (gap.missingTables.length > 0) {
        lines.push('', 'Missing tables:', ...gap.missingTables.map((t) => `- ${t}`));
      }
      if (gap.missingColumns.length > 0) {
        lines.push('', 'Missing columns:', ...gap.missingColumns.map((c) => `- ${c.table}.${c.column}`));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function parseArgs(argv: string[]): { json: boolean; outPath?: string; failOnDrift: boolean } {
  let json = false;
  let outPath: string | undefined;
  let failOnDrift = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--fail-on-drift') failOnDrift = true;
    else if (arg === '--out' && argv[i + 1]) {
      outPath = argv[++i];
    }
  }

  return { json, outPath, failOnDrift };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnvConfig(process.cwd());

  const live = await fetchLiveSchema();
  const setupSql = readSqlFile('SETUP_DATABASE.sql');
  const setup = parseSqlArtifacts(setupSql);
  const sources = listMigrationSources();

  const report = buildReport(live, setup, sources);
  report.taskKeys = await fetchTaskKeyStatus();

  const hasDrift =
    report.summary.tablesInLiveNotSetup > 0 ||
    report.summary.tablesInSetupNotLive > 0 ||
    report.summary.columnGapsOnSharedTables > 0 ||
    report.summary.migrationFilesWithGaps > 0;

  if (args.json) {
    const payload = JSON.stringify(report, null, 2);
    if (args.outPath) {
      const out = resolve(process.cwd(), args.outPath);
      mkdirSync(resolve(out, '..'), { recursive: true });
      writeFileSync(out, payload, 'utf8');
      process.stdout.write(`Wrote ${args.outPath}\n`);
    } else {
      process.stdout.write(`${payload}\n`);
    }
  } else {
    const markdown = formatMarkdown(report);
    if (args.outPath) {
      const out = resolve(process.cwd(), args.outPath);
      mkdirSync(resolve(out, '..'), { recursive: true });
      writeFileSync(out, markdown, 'utf8');
      process.stdout.write(`Wrote ${args.outPath}\n`);
    } else {
      process.stdout.write(`${markdown}\n`);
    }
  }

  if (args.failOnDrift && hasDrift) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Audit failed: ${message}\n`);
  process.exit(1);
});
