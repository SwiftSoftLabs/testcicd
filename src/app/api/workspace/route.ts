/**
 * POST /api/workspace — Create new workspace with full setup
 * GET  /api/workspace?id=<uuid> — Fetch workspace by ID
 *
 * Schema: app_onework (isolated, not exposed to frontend/PostgREST)
 * Auth: TODO Production — verify session token from Authorization header
 */

import { NextResponse } from 'next/server';
import { query, SCHEMA, getUserFromRequest } from '@/lib/db';
import {
    requireSessionUser,
    requireWorkspaceMember,
    WorkspaceAccessError,
} from '@/lib/rbac/workspace-access';
import { cancelSubscription } from '@/lib/integrations/kelviq/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Missing workspace id' }, { status: 400 });
        }

        if (!UUID_RE.test(id)) {
            return NextResponse.json({ error: 'Invalid workspace id' }, { status: 400 });
        }

        await requireWorkspaceMember(id, user.id);

        const result = await query(
            `SELECT * FROM ${SCHEMA}.workspaces WHERE id = $1`,
            [id],
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
        }

        return NextResponse.json({ data: result.rows[0] });
    } catch (error: unknown) {
        if (error instanceof WorkspaceAccessError) {
            const status = error.message === 'Unauthorized' ? 401 : 403;
            return NextResponse.json({ error: error.message }, { status });
        }
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function POST(request: Request) {
    let body: Record<string, unknown>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const sessionUser = await getUserFromRequest(request);
    if (!sessionUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, slug, userName } = body as {
        name?: string;
        slug?: string;
        userName?: string;
    };

    const userId = sessionUser.id;
    const userEmail = sessionUser.email;

    if (!name || !slug) {
        return NextResponse.json(
            { error: 'Missing required fields: name, slug' },
            { status: 400 },
        );
    }

    let workspaceId: string | null = null;

    try {
        // Step 0: Upsert user to app_onework.profiles
        // workspaces.owner_id has FK → profiles(id), so profile must exist first.
        // full_name check constraint: >= 3 characters
        const rawName = (userName ?? '').trim();
        const emailPrefix = userEmail ? userEmail.split('@')[0] : '';
        const displayName = rawName.length >= 3 ? rawName : emailPrefix.length >= 3 ? emailPrefix : 'OneWork User';

        await query(
            `INSERT INTO ${SCHEMA}.profiles (id, email, full_name, status)
             VALUES ($1, $2, $3, 'online')
             ON CONFLICT (id) DO UPDATE
               SET email     = EXCLUDED.email,
                   full_name = EXCLUDED.full_name`,
            [userId, userEmail ?? '', displayName],
        );

        // MANIFEST §3: Tag user in auth.users with app_origin to mark
        // that this account is registered on OneWork. InsForge uses `metadata` JSONB
        // (not raw_user_meta_data like Supabase).
        const appOrigin = process.env.NEXT_PUBLIC_DB_SCHEMA ?? 'app_onework';
        await query(
            `UPDATE auth.users
             SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('app_origin', $2)
             WHERE id = $1
               AND (metadata->>'app_origin' IS NULL OR metadata->>'app_origin' != $2)`,
            [userId, appOrigin],
        );
        // Step 1: Insert workspace
        const wsResult = await query<{
            id: string; name: string; slug: string; owner_id: string; created_at: string;
        }>(
            `INSERT INTO ${SCHEMA}.workspaces (name, slug, owner_id)
             VALUES ($1, $2, $3)
             RETURNING id, name, slug, owner_id, created_at`,
            [name, slug, userId],
        );

        if (!wsResult.rows[0]) throw new Error('Workspace insert returned no rows');

        const ws = wsResult.rows[0];
        workspaceId = ws.id;

        // Step 2: Add owner to workspace_members (role='admin')
        await query(
            `INSERT INTO ${SCHEMA}.workspace_members (workspace_id, user_id, role)
             VALUES ($1, $2, 'admin')`,
            [workspaceId, userId],
        );

        // Step 3: Create default #general channel
        const convResult = await query<{ id: string }>(
            `INSERT INTO ${SCHEMA}.conversations (workspace_id, type, name, description, created_by)
             VALUES ($1, 'channel', 'general', 'Default workspace channel', $2)
             RETURNING id`,
            [workspaceId, userId],
        );

        if (!convResult.rows[0]) throw new Error('Conversation insert returned no rows');

        const convId = convResult.rows[0].id;

        // Step 4: Add owner to conversation_members
        await query(
            `INSERT INTO ${SCHEMA}.conversation_members (conversation_id, user_id, role)
             VALUES ($1, $2, 'admin')`,
            [convId, userId],
        );

        // Step 5: Seed basic subscription + billing_customer row for this workspace
        await query(
            `INSERT INTO ${SCHEMA}.workspace_subscriptions (workspace_id, plan_code, status)
             VALUES ($1, 'basic', 'basic')
             ON CONFLICT DO NOTHING`,
            [workspaceId],
        );
        await query(
            `INSERT INTO ${SCHEMA}.billing_customers (workspace_id, billing_email)
             VALUES ($1, $2)
             ON CONFLICT (workspace_id) DO NOTHING`,
            [workspaceId, userEmail ?? null],
        );

        // OneWork Version Control: workspace org + owner integration (non-blocking)
        void import('@/lib/integrations/git/provisioning').then(({ ensureOneworkWorkspaceOrg, ensureOneworkMemberIntegration }) => {
            void ensureOneworkWorkspaceOrg({
                workspaceId: workspaceId!,
                workspaceSlug: slug,
                workspaceName: name,
            }).then(() =>
                ensureOneworkMemberIntegration({
                    workspaceId: workspaceId!,
                    userId,
                    email: userEmail ?? '',
                    fullName: displayName,
                }),
            );
        }).catch((err) => console.error('[onework-vc] workspace create provision:', err));

        return NextResponse.json(
            { data: ws, message: 'Workspace created successfully with default channel' },
            { status: 201 },
        );
    } catch (error: unknown) {
        console.error('Error creating workspace:', error);

        // Cleanup: CASCADE delete will remove members/conversations/conv_members
        if (workspaceId) {
            try {
                await query(`DELETE FROM ${SCHEMA}.workspaces WHERE id = $1`, [workspaceId]);
            } catch (cleanupErr) {
                console.error('Cleanup also failed:', cleanupErr);
            }
        }

        const errMsg = error instanceof Error ? error.message : String(error);

        if (errMsg.includes('23505') || errMsg.toLowerCase().includes('unique')) {
            return NextResponse.json(
                { error: 'Workspace slug already exists. Try a different name.' },
                { status: 409 },
            );
        }

        return NextResponse.json(
            { error: 'Failed to create workspace. Please try again.' },
            { status: 500 },
        );
    }
}

export async function DELETE(request: Request) {
    const user = await getUserFromRequest(request);
    if (!user?.id || !UUID_RE.test(user.id)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
        return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
    }
    if (!UUID_RE.test(id)) {
        return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 });
    }

    try {
        const access = await query<{ id: string }>(
            `SELECT w.id
             FROM ${SCHEMA}.workspaces w
             LEFT JOIN ${SCHEMA}.workspace_members wm
               ON wm.workspace_id = w.id
              AND wm.user_id = $2
             WHERE w.id = $1
               AND w.owner_id = $2
             LIMIT 1`,
            [id, user.id],
        );

        if (!access.rows[0]) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Cancel any active Kelviq subscription before deleting.
        // If cancel_at_period_end is already true, the Kelviq sub was already canceled
        // when the user clicked Cancel Plan (deferred-cancel pattern) — skip the call
        // to avoid a 4xx from Kelviq for "already canceled".
        const subResult = await query<{
            kelviq_subscription_id: string | null;
            status: string;
            cancel_at_period_end: boolean;
        }>(
            `SELECT kelviq_subscription_id, status, cancel_at_period_end
             FROM ${SCHEMA}.workspace_subscriptions
             WHERE workspace_id = $1 AND status IN ('active', 'past_due', 'trialing')
             ORDER BY created_at DESC LIMIT 1`,
            [id],
        );
        const activeSub = subResult.rows[0];
        if (activeSub?.kelviq_subscription_id && !activeSub.cancel_at_period_end) {
            try {
                await cancelSubscription(activeSub.kelviq_subscription_id);
            } catch (err) {
                console.error('[workspace delete] Kelviq cancellation failed:', err);
                return NextResponse.json(
                    { error: 'Could not cancel active subscription. Please cancel your billing plan before deleting the workspace.' },
                    { status: 502 },
                );
            }
        }

        await query(`DELETE FROM ${SCHEMA}.workspaces WHERE id = $1`, [id]);
        return NextResponse.json({ ok: true });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
