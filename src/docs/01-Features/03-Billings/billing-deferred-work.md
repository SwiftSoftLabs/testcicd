# Billing — Deferred Work

Items the billing integration depends on but couldn't be completed in the Phase 2/3/4 cut because of upstream (Kelviq) gaps. Each entry lists what's missing, what we shipped instead, and the exact code touch-points to revisit once the upstream issue is resolved.

## 0. Multi-workspace checkout (same user, multiple upgrades) — RESOLVED (Phase 1)

**Problem:** Second workspace upgrade 500s when Kelviq returns `email` already exists — we POST the login email for every workspace customer.

**Fix (OneWork-only, shipped):** Workspace-scoped Kelviq email via `src/lib/billing/kelviq-customer-email.ts`; hardened `createOrGetCustomer` in `src/lib/integrations/kelviq/client.ts`; checkout wired in `src/app/api/billing/checkout/route.ts`. Full plan: [plans/multi-workspace-kelviq-billing.md](plans/multi-workspace-kelviq-billing.md). Branch: `fix/multi-workspace-kelviq-customer`. Existing paid workspaces unchanged (checkout skips create when `kelviq_customer_id` is set).

## 1. Period-end subscription cancel + Resume flow

**Current behavior:** Cancel Plan delivers period-end UX *locally* via a deferred-cancel pattern even though Kelviq has no native period-end cancel. On click, we call Kelviq with `IMMEDIATE` (their only option, which stops billing right away) but keep `status='active'` with `cancel_at_period_end=true` and `cancel_reason='voluntary'` in our DB. The user keeps Pro entitlements until `current_period_end` passes. A lazy-expiry check in [src/lib/billing/subscription.ts](../src/lib/billing/subscription.ts) (`expireDeferredCancels`) flips the local row to `'canceled'` on the first read after the period elapses. Resume button stays hidden — Kelviq's sub is already gone, so "resume" would require a fresh checkout.

**Known UX wart:** the Kelviq Customer Portal shows the sub as already canceled while OneWork shows "Cancels on \<date\>". A blue info banner near the cancel-pending UI explains this is expected, and a one-line note appears next to the "Manage Billing" button when `cancel_at_period_end=true`.

**Why this workaround:** Kelviq sandbox's `POST /subscriptions/{id}/cancel/` requires a `cancellationType` field. We exhaustively probed plausible period-end values (`PERIOD_END`, `END_OF_BILLING_PERIOD`, `AT_PERIOD_END`, `NEXT_BILLING_DATE`, `DO_NOT_RENEW`, ~25 in total) — all returned `400 "not a valid choice"`. Only `IMMEDIATE` is accepted. Kelviq's OpenAPI spec at `/api/schema/` does not document this field at all.

**What to do when Kelviq exposes period-end cancel:**
1. Get the valid period-end `cancellationType` value from Kelviq support / docs.
2. [src/lib/integrations/kelviq/client.ts](../src/lib/integrations/kelviq/client.ts) — `cancelSubscription`: replace `IMMEDIATE` with the period-end value. Kelviq itself will now schedule the cancel.
3. [src/app/api/billing/subscription/cancel/route.ts](../src/app/api/billing/subscription/cancel/route.ts) — DB UPDATE stays the same (`cancel_at_period_end=true`), but the Kelviq portal mismatch goes away.
4. [src/components/settings/BillingSettings.tsx](../src/components/settings/BillingSettings.tsx) — remove the "Kelviq's billing portal may show this subscription as already canceled" sentence from the confirm dialog and the blue info banner; remove the inline note next to Manage Billing.
5. **Resume:** if Kelviq's resume contract (`POST /subscriptions/{id}/resume/`) is verified working, set `RESUME_ENABLED = true` and update the `handleResume` route to clear `cancel_at_period_end` without needing a fresh checkout. Until then, leave Resume hidden.
6. [src/lib/billing/subscription.ts](../src/lib/billing/subscription.ts) — `expireDeferredCancels` can stay as a safety net for any rows where Kelviq's webhook is late.

## 2. Invoices and Payment Methods — RESOLVED via Customer Portal

**Resolved:** Kelviq doesn't expose invoices or payment methods as JSON endpoints. Their model is to redirect customers to a hosted **Customer Portal**. BillingSettings now shows a "Manage Billing" button (for paid owner/admins) that mints a portal session via [src/app/api/billing/portal/route.ts](../src/app/api/billing/portal/route.ts) and opens it in a new tab.

