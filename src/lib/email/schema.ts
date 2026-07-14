import { query, SCHEMA } from "@/lib/db";

let ensureEmailSchemaPromise: Promise<void> | null = null;

async function ensureColumnNullable(table: string, column: string) {
  const columnInfo = await query<{ is_nullable: "YES" | "NO" }>(
    `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = $2
           AND column_name = $3
         LIMIT 1`,
    [SCHEMA, table, column],
  );

  if (columnInfo.rows[0]?.is_nullable === "NO") {
    await query(
      `ALTER TABLE ${SCHEMA}.${table}
             ALTER COLUMN ${column} DROP NOT NULL`,
    );
  }
}

async function ensureColumnExists(table: string, columnDefSql: string) {
  const column = columnDefSql.trim().split(/\s+/)[0];
  const columnInfo = await query<{ column_name: string }>(
    `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = $2
           AND column_name = $3
         LIMIT 1`,
    [SCHEMA, table, column],
  );

  if (columnInfo.rows[0]) return;

  await query(`ALTER TABLE ${SCHEMA}.${table} ADD COLUMN ${columnDefSql}`);
}

export async function ensureEmailAccountScopedSchema() {
  if (!ensureEmailSchemaPromise) {
    ensureEmailSchemaPromise = (async () => {
      await ensureColumnNullable("mail_messages", "workspace_id");
      await ensureColumnExists("mail_messages", "snoozed_until TIMESTAMPTZ");
      await ensureColumnExists(
        "mail_messages",
        "provider_message_id TEXT",
      );
      await ensureColumnNullable("emails", "workspace_id").catch(
        () => undefined,
      );
      await ensureColumnExists("emails", "snoozed_until TIMESTAMPTZ").catch(
        () => undefined,
      );
    })().catch((error) => {
      ensureEmailSchemaPromise = null;
      throw error;
    });
  }

  return ensureEmailSchemaPromise;
}
