/**
 * POST /api/billing/kelviq/webhook
 * Receives and processes Kelviq webhook events.
 *
 * Signature: HMAC-SHA256 of "{webhook-id}.{webhook-timestamp}.{rawBody}",
 *            hex-encoded, header is "v1,{hex}". See docs/billing-deferred-work.md
 *            for the API quirks this handler had to account for.
 *
 * Event shape: { id, type, created_at, data: { object: {...}, previous_attributes?: {...} } }
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { query, SCHEMA } from '@/lib/db';
import {
    ensureBillingCustomerKelviqRefs,
    extractWorkspaceIdFromCheckoutObject,
    resolveWorkspaceIdForBillingEvent,
    syncKelviqCustomerRefs,
    workspaceExists,
} from '@/lib/billing/kelviq-customer-refs';
import { evaluateQuotaGrace, notifyWorkspaceAdmins } from '@/lib/billing/reconcile';
import { maybeRevokeCliTokensOnBillingChange } from '@/lib/vault/cli-token-lifecycle';
import type { PlanCode } from '@/types/billing';

const PLAN_CODE_MAP: Record<string, PlanCode> = { pro: 'pro', max: 'max' };
const TIMESTAMP_TOLERANCE_SECONDS = 300;

// Kelviq event types. Note British "cancelled" spelling — Kelviq's catalog uses
// British in event names but American "canceled" in subscription.status values.
const EVENTS = {
    CHECKOUT_COMPLETED: 'checkout.completed',
    CUSTOMER_CREATED: 'customer.created',
    CUSTOMER_UPDATED: 'customer.updated',
    SUB_CREATED: 'subscription.created',
    SUB_UPDATED: 'subscription.updated',
    SUB_CANCELLED: 'subscription.cancelled',
    SUB_PLAN_CHANGED: 'subscription.plan_changed',
    INVOICE_CREATED: 'invoice.created',
    INVOICE_PAID: 'invoice.paid',
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
} as const;

function verifySignature(
    webhookId: string,
    webhookTimestamp: string,
    rawBody: string,
    signatureHeader: string,
    secret: string,
): boolean {
    const toSign = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const expectedHex = createHmac('sha256', secret).update(toSign, 'utf8').digest('hex');
    const expected = Buffer.from(expectedHex, 'hex');
    let sawCandidate = false;

    for (const token of signatureHeader.split(' ')) {
        const [version, receivedHex] = token.split(',');
        if (version !== 'v1' || !receivedHex) continue;
        sawCandidate = true;
        try {
            if (timingSafeEqual(expected, Buffer.from(receivedHex, 'hex'))) {
                return true;
            }
        } catch {
            continue;
        }
    }

    if (!sawCandidate) return false;
    // At least one usable v1 signature was present, but none matched.
    return false;
}

// Kelviq payloads use snake_case + nested objects. Schema is intentionally
// permissive (all fields optional) so a payload we don't recognize doesn't
// 400 — we want to claim the event for idempotency and just log unknown types.
const planSchema = z.object({
    identifier: z.string().optional(),
}).partial();

const customerSchema = z.object({
    id: z.string().optional(),
    customerId: z.string().optional(),
    customer_id: z.string().optional(),
}).partial();

const subscriptionObjectSchema = z.object({
    id: z.string().optional(),
    customer_id: z.string().optional(),
    status: z.string().optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    amount_units: z.number().optional(),
    currency: z.string().optional(),
    end_date: z.string().nullable().optional(),
    billing_period_start_time: z.string().optional(),
    billing_period_end_time: z.string().optional(),
    modified_on: z.string().optional(),
    plan: planSchema.optional(),
    customer: z.union([customerSchema, z.string()]).optional(),
}).passthrough();

const checkoutObjectSchema = z.object({
    customer_id: z.string().optional(),
}).passthrough();

const customerObjectSchema = z.object({
    id: z.string().optional(),
    customerId: z.string().optional(),
    customer_id: z.string().optional(),
}).passthrough();

const invoiceObjectSchema = z.object({
    id: z.string().optional(),
    customer_id: z.string().optional(),
    status: z.string().optional(),
    amount_total_units: z.number().optional(),
    amount_total: z.union([z.string(), z.number()]).optional(),
    currency: z.string().optional(),
}).passthrough();

const orderObjectSchema = z.object({
    id: z.string().optional(),
    customer_id: z.string().optional(),
    customer: z.union([customerSchema, z.string()]).optional(),
}).passthrough();

const eventDataSchema = z.object({
    object: z.unknown(),
    previous_attributes: z.unknown().optional(),
});

const webhookPayloadSchema = z.object({
    id: z.string().optional(),
    type: z.string(),
    created_at: z.string().optional(),
    data: eventDataSchema,
});

type SubscriptionObject = z.infer<typeof subscriptionObjectSchema>;

interface NormalizedSub {
    kelviqSubId: string | null;
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | null;
    planCode: PlanCode | null;
    unitPriceCents: number | null;
    currency: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    kelviqObjectUpdatedAt: string;
}

function normalizeSubscription(obj: SubscriptionObject): NormalizedSub {
    // Kelviq returns price in two forms; prefer integer cents (amount_units), fall back to string-dollars.
    let unitPriceCents: number | null = null;
    if (typeof obj.amount_units === 'number') {
        unitPriceCents = obj.amount_units;
    } else if (obj.amount != null) {
        const dollars = typeof obj.amount === 'string' ? parseFloat(obj.amount) : obj.amount;
        if (!isNaN(dollars)) unitPriceCents = Math.round(dollars * 100);
    }

    // Kelviq has no cancel_at_period_end field. Infer: scheduled-cancel = status 'active' AND end_date set.
    const cancelAtPeriodEnd = obj.status === 'active' && !!obj.end_date;

    // Normalize status to our enum. Kelviq uses 'canceled' (American) on the object even though
    // the event type uses 'cancelled' (British). Lowercase defensively for mixed-case payloads.
    const statusRaw = obj.status?.toLowerCase();
    let status: NormalizedSub['status'] = null;
    if (statusRaw === 'active' || statusRaw === 'trialing' || statusRaw === 'past_due' || statusRaw === 'canceled') {
        status = statusRaw;
    }

    return {
        kelviqSubId: obj.id ?? null,
        status,
        planCode: PLAN_CODE_MAP[obj.plan?.identifier ?? ''] ?? null,
        unitPriceCents,
        currency: (obj.currency ?? 'usd').toLowerCase(),
        currentPeriodEnd: obj.billing_period_end_time ?? null,
        cancelAtPeriodEnd,
        // Kelviq subscription objects don't have an updatedAt; modified_on is the closest
        // monotonic stamp. Falls back to billing_period_start_time, then now().
        kelviqObjectUpdatedAt: obj.modified_on
            ?? obj.billing_period_start_time
            ?? new Date().toISOString(),
    };
}

// Customer reference can live in different places depending on the event type.
function extractCustomerRef(eventType: string, dataObject: unknown): string | null {
    const obj = dataObject as Record<string, unknown> | null;
    if (!obj) return null;
    const nestedCustomer = obj.customer as {
        id?: string;
        customerId?: string;
        customer_id?: string;
    } | undefined;
    if (eventType === EVENTS.CHECKOUT_COMPLETED || eventType.startsWith('invoice.')) {
        return (
            (obj.customer_id as string | undefined)
            ?? nestedCustomer?.id
            ?? nestedCustomer?.customer_id
            ?? null
        );
    }
    // subscription.* — prefer Kelviq internal UUID (customer.id) over opaque customer_id.
    return (
        (obj.customer_id as string | undefined)
        ?? nestedCustomer?.id
        ?? nestedCustomer?.customer_id
        ?? nestedCustomer?.customerId
        ?? null
    );
}

type ParsedKelviqCustomer = z.infer<typeof customerSchema>;

function parseKelviqCustomerField(
    customer: ParsedKelviqCustomer | string | undefined,
): ParsedKelviqCustomer | null {
    if (!customer) return null;
    if (typeof customer === 'string') return { id: customer };
    return customer;
}

function externalCustomerIdFromNested(
    customer: ParsedKelviqCustomer | string | undefined,
): string | null {
    const parsed = parseKelviqCustomerField(customer);
    if (!parsed) return null;
    return parsed.customerId ?? parsed.customer_id ?? null;
}

function internalCustomerIdFromNested(
    customer: ParsedKelviqCustomer | string | undefined,
): string | null {
    const parsed = parseKelviqCustomerField(customer);
    return parsed?.id ?? null;
}

async function upsertSubscription(workspaceId: string, sub: NormalizedSub): Promise<void> {
    if (!sub.planCode || !sub.status) {
        console.warn(`[webhook] Skipping upsert — missing planCode or status (got plan=${sub.planCode}, status=${sub.status})`);
        return;
    }
    await query(
        `INSERT INTO ${SCHEMA}.workspace_subscriptions
             (workspace_id, plan_code, status, kelviq_subscription_id, unit_price_cents, currency,
              current_period_end, cancel_at_period_end, kelviq_object_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (workspace_id) WHERE status <> 'canceled'
         DO UPDATE SET
             plan_code               = EXCLUDED.plan_code,
             status                  = EXCLUDED.status,
             kelviq_subscription_id  = EXCLUDED.kelviq_subscription_id,
             unit_price_cents        = COALESCE(EXCLUDED.unit_price_cents, workspace_subscriptions.unit_price_cents),
             currency                = COALESCE(EXCLUDED.currency, workspace_subscriptions.currency),
             current_period_end      = COALESCE(EXCLUDED.current_period_end, workspace_subscriptions.current_period_end),
             cancel_at_period_end    = EXCLUDED.cancel_at_period_end,
             kelviq_object_updated_at = EXCLUDED.kelviq_object_updated_at,
             updated_at              = NOW()
         WHERE workspace_subscriptions.kelviq_object_updated_at IS NULL
            OR workspace_subscriptions.kelviq_object_updated_at <= EXCLUDED.kelviq_object_updated_at`,
        [
            workspaceId,
            sub.planCode,
            sub.status,
            sub.kelviqSubId,
            sub.unitPriceCents,
            sub.currency,
            sub.currentPeriodEnd,
            sub.cancelAtPeriodEnd,
            sub.kelviqObjectUpdatedAt,
        ],
    );
}

async function handleSubscriptionLifecycle(
    eventType: string,
    dataObject: unknown,
): Promise<string | null> {
    const parsed = subscriptionObjectSchema.safeParse(dataObject);
    if (!parsed.success) {
        console.warn(`[webhook] ${eventType}: object failed schema parse`, parsed.error.message);
        return null;
    }
    const sub = parsed.data;
    const customerRef = extractCustomerRef(eventType, sub);
    const workspaceId = await resolveWorkspaceIdForBillingEvent(
        customerRef,
        externalCustomerIdFromNested(sub.customer),
    );
    if (!workspaceId) {
        console.warn(
            `[webhook] ${eventType}: no workspace for customer ref "${customerRef}"`
            + (externalCustomerIdFromNested(sub.customer)
                ? ` (external=${externalCustomerIdFromNested(sub.customer)})`
                : ''),
        );
        return null;
    }

    const internalFromEvent = internalCustomerIdFromNested(sub.customer);
    if (internalFromEvent && internalFromEvent !== workspaceId) {
        await ensureBillingCustomerKelviqRefs(workspaceId, internalFromEvent);
    } else if (customerRef && customerRef !== workspaceId) {
        await ensureBillingCustomerKelviqRefs(workspaceId, customerRef);
    }

    const normalized = normalizeSubscription(sub);

    if (eventType === EVENTS.SUB_CANCELLED || normalized.status === 'canceled') {
        // Cancellation event arrived. Two cases:
        // 1. The user clicked Cancel Plan in OneWork (deferred-cancel pattern). Our
        //    cancel route already set cancel_at_period_end=true with status='active'.
        //    Kelviq's own cancel is now telling us what we already know. We must NOT
        //    flip status to 'canceled' here — that would destroy the deferred-access
        //    window. Just bump kelviq_object_updated_at for monotonicity and let
        //    expireDeferredCancels in lib/billing/subscription.ts flip the row when
        //    current_period_end passes.
        // 2. Cancellation initiated outside OneWork (Kelviq dashboard, etc.). Apply
        //    the cancel immediately, no deferred window.
        const localRow = await query<{
            plan_code: PlanCode;
            status: string;
            cancel_at_period_end: boolean;
            current_period_end: string | null;
        }>(
            `SELECT plan_code, status, cancel_at_period_end, current_period_end
             FROM ${SCHEMA}.workspace_subscriptions
             WHERE workspace_id = $1 AND status NOT IN ('basic', 'canceled')
             LIMIT 1`,
            [workspaceId],
        );
        const local = localRow.rows[0];
        const isDeferredCancel = !!local
            && local.cancel_at_period_end === true
            && !!local.current_period_end
            && new Date(local.current_period_end).getTime() > Date.now();

        if (isDeferredCancel) {
            // Bump the monotonicity stamp only — keep status, plan, cancel flags intact.
            await query(
                `UPDATE ${SCHEMA}.workspace_subscriptions
                 SET kelviq_object_updated_at = $2,
                     updated_at = NOW()
                 WHERE workspace_id = $1 AND status NOT IN ('basic', 'canceled')
                   AND (kelviq_object_updated_at IS NULL OR kelviq_object_updated_at <= $2)`,
                [workspaceId, normalized.kelviqObjectUpdatedAt],
            );
            // Don't fire the "Subscription canceled" notification yet — wait until the
            // deferred window actually expires (or fire it from a future scheduled job).
            return workspaceId;
        }

        // True cancellation. Update status, set cancel_reason.
        await query(
            `UPDATE ${SCHEMA}.workspace_subscriptions
             SET status = 'canceled',
                 cancel_reason = COALESCE(cancel_reason, 'voluntary'),
                 kelviq_object_updated_at = $2,
                 updated_at = NOW()
             WHERE workspace_id = $1 AND status NOT IN ('basic', 'canceled')
               AND (kelviq_object_updated_at IS NULL OR kelviq_object_updated_at <= $2)`,
            [workspaceId, normalized.kelviqObjectUpdatedAt],
        );
        await notifyWorkspaceAdmins(
            workspaceId,
            'Subscription canceled',
            'Your subscription has ended. Your workspace is now on the Basic plan.',
        );
        if (local) {
            await maybeRevokeCliTokensOnBillingChange(
                workspaceId,
                local.plan_code,
                local.status,
                local.plan_code,
                'canceled',
            );
        }
        // Workspace just dropped to Basic — start the quota grace window if it's
        // now over the Basic limits.
        await evaluateQuotaGrace(workspaceId);
        return workspaceId;
    }

    // Recovery / activation / plan change / period roll → upsert active state.
    const previousStatus = await query<{ status: string }>(
        `SELECT status FROM ${SCHEMA}.workspace_subscriptions
         WHERE workspace_id = $1 AND status NOT IN ('basic', 'canceled') LIMIT 1`,
        [workspaceId],
    );
    const wasPastDue = previousStatus.rows[0]?.status === 'past_due';

    const previousSub = await query<{ plan_code: PlanCode; status: string }>(
        `SELECT plan_code, status FROM ${SCHEMA}.workspace_subscriptions
         WHERE workspace_id = $1 AND status NOT IN ('basic', 'canceled')
         LIMIT 1`,
        [workspaceId],
    );
    const prev = previousSub.rows[0];

    await upsertSubscription(workspaceId, normalized);

    if (normalized.planCode && normalized.status) {
        await maybeRevokeCliTokensOnBillingChange(
            workspaceId,
            prev?.plan_code,
            prev?.status,
            normalized.planCode,
            normalized.status,
        );
    }

    if (eventType === EVENTS.SUB_CREATED) {
        await notifyWorkspaceAdmins(
            workspaceId,
            'Subscription activated',
            'Your paid plan is now active. Thank you!',
        );
    } else if (wasPastDue && normalized.status === 'active') {
        await notifyWorkspaceAdmins(
            workspaceId,
            'Payment recovered',
            'Your subscription is active again. All features have been restored.',
        );
    } else if (eventType === EVENTS.SUB_PLAN_CHANGED) {
        await notifyWorkspaceAdmins(
            workspaceId,
            'Plan changed',
            'Your subscription plan has been updated.',
        );
    }

    // Re-evaluate quota after any activation / plan change: starts a grace
    // window on a downgrade, or clears grace + unlocks resources on an upgrade
    // whose new limits once again cover current usage.
    await evaluateQuotaGrace(workspaceId);

    return workspaceId;
}

async function handleCustomerEvent(dataObject: unknown): Promise<string | null> {
    const parsed = customerObjectSchema.safeParse(dataObject);
    if (!parsed.success) return null;
    const raw = dataObject as Record<string, unknown>;
    const internalId = (
        parsed.data.id
        ?? (raw.id as string | undefined)
    )?.trim();
    const externalId = (
        parsed.data.customerId
        ?? parsed.data.customer_id
        ?? (raw.customerId as string | undefined)
        ?? (raw.customer_id as string | undefined)
    )?.trim();
    if (!internalId || !externalId) return null;
    if (!await workspaceExists(externalId)) return null;
    await ensureBillingCustomerKelviqRefs(externalId, internalId);
    return externalId;
}

async function handleCheckoutCompleted(dataObject: unknown): Promise<string | null> {
    // checkout.completed carries customer_id but not the full sub object — Kelviq fires
    // subscription.created right after for the same customer. We log the event for the
    // audit trail and let subscription.created do the actual upsert.
    const parsed = checkoutObjectSchema.safeParse(dataObject);
    if (!parsed.success) return null;

    const workspaceFromUrl = extractWorkspaceIdFromCheckoutObject(dataObject);
    if (workspaceFromUrl && await workspaceExists(workspaceFromUrl)) {
        const ref =
            parsed.data.customer_id
            ?? extractCustomerRef(EVENTS.CHECKOUT_COMPLETED, dataObject);
        if (ref) {
            await ensureBillingCustomerKelviqRefs(workspaceFromUrl, ref);
        }
        return workspaceFromUrl;
    }

    const ref =
        parsed.data.customer_id
        ?? extractCustomerRef(EVENTS.CHECKOUT_COMPLETED, dataObject);
    return ref ? await resolveWorkspaceIdForBillingEvent(ref, ref) : null;
}

async function handleOrderEvent(dataObject: unknown): Promise<string | null> {
    // Order events are audit-only; subscription.created performs the plan upsert.
    const parsed = orderObjectSchema.safeParse(dataObject);
    if (!parsed.success) return null;
    const customerRef = extractCustomerRef(EVENTS.ORDER_CREATED, dataObject);
    return resolveWorkspaceIdForBillingEvent(
        customerRef,
        externalCustomerIdFromNested(
            typeof parsed.data.customer === 'string'
                ? { id: parsed.data.customer }
                : parsed.data.customer,
        ),
    );
}

async function handleInvoiceEvent(dataObject: unknown): Promise<string | null> {
    // Invoice events are accepted for the audit trail (billing_events) but do not yet
    // write to billing_invoices. The "Manage Billing" portal flow is the canonical UX
    // for invoices today. Enable inline rendering by adding an UPSERT here against
    // billing_invoices when product wants it. See docs/billing-deferred-work.md.
    const parsed = invoiceObjectSchema.safeParse(dataObject);
    if (!parsed.success) return null;
    const ref =
        parsed.data.customer_id
        ?? extractCustomerRef('invoice.created', dataObject);
    return ref ? await resolveWorkspaceIdForBillingEvent(ref, ref) : null;
}

export async function POST(request: Request) {
    const webhookId = request.headers.get('webhook-id') ?? '';
    const webhookTimestamp = request.headers.get('webhook-timestamp') ?? '';
    const webhookSignature = request.headers.get('webhook-signature') ?? '';
    const rawBody = await request.text();

    const secret = process.env.KELVIQ_WEBHOOK_SECRET;
    if (!secret) {
        console.error('KELVIQ_WEBHOOK_SECRET is not set');
        return NextResponse.json({ error: 'Configuration error' }, { status: 500 });
    }

    // Replay-attack guard: reject events older/newer than 5 minutes
    const tsSeconds = parseInt(webhookTimestamp, 10);
    if (!isNaN(tsSeconds)) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (Math.abs(nowSeconds - tsSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
            return NextResponse.json({ error: 'Webhook timestamp out of range' }, { status: 400 });
        }
    }

    if (!verifySignature(webhookId, webhookTimestamp, rawBody, webhookSignature, secret)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let rawPayload: unknown;
    try {
        rawPayload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = webhookPayloadSchema.safeParse(rawPayload);
    if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid payload shape' }, { status: 400 });
    }

    const { type, data, id: eventId } = parsed.data;
    // Prefer payload-level event id; fall back to webhook-id header (they should match).
    const idempotencyKey = eventId || webhookId;

    // Authoritative idempotency: claim the event before processing.
    // ON CONFLICT DO NOTHING RETURNING means only one concurrent request proceeds.
    let claimedEventId: string | null = null;
    if (idempotencyKey) {
        const inserted = await query<{ id: string }>(
            `INSERT INTO ${SCHEMA}.billing_events (kelviq_event_id, event_type, payload)
             VALUES ($1, $2, $3)
             ON CONFLICT (kelviq_event_id) DO NOTHING
             RETURNING id`,
            [idempotencyKey, type, JSON.stringify(rawPayload)],
        );
        if (inserted.rows.length === 0) {
            return NextResponse.json({ received: true }); // already processed
        }
        claimedEventId = inserted.rows[0].id;
    }

    try {
        let workspaceId: string | null = null;

        if (type === EVENTS.CUSTOMER_CREATED || type === EVENTS.CUSTOMER_UPDATED) {
            workspaceId = await handleCustomerEvent(data.object);
        } else if (
            type === EVENTS.SUB_CREATED
            || type === EVENTS.SUB_UPDATED
            || type === EVENTS.SUB_CANCELLED
            || type === EVENTS.SUB_PLAN_CHANGED
        ) {
            workspaceId = await handleSubscriptionLifecycle(type, data.object);
        } else if (type === EVENTS.CHECKOUT_COMPLETED) {
            workspaceId = await handleCheckoutCompleted(data.object);
        } else if (type === EVENTS.INVOICE_CREATED || type === EVENTS.INVOICE_PAID) {
            workspaceId = await handleInvoiceEvent(data.object);
        } else if (type === EVENTS.ORDER_CREATED || type === EVENTS.ORDER_UPDATED) {
            workspaceId = await handleOrderEvent(data.object);
        } else {
            // refund.*, feature.usage_alert — logged for audit, no action yet.
            console.log(`[webhook] Unhandled event type "${type}"`);
        }

        // NOTE: Kelviq's documented event catalog has no "payment_failed" event.
        // The past_due signal will need to come from subscription.updated with
        // status='past_due', OR from invoice.created going unpaid past due_date.
        // Past-due UX is currently inert at the webhook layer — see
        // docs/billing-deferred-work.md.

        if (claimedEventId && workspaceId) {
            await query(
                `UPDATE ${SCHEMA}.billing_events SET workspace_id = $2 WHERE id = $1`,
                [claimedEventId, workspaceId],
            );
        }

        return NextResponse.json({ received: true });
    } catch (error) {
        // Remove the claimed event so Kelviq can retry on next delivery
        if (claimedEventId) {
            await query(
                `DELETE FROM ${SCHEMA}.billing_events WHERE id = $1`,
                [claimedEventId],
            );
        }
        console.error('[webhook] Processing error:', error);
        return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
    }
}
