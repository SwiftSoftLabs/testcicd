/**
 * GET    /api/integrations/git/ssh-keys?workspaceId=&provider=github|gitlab|onework
 * POST   /api/integrations/git/ssh-keys  { workspaceId, provider, title, key }
 * DELETE /api/integrations/git/ssh-keys?workspaceId=&provider=&keyId=
 *
 * Proxies to GitHub / GitLab user SSH key APIs, or Gitea admin API for OneWork VC.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getAccessTokenForIntegration, findIntegration } from '@/lib/integrations/git/repository';
import {
    createProviderSshKey,
    deleteProviderSshKey,
    listProviderSshKeys,
} from '@/lib/integrations/git/ssh-keys';
import { resolveOneworkGiteaUsername } from '@/lib/integrations/git/onework-ssh-keys';
import { mapUpstreamError, requireSessionUser } from '@/lib/integrations/git/route-helpers';
import { isWorkspaceMember } from '@/lib/integrations/git/workspace';
import { gitProviderSchema } from '@/lib/integrations/git/schemas';
import { IntegrationNotFoundError, UpstreamError } from '@/lib/integrations/git/errors';
import {
    integrationStoredScopesLackSsh,
    missingSshScopesMessage,
} from '@/lib/integrations/git/ssh-scopes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const postBodySchema = z.object({
    workspaceId: z.string().uuid(),
    provider: gitProviderSchema,
    title: z.string().min(1).max(255),
    key: z.string().min(32).max(8192),
});

async function getConnectedIntegration(workspaceId: string, userId: string, provider: z.infer<typeof gitProviderSchema>) {
    const row = await findIntegration(workspaceId, userId, provider);
    if (!row || row.status !== 'connected') {
        const label =
            provider === 'github'
                ? 'GitHub'
                : provider === 'gitlab'
                  ? 'GitLab'
                  : 'OneWork Version Control';
        throw new IntegrationNotFoundError(`Connect ${label} above before managing SSH keys.`);
    }
    const token = await getAccessTokenForIntegration(row);
    return { row, token };
}

export async function GET(request: Request) {
    try {
        const user = await requireSessionUser(request);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');
        const providerRaw = searchParams.get('provider');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        const provider = gitProviderSchema.parse(providerRaw);

        const member = await isWorkspaceMember(workspaceId, user.id);
        if (!member) return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 403 });

        if (provider === 'onework') {
            const giteaUsername = await resolveOneworkGiteaUsername(workspaceId, user.id);
            const keys = await listProviderSshKeys('onework', giteaUsername);
            return NextResponse.json({
                data: keys,
                accountLogin: giteaUsername,
                scopes: ['all'],
            });
        }

        const { row, token } = await getConnectedIntegration(workspaceId, user.id, provider);
        const scopes = row.scopes ?? [];

        if (integrationStoredScopesLackSsh(provider, row.auth_method, scopes)) {
            return NextResponse.json(
                {
                    error: missingSshScopesMessage(provider, row.auth_method),
                    code: 'MISSING_SSH_SCOPES',
                    accountLogin: row.account_login,
                    scopes,
                },
                { status: 403 },
            );
        }

        let keys;
        try {
            keys = await listProviderSshKeys(provider, token);
        } catch (e: unknown) {
            if (
                e instanceof UpstreamError &&
                (e.status === 403 || e.status === 401) &&
                row.auth_method === 'oauth'
            ) {
                return NextResponse.json(
                    {
                        error: missingSshScopesMessage(provider, row.auth_method),
                        code: 'MISSING_SSH_SCOPES',
                        accountLogin: row.account_login,
                        scopes,
                    },
                    { status: 403 },
                );
            }
            throw e;
        }

        return NextResponse.json({
            data: keys,
            accountLogin: row.account_login,
            scopes,
        });
    } catch (e: unknown) {
        return mapUpstreamError(e);
    }
}

export async function POST(request: Request) {
    try {
        const user = await requireSessionUser(request);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const body = postBodySchema.parse(await request.json());
        const member = await isWorkspaceMember(body.workspaceId, user.id);
        if (!member) return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 403 });

        if (body.provider === 'onework') {
            const giteaUsername = await resolveOneworkGiteaUsername(body.workspaceId, user.id);
            const created = await createProviderSshKey(
                'onework',
                giteaUsername,
                body.title,
                body.key,
            );
            return NextResponse.json({ data: created }, { status: 201 });
        }

        const { token } = await getConnectedIntegration(body.workspaceId, user.id, body.provider);
        const created = await createProviderSshKey(body.provider, token, body.title, body.key);

        return NextResponse.json({ data: created }, { status: 201 });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return NextResponse.json({ error: e.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        return mapUpstreamError(e);
    }
}

export async function DELETE(request: Request) {
    try {
        const user = await requireSessionUser(request);
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        const workspaceId = searchParams.get('workspaceId');
        const providerRaw = searchParams.get('provider');
        const keyId = searchParams.get('keyId');

        if (!workspaceId || !UUID_RE.test(workspaceId)) {
            return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
        }
        if (!keyId) {
            return NextResponse.json({ error: 'keyId is required' }, { status: 400 });
        }

        const provider = gitProviderSchema.parse(providerRaw);
        const member = await isWorkspaceMember(workspaceId, user.id);
        if (!member) return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 403 });

        if (provider === 'onework') {
            const giteaUsername = await resolveOneworkGiteaUsername(workspaceId, user.id);
            await deleteProviderSshKey('onework', giteaUsername, keyId);
            return NextResponse.json({ ok: true });
        }

        const { token } = await getConnectedIntegration(workspaceId, user.id, provider);
        await deleteProviderSshKey(provider, token, keyId);

        return NextResponse.json({ ok: true });
    } catch (e: unknown) {
        if (e instanceof z.ZodError) {
            return NextResponse.json({ error: e.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
        }
        return mapUpstreamError(e);
    }
}
