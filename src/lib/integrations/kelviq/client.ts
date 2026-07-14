// Server-only Kelviq client. Never import this from browser code.
if (typeof window !== 'undefined') {
    throw new Error('kelviq/client must only be imported on the server.');
}

import { getKelviqConfig, KELVIQ_API_BASE_URL } from './config';

export interface KelviqCustomer {
    id: string;
    email: string;
    name: string;
}

export interface KelviqCheckoutSession {
    checkoutUrl: string;
    checkoutSessionId: string;
}

export interface KelviqSubscription {
    id: string;
    status: string;
    planIdentifier: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    unitPriceCents: number;
    currency: string;
    updatedAt: string;
}

export interface KelviqInvoice {
    id: string;
    number: string;
    amountCents: number;
    currency: string;
    status: string;
    hostedUrl: string | null;
    issuedAt: string;
}

export interface KelviqPaymentMethod {
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    isDefault: boolean;
}

async function kelviqFetch(path: string, options: RequestInit = {}): Promise<unknown> {
    const config = getKelviqConfig();
    const url = `${KELVIQ_API_BASE_URL}${path}`;
    const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10_000),
        headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Kelviq API error ${res.status} on ${path}: ${body}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

interface KelviqCustomerRecord {
    id: string;
    email?: string;
}

export interface KelviqCustomerDetail {
    id: string;
    customerId?: string;
    email?: string;
}

