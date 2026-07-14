const TESTER_EMAILS: Set<string> = (() => {
    const raw = process.env.BILLING_TESTER_EMAILS ?? '';
    return new Set(raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
})();

export const PRE_LAUNCH_GATE = process.env.BILLING_PRE_LAUNCH === 'true';

export function isBillingTester(email: string): boolean {
    return TESTER_EMAILS.has(email.toLowerCase());
}