The stubs in [src/lib/integrations/kelviq/client.ts](../src/lib/integrations/kelviq/client.ts) — `listInvoices` and `listPaymentMethods` — are kept as `[]` returns because the data tables (`billing_invoices`, `workspace_payment_methods`) have no upstream writer in this model. The legacy inline rendering for those tables is preserved behind `summary.invoices.length > 0` / `summary.paymentMethods.length > 0` guards in case a future webhook handler populates them.

If product later wants invoices/payment methods rendered inline (not in Kelviq's portal), the only known data source is **Stripe directly** via the `stripeCustomerId` Kelviq attaches to each customer's `details` block — that would need a Stripe SDK integration.

## 3. Webhook registration

**Current behavior in dev/sandbox:** Wired and verified end-to-end via a cloudflared tunnel against the Kelviq sandbox dashboard. Signature verification, idempotency, `subscription.created` → DB upsert, and admin notifications all confirmed working.

**What's still needed for production:**
1. Register the production webhook URL (the deployed origin + `/api/billing/kelviq/webhook`) in the **live** Kelviq dashboard.
2. Populate the production `KELVIQ_WEBHOOK_SECRET` env var.
3. Subscribe to (at minimum): `subscription.created`, `subscription.updated`, `subscription.cancelled`, `subscription.plan_changed`, `checkout.completed`, `invoice.created`, `invoice.paid`.

**Known gaps to revisit:**

- **No `payment_failed` event exists in Kelviq's catalog.** The past-due signal currently has no source. The TODO in the webhook handler notes this; a fix likely requires watching `subscription.updated` for a `status='past_due'` change, or `invoice.created` aging past `due_date`. Confirm with Kelviq support which signal to rely on.
- **Audit-log `workspace_id=NULL` for mismatched customer IDs — RESOLVED (Phase 2).** Shipped: `kelviq_customer_internal_id`, external `kelviq_customer_id` = workspace UUID, dual lookup in [webhook/route.ts](../src/app/api/billing/kelviq/webhook/route.ts), backfill [scripts/backfill-kelviq-customer-ids.ts](../scripts/backfill-kelviq-customer-ids.ts). Deploy: run [sql/billing_customer_id_phase2_migration.sql](../sql/billing_customer_id_phase2_migration.sql) then backfill before app.
- **Past-due UX is inert.** The BillingSettings "Payment past due" banner exists but nothing flips `status='past_due'` today. Wire it to the same signal we end up using for payment failure (per above).
- **No invoice/payment-method writes from `invoice.*` events.** `handleInvoiceEvent` resolves the workspace (when the customer-id fix lands) but doesn't write to `billing_invoices`. Add an UPSERT there if/when product wants inline invoice rendering instead of the Customer Portal redirect.

The reconciliation endpoint at [src/app/api/billing/reconcile/route.ts](../src/app/api/billing/reconcile/route.ts) is the safety net for any drift.

## 4. `changeSubscriptionPlan` (mid-cycle upgrades)

**Current behavior:** No mid-cycle upgrade/downgrade in the UI. Upgrades route through a new checkout session.

**Why removed:** The helper that was here had the same camelCase-vs-snake-case + body-shape risk as the cancel helper. Rather than ship code we knew was probably broken, it was deleted. Reinstate when there's a real upgrade UI to drive it, and verify the `PATCH /subscriptions/{id}/` contract end-to-end against Kelviq first.

## 5. Workspace deletion happy path

**Current behavior:** Deleting a workspace with an active paid subscription returns `502` because the underlying `cancelSubscription` now succeeds with IMMEDIATE — so this is actually unblocked. Re-run Section 5B of the test plan to confirm: workspace deletes cleanly, Kelviq sub flips to `canceled`, workspace row gone.

## Lessons from the Kelviq integration (for future API work)

- **The OpenAPI schema at `/api/schema/` is incomplete.** The `cancellationType` field is required but undocumented. Don't trust the schema as ground truth; probe the live API with `400`-triggering requests to find required fields.
- **Mixed casing convention.** Request bodies and response bodies use **camelCase**, but query-string filters use **snake_case** (`?customer_id=`, not `?customerId=`). The list endpoints silently return `count: 0` rather than rejecting unknown filters, so this is invisible until you cross-check against a known-populated dataset.
- **Response field-shape mismatches.** Kelviq subscriptions return `plan.identifier` (nested), `billingPeriodEndTime`, `amount` (string dollars), uppercase `currency`, and no `updatedAt` / `cancelAtPeriodEnd` fields. The mapping lives in [src/lib/integrations/kelviq/client.ts](../src/lib/integrations/kelviq/client.ts) `mapSubscription`.
- **Sandbox base URL is separate.** `https://sandboxapi.kelviq.com/api/v1` for sandbox, `https://api.kelviq.com/api/v1` for live. Same API key won't work across both — keys are environment-scoped.
