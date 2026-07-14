-- Billing & Subscriptions Migration
-- Schema: app_onework
-- Run this on existing clusters. For fresh clusters this is also in SETUP_DATABASE.sql BLOCK 12.
-- Idempotent: all statements use IF NOT EXISTS / ON CONFLICT.

-- ─── billing_plans (catalog) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_onework.billing_plans (
    code                  VARCHAR(32) PRIMARY KEY,
    name                  TEXT NOT NULL,
    price_cents           INTEGER,                        -- NULL = enterprise (contact sales)
    currency              TEXT NOT NULL DEFAULT 'usd',
    interval              TEXT NOT NULL DEFAULT 'month',
    kelviq_variant_id     TEXT,                           -- TODO(O4): set when Kelviq account provisioned
    max_projects          INTEGER,                        -- NULL = unlimited
    max_seats             INTEGER,                        -- NULL = unlimited
    max_channels          INTEGER,                        -- NULL = unlimited
    max_inboxes_per_user  INTEGER,                        -- NULL = unlimited
    max_storage_bytes     BIGINT NOT NULL DEFAULT 10485760,
    max_call_minutes_monthly BIGINT,                      -- NULL = unlimited
    max_call_duration_minutes INTEGER,                    -- NULL = unlimited
    analytics_level       TEXT NOT NULL DEFAULT 'none',
    ai_tier               TEXT NOT NULL DEFAULT 'none',
    support_tier          TEXT NOT NULL DEFAULT 'community',
    contact_sales         BOOLEAN NOT NULL DEFAULT false,
    is_active             BOOLEAN NOT NULL DEFAULT true,  -- never hard-deleted
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_onework.billing_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_plans_select_authenticated" ON app_onework.billing_plans;
CREATE POLICY "billing_plans_select_authenticated" ON app_onework.billing_plans
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ─── billing_customers (one per workspace) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS app_onework.billing_customers (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id                 UUID NOT NULL UNIQUE REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    kelviq_customer_id           TEXT,
    kelviq_customer_internal_id  TEXT,
    billing_email                TEXT,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_onework.billing_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_customers_member_select" ON app_onework.billing_customers;
CREATE POLICY "billing_customers_member_select" ON app_onework.billing_customers
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = billing_customers.workspace_id
              AND wm.user_id = auth.uid()
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "billing_customers_owner_admin_write" ON app_onework.billing_customers;
CREATE POLICY "billing_customers_owner_admin_write" ON app_onework.billing_customers
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = billing_customers.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = billing_customers.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = billing_customers.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = billing_customers.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    );

-- ─── workspace_subscriptions ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_onework.workspace_subscriptions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id                UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    plan_code                   VARCHAR(32) NOT NULL REFERENCES app_onework.billing_plans(code),
    kelviq_subscription_id      TEXT,
    status                      TEXT NOT NULL DEFAULT 'basic'
                                    CHECK (status IN ('basic','pending','active','past_due','canceled','trialing')),
    unit_price_cents            INTEGER,                  -- locked at checkout
    currency                    TEXT NOT NULL DEFAULT 'usd',
    current_period_end          TIMESTAMPTZ,
    cancel_at_period_end        BOOLEAN NOT NULL DEFAULT false,
    cancel_reason               TEXT,
    trial_ends_at               TIMESTAMPTZ,              -- reserved, unused in v1
    kelviq_object_updated_at    TIMESTAMPTZ,              -- monotonic concurrency guard
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_subscriptions_one_live_per_workspace
    ON app_onework.workspace_subscriptions (workspace_id)
    WHERE status <> 'canceled';

CREATE INDEX IF NOT EXISTS workspace_subscriptions_workspace_id_idx
    ON app_onework.workspace_subscriptions (workspace_id);

ALTER TABLE app_onework.workspace_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_subscriptions_member_select" ON app_onework.workspace_subscriptions;
CREATE POLICY "workspace_subscriptions_member_select" ON app_onework.workspace_subscriptions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = workspace_subscriptions.workspace_id
              AND wm.user_id = auth.uid()
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "workspace_subscriptions_owner_admin_write" ON app_onework.workspace_subscriptions;
CREATE POLICY "workspace_subscriptions_owner_admin_write" ON app_onework.workspace_subscriptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = workspace_subscriptions.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = workspace_subscriptions.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = workspace_subscriptions.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = workspace_subscriptions.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    );

-- ─── workspace_payment_methods ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_onework.workspace_payment_methods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    kelviq_pm_id    TEXT NOT NULL,
    brand           TEXT NOT NULL,
    last4           TEXT NOT NULL,
    exp_month       INTEGER NOT NULL,
    exp_year        INTEGER NOT NULL,
    is_default      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_payment_methods_workspace_id_idx
    ON app_onework.workspace_payment_methods (workspace_id);

ALTER TABLE app_onework.workspace_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_payment_methods_member_select" ON app_onework.workspace_payment_methods;
CREATE POLICY "workspace_payment_methods_member_select" ON app_onework.workspace_payment_methods
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = workspace_payment_methods.workspace_id
              AND wm.user_id = auth.uid()
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "workspace_payment_methods_owner_admin_write" ON app_onework.workspace_payment_methods;
CREATE POLICY "workspace_payment_methods_owner_admin_write" ON app_onework.workspace_payment_methods
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = workspace_payment_methods.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = workspace_payment_methods.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = workspace_payment_methods.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = workspace_payment_methods.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    );

