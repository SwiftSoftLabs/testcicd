import { NextResponse } from 'next/server';
import { MfaEnrollmentRequiredError, MfaStepUpRequiredError } from '@/lib/mfa/guard';
import { WorkspaceAccessError } from '@/lib/rbac/workspace-access';
import { vaultApiErrorFromUnknown } from '@/lib/vault/api-errors';

export function vaultAccessErrorResponse(e: WorkspaceAccessError): NextResponse {
    const body: Record<string, unknown> = { error: e.message };
    if ('requiredPlan' in e && typeof e.requiredPlan === 'string') {
        body.requiredPlan = e.requiredPlan;
    }
    return NextResponse.json(body, { status: e.status ?? 403 });
}

/** Maps vault access, MFA step-up, crypto, and setup errors to a NextResponse. */
export function vaultRouteErrorResponse(e: unknown): NextResponse {
    if (e instanceof MfaStepUpRequiredError || e instanceof MfaEnrollmentRequiredError) {
        return NextResponse.json(
            { error: e.message, code: e.code },
            { status: e.status },
        );
    }
    if (e instanceof WorkspaceAccessError) {
        return vaultAccessErrorResponse(e);
    }
    const mapped = vaultApiErrorFromUnknown(e);
    return NextResponse.json(
        { error: mapped.error, code: mapped.code, detail: mapped.detail },
        { status: mapped.status },
    );
}
