-- ============================================================
-- Vercel Integration Migration
-- Run this on existing clusters to add Vercel OAuth support.
-- Idempotent: safe to run multiple times.
-- ============================================================

-- TABLE: vercel_integrations
-- Stores encrypted Vercel OAuth tokens, scoped per workspace.
-- V1: team-only connections. V2 can add user-scoped without migration
-- (connection_scope + target_id unique constraint already supports it).
-- ============================================================
CREATE TABLE IF NOT EXISTS app_onework.vercel_integrations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
  connected_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,

  connection_scope  TEXT        NOT NULL DEFAULT 'team' CHECK (connection_scope IN ('team', 'user')),
  target_id         TEXT        NOT NULL,
  target_name       TEXT,

  access_token_enc  TEXT        NOT NULL,
  refresh_token_enc TEXT,
  token_type        TEXT        NOT NULL DEFAULT 'Bearer',
  scope             TEXT,
  expires_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (workspace_id, connection_scope, target_id)
);

CREATE INDEX IF NOT EXISTS idx_vercel_integrations_workspace
  ON app_onework.vercel_integrations(workspace_id);

-- RLS: admin/owner only (mirrors git_integrations policy)
ALTER TABLE app_onework.vercel_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vercel_integrations_admin" ON app_onework.vercel_integrations;
CREATE POLICY "vercel_integrations_admin" ON app_onework.vercel_integrations
  USING (public.is_max_member(workspace_id));
