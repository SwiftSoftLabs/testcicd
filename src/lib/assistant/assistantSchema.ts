import { query, SCHEMA } from "@/lib/db";

let ensureAssistantTablesPromise: Promise<void> | null = null;

/** Creates assistant audit table if missing (idempotent). */
export async function ensureAssistantTables(): Promise<void> {
  if (!ensureAssistantTablesPromise) {
    ensureAssistantTablesPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ${SCHEMA}.assistant_command_log (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          workspace_id    UUID,
          transcript      TEXT NOT NULL,
          tool_name       TEXT,
          tool_args_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
          outcome         TEXT NOT NULL DEFAULT 'ok',
          spoken_reply    TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_assistant_command_log_user_created
          ON ${SCHEMA}.assistant_command_log (user_id, created_at DESC)
      `);
    })().catch((err) => {
      ensureAssistantTablesPromise = null;
      throw err;
    });
  }
  return ensureAssistantTablesPromise;
}

export async function logAssistantCommand(opts: {
  userId: string;
  workspaceId?: string | null;
  transcript: string;
  toolName?: string | null;
  toolArgs?: Record<string, unknown>;
  outcome: string;
  spokenReply?: string;
}): Promise<void> {
  await ensureAssistantTables();
  await query(
    `INSERT INTO ${SCHEMA}.assistant_command_log
     (user_id, workspace_id, transcript, tool_name, tool_args_json, outcome, spoken_reply)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      opts.userId,
      opts.workspaceId ?? null,
      opts.transcript.slice(0, 4000),
      opts.toolName ?? null,
      JSON.stringify(opts.toolArgs ?? {}),
      opts.outcome.slice(0, 120),
      opts.spokenReply?.slice(0, 2000) ?? null,
    ],
  );
}
