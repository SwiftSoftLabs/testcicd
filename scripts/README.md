# Maintainer scripts

One-off and operational scripts for the OneWork repo. These are **not** imported at runtime.

## Cursor affordances

### `fix-clickable-cursors.mjs`

Adds `cursor-pointer` to JSX opening tags that have `onClick` but no cursor class yet.

**When to run:** After adding many non-semantic click targets (`div` / `span` / `li` with `onClick`). Semantic controls (`button`, `a`, `[role="button"]`) are covered by global rules in `src/app/globals.css`.

```bash
node scripts/fix-clickable-cursors.mjs
```

**Skips tags that already set:**

- `cursor-pointer`, `cursor-grab`, `cursor-grabbing`, `cursor-default`, `cursor-not-allowed`
- `cursor-text`, resize cursors (`cursor-col-resize`, etc.), `cursor-move`
- `dismiss-backdrop`
- Inline `style={{ cursor: ... }}`

**Does not run in CI** — hand-tuned classes (e.g. task board `cursor-grab`) must not be overwritten on every build.

### `audit-onclick-cursors.mjs`

Read-only check for non-semantic `onClick` without any cursor affordance (including multiline `className`, `role="button"`, and `className={sel}`).

```bash
node scripts/audit-onclick-cursors.mjs
```

Exits `1` when gaps are found. Optional for local pre-commit; not wired to CI by default.

## Other scripts

| Script | Purpose |
|--------|---------|
| `run-sql.ts` | Run SQL against InsForge (statement split; no `DO $$` blocks) |
| `run-migration-once.ts` | Run a single `.sql` file as one batch (supports `DO $$`) |
| `apply-task-key-migrations.ts` | Apply task-key schema + name-based re-key migrations |
| `rekey-project-keys.ts` | Re-derive `projects.key` and `tasks.task_key` from project names |
| `audit-db-vs-setup.ts` | Compare live InsForge schema vs `SETUP_DATABASE.sql` + migrations (`npm run audit-db-vs-setup`) |
| `rotate-vault-kek.ts` | Vault key rotation (`npm run rotate-vault-kek`) |
| `migrations/*.sql` | Schema migration reference files |
