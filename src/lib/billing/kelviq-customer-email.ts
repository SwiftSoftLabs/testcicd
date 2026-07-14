/**
 * Derives a unique email for Kelviq customer create only.
 * billing_customers.billing_email keeps the real login email for UI.
 */

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BuildKelviqCustomerEmailOptions {
    /** Override for tests; prod uses KELVIQ_BILLING_EMAIL_DOMAIN or onework.local */
    billingDomain?: string;
}

function workspaceIdSuffix(workspaceId: string): string {
    return workspaceId.replace(/-/g, '').slice(0, 8).toLowerCase();
}

export function getKelviqBillingEmailDomain(override?: string): string {
    const fromEnv = process.env.KELVIQ_BILLING_EMAIL_DOMAIN?.trim();
    const domain = override ?? fromEnv ?? 'onework.local';
    return domain.replace(/^\.+/, '').toLowerCase();
}

function canUsePlusAddress(local: string): boolean {
    if (!local || local.length > 64) return false;
    return !local.includes('+');
}

function buildPlusAddress(realEmail: string, workspaceId: string): string | null {
    const at = realEmail.lastIndexOf('@');
    if (at <= 0 || at === realEmail.length - 1) return null;
    const local = realEmail.slice(0, at);
    const domain = realEmail.slice(at + 1);
    if (!canUsePlusAddress(local) || !domain) return null;
    const suffix = workspaceIdSuffix(workspaceId);
    return `${local}+ow-${suffix}@${domain}`;
}

function buildFallbackAddress(workspaceId: string, billingDomain: string): string {
    return `ow-${workspaceId}@billing.${billingDomain}`;
}

/**
 * Stable, unique Kelviq-facing email per workspace.
 */
export function buildKelviqCustomerEmail(
    realEmail: string,
    workspaceId: string,
    options?: BuildKelviqCustomerEmailOptions,
): string {
    const normalizedId = workspaceId.trim().toLowerCase();
    if (!UUID_RE.test(normalizedId)) {
        throw new Error('workspaceId must be a UUID');
    }
    const trimmedEmail = realEmail.trim();
    const plus = buildPlusAddress(trimmedEmail, normalizedId);
    if (plus) return plus;
    return buildFallbackAddress(normalizedId, getKelviqBillingEmailDomain(options?.billingDomain));
}
