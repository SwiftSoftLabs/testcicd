# Vault CLI migration 006 — deploy checklist

**Migration:** [`scripts/migrations/006_vault_cli_token_security.sql`](../scripts/migrations/006_vault_cli_token_security.sql)

## Before deploy

1. Run migration `006` on `app_onework` **before** shipping the app build that uses `token_lookup` and HMAC-indexed verification.
2. Expect **all existing CLI tokens** (rows without `token_lookup`) to be **revoked** automatically.

## After deploy

- Users must **create new CLI tokens** in Vault (format prefix `ow_`).
- New tokens support optional **environment allowlists** and shorter default TTL (30 days; members max 90d, admins 365d).
- In-memory rate limits apply per server instance (not global across Vercel lambdas).

## PR #68 verification

- Unit: `npm run test:vault-tier` (includes plan-tier, cli-scope, cli-token-lookup where configured).
- Manual: admin Pro sync targets; Pro member sees admin-only sync message (no error toast); post-migration CLI pull with new token.
