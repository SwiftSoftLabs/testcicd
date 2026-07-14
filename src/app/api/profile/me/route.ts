/**
 * GET /api/profile/me
 * Ambil profil user dari app_onework.profiles menggunakan InsForge Raw SQL.
 * Dipanggil dari AppContext setelah auth.getUser() untuk populate currentUser.
 */

import { NextResponse } from 'next/server';
import { getUserFromRequest, query, SCHEMA } from '@/lib/db';
import { createClient } from '@/lib/insforge/server';

export async function GET(request: Request) {
    const sessionUser = await getUserFromRequest(request);
    if (!sessionUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') ?? sessionUser.id;

    if (userId !== sessionUser.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const result = await query(
            `SELECT id, email, full_name, avatar_url, git_name, git_email,
                    onboarding_type, pending_join_notification, role, status
             FROM ${SCHEMA}.profiles
             WHERE id = $1
             LIMIT 1`,
            [sessionUser.id],
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ data: null }, { status: 404 });
        }

        return NextResponse.json({ data: result.rows[0] });
    } catch (error: unknown) {
        console.error('Error fetching profile:', error);
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const insforge = await createClient();
    const { data: { user } } = await insforge.auth.getUser().catch(() => ({ data: { user: null } }));
    const fallbackUser = user ? null : await getUserFromRequest(request);
    const userId = user?.id || fallbackUser?.id;

    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : undefined;
    const role = typeof body.role === 'string' ? body.role.trim() : undefined;
    const avatarUrl = typeof body.avatar_url === 'string' ? body.avatar_url.trim() : undefined;
    const email = typeof body.email === 'string' ? body.email.trim() : undefined;
    const onboardingType = body.onboarding_type === 'creator' || body.onboarding_type === 'joiner'
        ? body.onboarding_type
        : undefined;
    const clearJoinNotification = body.pending_join_notification === null && 'pending_join_notification' in body;
    const gitName =
        typeof body.git_name === 'string' ? (body.git_name.trim() || null) : undefined;
    const gitEmail =
        typeof body.git_email === 'string' ? (body.git_email.trim() || null) : undefined;

    if (
        !fullName &&
        !role &&
        !avatarUrl &&
        !email &&
        !onboardingType &&
        !clearJoinNotification &&
        gitName === undefined &&
        gitEmail === undefined
    ) {
        return NextResponse.json({ error: 'No valid fields supplied' }, { status: 400 });
    }

    if (gitEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail)) {
        return NextResponse.json({ error: 'Invalid git email' }, { status: 400 });
    }

    // Reject inline base64 avatars: they bloat every query that joins profiles
    // (a single 2 MB data-URI gets duplicated into every message/member row).
    // Avatars must be uploaded to storage and stored as a URL — see /api/profile/avatar.
    if (avatarUrl && avatarUrl.startsWith('data:')) {
        return NextResponse.json(
            { error: 'Avatar must be a URL, not inline image data. Upload via the avatar picker.' },
            { status: 400 },
        );
    }

    try {
        if (email && user?.email && email !== user.email) {
            const { error: emailError } = await insforge.auth.updateUser({ email });
            if (emailError) {
                return NextResponse.json({ error: emailError.message }, { status: 400 });
            }
        } else if (email && !user?.email) {
            // We authenticated via sb-access-token only; auth-session-based email updates require full session cookies.
            return NextResponse.json(
                { error: 'Email update requires a full session cookie. Please re-login in the app and try again.' },
                { status: 400 },
            );
        }

        const updates: string[] = [];
        const params: unknown[] = [];

        if (fullName) {
            params.push(fullName);
            updates.push(`full_name = $${params.length}`);
        }
        if (role) {
            params.push(role);
            updates.push(`role = $${params.length}`);
        }
        if (avatarUrl) {
            params.push(avatarUrl);
            updates.push(`avatar_url = $${params.length}`);
        }
        if (email) {
            params.push(email);
            updates.push(`email = $${params.length}`);
        }
        if (onboardingType) {
            params.push(onboardingType);
            updates.push(`onboarding_type = $${params.length}`);
        }
        if (clearJoinNotification) {
            updates.push(`pending_join_notification = NULL`);
        }
        if (gitName !== undefined) {
            params.push(gitName);
            updates.push(`git_name = $${params.length}`);
        }
        if (gitEmail !== undefined) {
            params.push(gitEmail);
            updates.push(`git_email = $${params.length}`);
        }

        params.push(userId);
        const result = await query(
            `UPDATE ${SCHEMA}.profiles
             SET ${updates.join(', ')}, updated_at = NOW()
             WHERE id = $${params.length}
             RETURNING id, email, full_name, avatar_url, git_name, git_email,
                       onboarding_type, pending_join_notification, role, status`,
            params,
        );

        if (result.rows.length === 0) {
            return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
        }

        return NextResponse.json({ data: result.rows[0] });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Internal server error';
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
