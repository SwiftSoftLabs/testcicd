export type PlanCode = 'basic' | 'pro' | 'max' | 'enterprise';

export type SubscriptionStatus = 'basic' | 'pending' | 'active' | 'past_due' | 'canceled' | 'trialing' | 'manual';

export type AnalyticsLevel = 'none' | 'basic' | 'full_ai' | 'custom';

export type AiTier = 'none' | 'task_intel' | 'full_suite' | 'dedicated';

export type SupportTier = 'community' | 'priority_email' | 'slack_24_7' | 'dedicated_lead';

export interface BillingPlan {
    code: PlanCode;
    name: string;
    price_cents: number | null;
    currency: string;
    interval: 'month' | 'year';
    kelviq_variant_id: string | null;
    max_projects: number | null;
    max_seats: number | null;
    max_channels: number | null;
    max_inboxes_per_user: number | null;
    max_storage_bytes: number;
    max_call_minutes_monthly: number | null;
    max_call_duration_minutes: number | null;
    analytics_level: AnalyticsLevel;
    ai_tier: AiTier;
    support_tier: SupportTier;
    contact_sales: boolean;
    is_active: boolean;
    sort_order: number;
}

export interface WorkspaceSubscription {
    id: string;
    workspace_id: string;
    plan_code: PlanCode;
    kelviq_subscription_id: string | null;
    status: SubscriptionStatus;
    unit_price_cents: number | null;
    currency: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    cancel_reason: string | null;
    trial_ends_at: string | null;
    kelviq_object_updated_at: string | null;
    quota_grace_until: string | null;
    created_at: string;
    updated_at: string;
}

export interface BillingCustomer {
    id: string;
    workspace_id: string;
    /** External ref: workspace UUID sent to Kelviq as customerId */
    kelviq_customer_id: string | null;
    /** Kelviq internal customer UUID for API/portal calls */
    kelviq_customer_internal_id: string | null;
    billing_email: string | null;
    created_at: string;
    updated_at: string;
}

export interface PaymentMethod {
    id: string;
    workspace_id: string;
    kelviq_pm_id: string;
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    is_default: boolean;
}

export interface Invoice {
    id: string;
    workspace_id: string;
    kelviq_invoice_id: string;
    number: string | null;
    amount_cents: number;
    currency: string;
    status: string;
    hosted_url: string | null;
    issued_at: string | null;
}

export interface Entitlements {
    plan_code: PlanCode;
    max_projects: number | null;
    max_seats: number | null;
    max_channels: number | null;
    max_inboxes_per_user: number | null;
    max_storage_bytes: number;
    max_call_minutes_monthly: number | null;
    max_call_duration_minutes: number | null;
    analytics_level: AnalyticsLevel;
    ai_tier: AiTier;
    support_tier: SupportTier;
    contact_sales: boolean;
}

export interface BillingUsage {
    projects: number;
    seats: number;
    channels: number;
    mail_accounts: number;
    current_user_mail_accounts: number;
    storage_bytes: number;
    call_minutes_used: number;
}

export type QuotaResourceKind = 'projects' | 'seats' | 'channels' | 'inboxes';

export interface OverQuotaResource {
    resource: QuotaResourceKind;
    used: number;
    limit: number;
    locked: number; // currently read-only (always 0 for seats — never auto-locked)
}

export interface OverQuotaState {
    planName: string;
    isOverQuota: boolean;
    graceUntil: string | null;
    graceExpired: boolean;
    resources: OverQuotaResource[];
}

export interface QuotaSelectionPayload {
    workspaceId: string;
    projects?: string[];
    channels?: string[];
}

export interface QuotaSelectableItem {
    id: string;
    name: string;
    created_at: string;
    quota_locked: boolean;
}

export interface BillingSummary {
    plans: BillingPlan[];
    plan: BillingPlan;
    subscription: WorkspaceSubscription;
    entitlements: Entitlements;
    usage: BillingUsage;
    overQuota: OverQuotaState;
    paymentMethods: PaymentMethod[];
    invoices: Invoice[];
    canManage: boolean;
    isOwnerOrAdmin: boolean;
}
