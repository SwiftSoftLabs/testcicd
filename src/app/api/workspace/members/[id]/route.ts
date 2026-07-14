/**
 * DELETE /api/workspace/members/[id]?workspaceId=<uuid>
 *   Removes user from this workspace only. Nullifies their task assignments in this workspace.
 *   Caller must be workspace owner or admin.
 *
 * DELETE /api/workspace/members/[id]?workspaceId=<uuid>&scope=account
 *   Deletes the user's InsForge auth account entirely (cascades to profiles, workspace_members).
 *   Also nullifies all their task assignments across all workspaces before deletion.
 *   Caller must be workspace owner.
 */

import { NextResponse } from 'next/server';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { getWorkspaceMembership, memberCan } from '@/lib/rbac/workspace-access';
import { revokeVaultCliTokensForUserInWorkspace } from '@/lib/vault/cli-token-lifecycle';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
    const caller = await getUserFromRequest(request);
    if (!caller?.id || !UUID_RE.test(caller.id)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: targetUserId } = await params;
    if (!targetUserId || !UUID_RE.test(targetUserId)) {
        return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const scope = searchParams.get('scope'); // 'account' or omitted (workspace)

    if (!workspaceId || !UUID_RE.test(workspaceId)) {
        return NextResponse.json({ error: 'Missing or invalid workspaceId' }, { status: 400 });
    }

    const callerMembership = await getWorkspaceMembership(workspaceId, caller.id);
    if (!callerMembership) {
        return NextResponse.json({ error: 'You are not a member of this workspace.' }, { status: 403 });
    }

    if (scope === 'account' && !callerMembership.isOwner) {
        return NextResponse.json({ error: 'Only the workspace owner can delete user accounts.' }, { status: 403 });
    }

    if (scope !== 'account' && !memberCan(callerMembership, 'manage_members')) {
        return NextResponse.json({ error: 'You do not have permission to remove members.' }, { status: 403 });
    }

    // Prevent self-deletion
    if (targetUserId === caller.id) {
        return NextResponse.json({ error: 'You cannot remove yourself.' }, { status: 400 });
    }

    try {
        if (scope === 'account') {
            // Verify the target user exists before proceeding
            const targetExists = await query<{ id: string }>(
                `SELECT id FROM ${SCHEMA}.profiles WHERE id = $1 LIMIT 1`,
                [targetUserId],
            );
            if (targetExists.rows.length === 0) {
                return NextResponse.json({ error: 'User not found.' }, { status: 404 });
            }

            // 1. Release workspace ownership (prevents FK violation on profiles delete)
            await query(
                `UPDATE ${SCHEMA}.workspaces SET owner_id = NULL WHERE owner_id = $1`,
                [targetUserId],
            );

            // 2. Nullify all task assignments
            await query(
                `UPDATE ${SCHEMA}.tasks
                 SET assignee_id = NULL, updated_at = NOW()
                 WHERE assignee_id = $1`,
                [targetUserId],
            );

            // 3. Remove from all workspaces
            await query(
                `DELETE FROM ${SCHEMA}.workspace_members WHERE user_id = $1`,
                [targetUserId],
            );

            // 4. Delete the profile record (removing all OneWork data for this user)
            await query(
                `DELETE FROM ${SCHEMA}.profiles WHERE id = $1`,
                [targetUserId],
            );

            // 4. Best-effort: delete the InsForge auth account so the user cannot log back in
            try {
                const insforgeBase = new URL(process.env.NEXT_PUBLIC_INSFORGE_URL!).origin;
                const deleteRes = await fetch(`${insforgeBase}/api/auth/users/${targetUserId}`, {
                    method: 'DELETE',
                    headers: { 'x-api-key': process.env.INSFORGE_API_KEY! },
                    cache: 'no-store',
                });
                if (!deleteRes.ok) {
                    console.warn(`InsForge auth delete returned ${deleteRes.status} for user ${targetUserId} — profile already removed from DB.`);
                }
            } catch (authErr) {
                console.warn('InsForge auth delete failed (non-fatal):', authErr);
            }

            return NextResponse.json({ message: 'User account deleted successfully.' });
        }

        // Workspace-scope removal: nullify tasks in this workspace, then remove from workspace_members
        await query(
            `UPDATE ${SCHEMA}.tasks
             SET assignee_id = NULL, updated_at = NOW()
             WHERE assignee_id = $1
               AND workspace_id = $2`,
            [targetUserId, workspaceId],
        );

        const removeResult = await query(
            `DELETE FROM ${SCHEMA}.workspace_members
             WHERE workspace_id = $1
               AND user_id = $2`,
            [workspaceId, targetUserId],
        );

        if (removeResult.rowCount === 0) {
            return NextResponse.json({ error: 'Member not found in this workspace.' }, { status: 404 });
        }

        await revokeVaultCliTokensForUserInWorkspace(workspaceId, targetUserId, 'member_removed');

        return NextResponse.json({ message: 'Member removed from workspace.' });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
