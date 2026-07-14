-- OneWork: workspace files & folders module
-- Run against the app schema (app_onework).

-- Folders
CREATE TABLE IF NOT EXISTS app_onework.workspace_folders (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    parent_id    UUID        REFERENCES app_onework.workspace_folders(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    created_by   UUID        NOT NULL REFERENCES auth.users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_folders_workspace
    ON app_onework.workspace_folders(workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_folders_parent
    ON app_onework.workspace_folders(parent_id);

-- Files
CREATE TABLE IF NOT EXISTS app_onework.workspace_files (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    folder_id    UUID        REFERENCES app_onework.workspace_folders(id) ON DELETE SET NULL,
    file_name    TEXT        NOT NULL,
    file_size    INT         NOT NULL,
    file_type    TEXT        NOT NULL,
    storage_path TEXT        NOT NULL,
    uploaded_by  UUID        NOT NULL REFERENCES auth.users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_files_workspace
    ON app_onework.workspace_files(workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_files_folder
    ON app_onework.workspace_files(folder_id);

-- Task <-> workspace file links (reference without copying)
CREATE TABLE IF NOT EXISTS app_onework.task_file_links (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id           UUID        NOT NULL REFERENCES app_onework.tasks(id) ON DELETE CASCADE,
    workspace_file_id UUID        NOT NULL REFERENCES app_onework.workspace_files(id) ON DELETE CASCADE,
    linked_by         UUID        NOT NULL REFERENCES auth.users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(task_id, workspace_file_id)
);

CREATE INDEX IF NOT EXISTS idx_task_file_links_task
    ON app_onework.task_file_links(task_id);

-- RLS: workspace_folders
ALTER TABLE app_onework.workspace_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wf_folders_read" ON app_onework.workspace_folders
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = workspace_folders.workspace_id
              AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "wf_folders_insert" ON app_onework.workspace_folders
    FOR INSERT WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = workspace_folders.workspace_id
              AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "wf_folders_delete" ON app_onework.workspace_folders
    FOR DELETE USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            WHERE w.id = workspace_folders.workspace_id
              AND w.owner_id = auth.uid()
        )
    );

-- RLS: workspace_files
ALTER TABLE app_onework.workspace_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wf_files_read" ON app_onework.workspace_files
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = workspace_files.workspace_id
              AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "wf_files_insert" ON app_onework.workspace_files
    FOR INSERT WITH CHECK (
        uploaded_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = workspace_files.workspace_id
              AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "wf_files_delete" ON app_onework.workspace_files
    FOR DELETE USING (
        uploaded_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            WHERE w.id = workspace_files.workspace_id
              AND w.owner_id = auth.uid()
        )
    );

-- RLS: task_file_links
ALTER TABLE app_onework.task_file_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tfl_read" ON app_onework.task_file_links
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_files wf
            JOIN app_onework.workspace_members wm ON wm.workspace_id = wf.workspace_id
            WHERE wf.id = task_file_links.workspace_file_id
              AND wm.user_id = auth.uid()
        )
    );

CREATE POLICY "tfl_insert" ON app_onework.task_file_links
    FOR INSERT WITH CHECK (linked_by = auth.uid());

CREATE POLICY "tfl_delete" ON app_onework.task_file_links
    FOR DELETE USING (linked_by = auth.uid());
