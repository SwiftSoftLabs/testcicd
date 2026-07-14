import { query, SCHEMA } from "@/lib/db";

export interface WorkspaceUserSettings {
  developerMode: boolean;
  showOfflineStatus: boolean;
  quickTaskbarPinned: boolean;
}

type WorkspaceUserSettingsRow = {
  developer_mode: boolean;
  show_offline_status: boolean;
  quick_taskbar_pinned: boolean;
};

export const DEFAULT_WORKSPACE_USER_SETTINGS: WorkspaceUserSettings = {
  developerMode: false,
  showOfflineStatus: true,
  quickTaskbarPinned: true,
};

function mergeSettings(
  row?: Partial<WorkspaceUserSettings> | null,
): WorkspaceUserSettings {
  return {
    ...DEFAULT_WORKSPACE_USER_SETTINGS,
    ...(row ?? {}),
  };
}

export async function getWorkspaceUserSettings(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceUserSettings> {
  const result = await query<WorkspaceUserSettingsRow>(
    `SELECT developer_mode, show_offline_status, quick_taskbar_pinned
         FROM ${SCHEMA}.workspace_user_settings
         WHERE workspace_id = $1
           AND user_id = $2
         LIMIT 1`,
    [workspaceId, userId],
  );

  const row = result.rows[0];
  return mergeSettings(
    row
      ? {
          developerMode: row.developer_mode,
          showOfflineStatus: row.show_offline_status,
          quickTaskbarPinned: row.quick_taskbar_pinned,
        }
      : null,
  );
}

export async function saveWorkspaceUserSettings(
  workspaceId: string,
  userId: string,
  updates: Partial<WorkspaceUserSettings>,
): Promise<WorkspaceUserSettings> {
  const current = await getWorkspaceUserSettings(workspaceId, userId);
  const next = mergeSettings({ ...current, ...updates });

  await query(
    `INSERT INTO ${SCHEMA}.workspace_user_settings (
            workspace_id,
            user_id,
            developer_mode,
            show_offline_status,
            quick_taskbar_pinned,
            updated_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET developer_mode = EXCLUDED.developer_mode,
             show_offline_status = EXCLUDED.show_offline_status,
             quick_taskbar_pinned = EXCLUDED.quick_taskbar_pinned,
             updated_at = NOW()`,
    [
      workspaceId,
      userId,
      next.developerMode,
      next.showOfflineStatus,
      next.quickTaskbarPinned,
    ],
  );

  return next;
}
