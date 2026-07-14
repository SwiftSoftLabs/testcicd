import { query, SCHEMA } from '@/lib/db';

interface LogTaskSystemActivityInput {
  taskId: string;
  actorUserId: string;
  content: string;
}

export async function logTaskSystemActivity(
  input: LogTaskSystemActivityInput,
): Promise<void> {
  const profileRes = await query<{ full_name: string | null; avatar_url: string | null }>(
    `SELECT full_name, avatar_url FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
    [input.actorUserId],
  );
  const profile = profileRes.rows[0];

  await query(
    `INSERT INTO ${SCHEMA}.task_activities
       (task_id, user_id, type, content, author_name, author_avatar)
     VALUES ($1, $2, 'system', $3, $4, $5)`,
    [
      input.taskId,
      input.actorUserId,
      input.content,
      profile?.full_name ?? 'System',
      profile?.avatar_url ?? null,
    ],
  );
}
