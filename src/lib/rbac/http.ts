import { NextResponse } from 'next/server';
import { QuotaLockedError } from '@/lib/billing/quota-locks';
import { ChatAccessError } from '@/lib/chat/chatAccess';
import { TaskAccessError } from '@/lib/rbac/task-access';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';

export function toAccessResponse(error: unknown): NextResponse | null {
    if (error instanceof QuotaLockedError) {
        return NextResponse.json(
            { error: error.message, code: 'QUOTA_LOCKED' },
            { status: 403 },
        );
    }
    if (error instanceof WorkspaceAccessError) {
        const status = error.message === 'Unauthorized' ? 401 : 403;
        return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof ChatAccessError) {
        const status = error.message === 'Unauthorized' ? 401 : 403;
        return NextResponse.json({ error: error.message }, { status });
    }
    if (error instanceof TaskAccessError) {
        const status = error.message === 'Unauthorized' ? 401 : 403;
        return NextResponse.json({ error: error.message }, { status });
    }
    return null;
}