-- ─── billing_invoices ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_onework.billing_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        UUID NOT NULL REFERENCES app_onework.workspaces(id) ON DELETE CASCADE,
    kelviq_invoice_id   TEXT NOT NULL,
    number              TEXT,
    amount_cents        INTEGER NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'usd',
    status              TEXT NOT NULL,
    hosted_url          TEXT,
    issued_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_invoices_workspace_issued_idx
    ON app_onework.billing_invoices (workspace_id, issued_at DESC);

ALTER TABLE app_onework.billing_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_invoices_member_select" ON app_onework.billing_invoices;
CREATE POLICY "billing_invoices_member_select" ON app_onework.billing_invoices
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspace_members wm
            WHERE wm.workspace_id = billing_invoices.workspace_id
              AND wm.user_id = auth.uid()
        )
        OR public.is_max_member(auth.uid())
    );

DROP POLICY IF EXISTS "billing_invoices_owner_admin_write" ON app_onework.billing_invoices;
CREATE POLICY "billing_invoices_owner_admin_write" ON app_onework.billing_invoices
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = billing_invoices.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = billing_invoices.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM app_onework.workspaces w
            LEFT JOIN app_onework.workspace_members wm
                ON wm.workspace_id = billing_invoices.workspace_id
               AND wm.user_id = auth.uid()
            WHERE w.id = billing_invoices.workspace_id
              AND (w.owner_id = auth.uid() OR wm.role IN ('owner', 'admin'))
        )
        OR public.is_max_member(auth.uid())
    );

-- ─── billing_events (webhook idempotency + audit) ───────────────────────────

CREATE TABLE IF NOT EXISTS app_onework.billing_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kelviq_event_id     TEXT NOT NULL UNIQUE,            -- exact-duplicate idempotency
    event_type          TEXT NOT NULL,
    workspace_id        UUID,                            -- nullable: workspace may be deleted
    payload             JSONB NOT NULL DEFAULT '{}',
    processed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_onework.billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_events_max_member_select" ON app_onework.billing_events;
CREATE POLICY "billing_events_max_member_select" ON app_onework.billing_events
    FOR SELECT USING (public.is_max_member(auth.uid()));

-- ─── Seed billing_plans ─────────────────────────────────────────────────────

INSERT INTO app_onework.billing_plans
    (code, name, price_cents, currency, interval, max_projects, max_seats, max_channels, max_inboxes_per_user, max_storage_bytes, max_call_minutes_monthly, max_call_duration_minutes, analytics_level, ai_tier, support_tier, contact_sales, is_active, sort_order)
VALUES
    ('basic',      'Basic',      0,    'usd', 'month', 3,    3,    5,    1,    10485760,         10,     1,    'none',    'none',       'community',      false, true, 1),
    ('pro',        'Pro',        2900, 'usd', 'month', 50,   20,   50,   5,    1073741824,       10000,  1440, 'basic',   'task_intel', 'priority_email', false, true, 2),
    ('max',        'Max',        9900, 'usd', 'month', 50,   100,  500,  10,   21474836480,      50000,  1440, 'full_ai', 'full_suite', 'slack_24_7',     false, true, 3),
    ('enterprise', 'Enterprise', NULL, 'usd', 'month', NULL, NULL, NULL, NULL, 107374182400,     NULL,   NULL, 'custom',  'dedicated',  'dedicated_lead', true,  true, 4)
ON CONFLICT (code) DO UPDATE SET
    name                 = EXCLUDED.name,
    price_cents          = EXCLUDED.price_cents,
    max_projects         = EXCLUDED.max_projects,
    max_seats            = EXCLUDED.max_seats,
    max_channels         = EXCLUDED.max_channels,
    max_inboxes_per_user = EXCLUDED.max_inboxes_per_user,
    max_storage_bytes    = EXCLUDED.max_storage_bytes,
    max_call_minutes_monthly = EXCLUDED.max_call_minutes_monthly,
    max_call_duration_minutes = EXCLUDED.max_call_duration_minutes,
    analytics_level      = EXCLUDED.analytics_level,
    ai_tier              = EXCLUDED.ai_tier,
    support_tier         = EXCLUDED.support_tier,
    contact_sales        = EXCLUDED.contact_sales,
    sort_order           = EXCLUDED.sort_order,
    updated_at           = NOW();

-- ─── Backfill: ensure every workspace has a basic subscription row ───────────

INSERT INTO app_onework.workspace_subscriptions (workspace_id, plan_code, status)
SELECT w.id, 'basic', 'basic'
FROM app_onework.workspaces w
WHERE NOT EXISTS (
    SELECT 1 FROM app_onework.workspace_subscriptions s WHERE s.workspace_id = w.id
);

-- ─── Missing indexes / unique constraints ────────────────────────────────────

-- Fast webhook customer lookup
CREATE UNIQUE INDEX IF NOT EXISTS billing_customers_kelviq_customer_id_idx
    ON app_onework.billing_customers (kelviq_customer_id)
    WHERE kelviq_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_customers_kelviq_internal_id_idx
    ON app_onework.billing_customers (kelviq_customer_internal_id)
    WHERE kelviq_customer_internal_id IS NOT NULL;

-- Prevent duplicate invoice records from webhook retries
ALTER TABLE app_onework.billing_invoices
    ADD CONSTRAINT IF NOT EXISTS billing_invoices_kelviq_invoice_id_unique UNIQUE (kelviq_invoice_id);

-- Prevent duplicate payment method records
ALTER TABLE app_onework.workspace_payment_methods
    ADD CONSTRAINT IF NOT EXISTS workspace_payment_methods_kelviq_pm_id_unique UNIQUE (workspace_id, kelviq_pm_id);