function parseKelviqCustomerDetail(data: unknown): KelviqCustomerDetail | null {
    if (!data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    if (typeof row.id !== 'string') return null;
    const customerId = typeof row.customerId === 'string'
        ? row.customerId
        : typeof row.customer_id === 'string'
            ? row.customer_id
            : undefined;
    return {
        id: row.id,
        customerId,
        email: typeof row.email === 'string' ? row.email : undefined,
    };
}

function parseKelviqCustomerResponse(data: unknown): KelviqCustomerRecord | null {
    if (!data || typeof data !== 'object') return null;
    if ('id' in data && typeof (data as KelviqCustomerRecord).id === 'string') {
        const row = data as KelviqCustomerRecord;
        return { id: row.id, email: row.email };
    }
    const results = (data as { results?: KelviqCustomerRecord[] }).results;
    const first = results?.[0];
    if (first?.id) return { id: first.id, email: first.email };
    return null;
}

function kelviqFieldIndicatesAlreadyExists(value: unknown): boolean {
    if (typeof value === 'string') {
        return value.toLowerCase().includes('already exists');
    }
    if (Array.isArray(value)) {
        return value.some(
            (m) => typeof m === 'string' && m.toLowerCase().includes('already exists'),
        );
    }
    return false;
}

function isKelviqCustomerConflict(errBody: Record<string, unknown>): boolean {
    if (
        kelviqFieldIndicatesAlreadyExists(errBody.customerId)
        || kelviqFieldIndicatesAlreadyExists(errBody.email)
    ) {
        return true;
    }
    return Object.values(errBody).some(kelviqFieldIndicatesAlreadyExists);
}

/** Kelviq data.id (internal UUID) → customer record including external customerId (workspace UUID). */
export async function fetchKelviqCustomerByInternalId(
    internalId: string,
): Promise<KelviqCustomerDetail | null> {
    try {
        const data = await kelviqFetch(`/customers/${encodeURIComponent(internalId)}/`);
        const direct = parseKelviqCustomerDetail(data);
        if (direct) return direct;
    } catch {
        // fall through to list scan
    }

    try {
        const data = await kelviqFetch('/customers/');
        const list = Array.isArray(data)
            ? data
            : ((data as { results?: unknown[] }).results
                ?? (data as { data?: unknown[] }).data
                ?? []);
        for (const row of list) {
            const parsed = parseKelviqCustomerDetail(row);
            if (parsed?.id === internalId) return parsed;
        }
    } catch {
        return null;
    }

    return null;
}

export async function fetchCustomerByWorkspaceId(
    workspaceId: string,
): Promise<KelviqCustomerRecord | null> {
    const config = getKelviqConfig();
    const path = `/customers/?customer_id=${encodeURIComponent(workspaceId)}`;
    const url = `${KELVIQ_API_BASE_URL}${path}`;
    const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
        },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Kelviq API error ${res.status} on ${path}: ${body}`);
    }
    const text = await res.text();
    if (!text) return null;
    return parseKelviqCustomerResponse(JSON.parse(text) as unknown);
}

function warnEmailMismatch(
    customer: KelviqCustomerRecord,
    expectedEmail: string,
    workspaceId: string,
): void {
    if (customer.email && customer.email.toLowerCase() !== expectedEmail.toLowerCase()) {
        console.warn(
            `[Kelviq] Customer ${customer.id} has email ${customer.email}, expected ${expectedEmail} for workspace ${workspaceId}`,
        );
    }
}

export async function createOrGetCustomer(
    workspaceId: string,
    email: string,
    name: string,
): Promise<{ id: string }> {
    const existing = await fetchCustomerByWorkspaceId(workspaceId);
    if (existing?.id) {
        warnEmailMismatch(existing, email, workspaceId);
        return { id: existing.id };
    }

    const config = getKelviqConfig();
    const url = `${KELVIQ_API_BASE_URL}/customers/`;
    const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ customerId: workspaceId, email, name }),
    });

    if (res.ok) {
        const data = (await res.json()) as { id: string };
        return { id: data.id };
    }

    if (res.status === 400) {
        const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!isKelviqCustomerConflict(errBody)) {
            throw new Error(`Kelviq API error 400 on /customers/: ${JSON.stringify(errBody)}`);
        }
        const recovered = await fetchCustomerByWorkspaceId(workspaceId);
        if (!recovered?.id) {
            throw new Error('Kelviq customer already exists but could not be retrieved');
        }
        warnEmailMismatch(recovered, email, workspaceId);
        return { id: recovered.id };
    }

    const body = await res.text();
    throw new Error(`Kelviq API error ${res.status} on /customers/: ${body}`);
}

export async function createCheckout(opts: {
    planIdentifier: string;
    chargePeriod: 'MONTHLY' | 'YEARLY';
    kelviqCustomerId: string;
    successUrl: string;
    cancelUrl: string;
}): Promise<KelviqCheckoutSession> {
    const data = await kelviqFetch('/checkout/', {
        method: 'POST',
        body: JSON.stringify({
            planIdentifier: opts.planIdentifier,
            chargePeriod: opts.chargePeriod,
            customerId: opts.kelviqCustomerId,
            successUrl: opts.successUrl,
            cancelUrl: opts.cancelUrl,
        }),
    });
    const d = data as { checkoutUrl: string; checkoutSessionId: string };
    return { checkoutUrl: d.checkoutUrl, checkoutSessionId: d.checkoutSessionId };
}

interface KelviqRawSubscription {
    id: string;
    status: string;
    plan?: { identifier?: string };
    billingPeriodEndTime?: string;
    billingPeriodStartTime?: string;
    endDate?: string | null;
    amount?: string | number;
    currency?: string;
}

function mapSubscription(raw: KelviqRawSubscription): KelviqSubscription {
    const amt = typeof raw.amount === 'string' ? parseFloat(raw.amount) : (raw.amount ?? 0);
    const cents = Math.round(amt * 100);
    // Kelviq does not return cancelAtPeriodEnd directly. When a subscription is scheduled
    // to cancel, endDate is populated while status remains 'active' until the period ends.
    const cancelScheduled = raw.status === 'active' && !!raw.endDate;
    return {
        id: raw.id,
        status: raw.status,
        planIdentifier: raw.plan?.identifier ?? '',
        currentPeriodEnd: raw.billingPeriodEndTime ?? '',
        cancelAtPeriodEnd: cancelScheduled,
        unitPriceCents: cents,
        currency: (raw.currency ?? 'usd').toLowerCase(),
        // Kelviq subscription objects have no updatedAt field; billingPeriodStartTime is
        // monotonic per cycle and works as an idempotency stamp for the verify INSERT.
        updatedAt: raw.billingPeriodStartTime ?? new Date(0).toISOString(),
    };
}

export async function getCustomerSubscriptions(kelviqCustomerId: string): Promise<KelviqSubscription[]> {
    // Kelviq list filter param is snake_case (customer_id), unlike most other request fields.
    const data = await kelviqFetch(`/subscriptions/?customer_id=${encodeURIComponent(kelviqCustomerId)}`);
    const list = Array.isArray(data)
        ? (data as KelviqRawSubscription[])
        : ((data as { results?: KelviqRawSubscription[]; data?: KelviqRawSubscription[] }).results
            ?? (data as { data?: KelviqRawSubscription[] }).data
            ?? []);
    return list.map(mapSubscription);
}

export async function cancelSubscription(kelviqSubscriptionId: string): Promise<void> {
    // Kelviq requires `cancellationType`. As of 2026-05, IMMEDIATE is the only value
    // their sandbox accepts — every period-end variant we probed returned 400. Switch
    // to a period-end value once Kelviq documents one. See docs/billing-deferred-work.md.
    await kelviqFetch(`/subscriptions/${encodeURIComponent(kelviqSubscriptionId)}/cancel/`, {
        method: 'POST',
        body: JSON.stringify({ cancellationType: 'IMMEDIATE' }),
    });
}

export async function resumeSubscription(kelviqSubscriptionId: string): Promise<void> {
    await kelviqFetch(`/subscriptions/${encodeURIComponent(kelviqSubscriptionId)}/resume/`, {
        method: 'POST',
    });
}

// Kelviq sandbox does not expose /invoices/ or /payment-methods/ endpoints (both 404).
// These will need to be sourced from Stripe directly or a different Kelviq endpoint once
// confirmed. For now we return empty arrays so the billing summary doesn't break.
export async function listInvoices(_kelviqCustomerId: string): Promise<KelviqInvoice[]> {
    return [];
}

export async function listPaymentMethods(_kelviqCustomerId: string): Promise<KelviqPaymentMethod[]> {
    return [];
}

// Kelviq exposes invoices, payment methods, and subscription history via their
// hosted Customer Portal — not as JSON endpoints. We mint a portal session and
// redirect the user there. Final URL is `${customerPortalUrl}?token=${token}`.
// Kelviq does not honor a returnUrl/redirect — they manage their own back-link.
// Portal session expects Kelviq's external customerId (customer.customerId), not data.id.
export async function getPortalUrl(kelviqInternalCustomerId: string): Promise<string | null> {
    try {
        const customer = await fetchKelviqCustomerByInternalId(kelviqInternalCustomerId);
        const portalCustomerId = customer?.customerId?.trim();
        if (!portalCustomerId) {
            console.error(
                `[kelviq] getPortalUrl: no customerId for internal id ${kelviqInternalCustomerId}`,
            );
            return null;
        }

        const data = await kelviqFetch('/portal/session/', {
            method: 'POST',
            body: JSON.stringify({ customerId: portalCustomerId }),
        });
        const d = data as { customerPortalUrl?: string; token?: string };
        if (!d.customerPortalUrl || !d.token) return null;
        const sep = d.customerPortalUrl.includes('?') ? '&' : '?';
        return `${d.customerPortalUrl}${sep}token=${encodeURIComponent(d.token)}`;
    } catch (err) {
        console.error('[kelviq] getPortalUrl failed:', err);
        return null;
    }
}
