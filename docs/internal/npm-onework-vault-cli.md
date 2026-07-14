# npm: @swiftsoftlabs/onework-vault-cli

Internal runbook for publishing and maintaining the OneWork Vault CLI on the public npm registry.

## Package

| Field | Value |
|-------|-------|
| npm name | `@swiftsoftlabs/onework-vault-cli` |
| Global binary | `onework` |
| Source | `packages/onework-cli/` |
| CI workflow | `.github/workflows/publish-onework-vault-cli.yml` |

**Do not document or install bare `onework` on npm** — another maintainer owns that name.

## Team roster

| Role | Name | Email |
|------|------|-------|
| Primary org owner / first publisher | Mac Reyes | mac.reyes@swiftsoftlabs.com |
| Second maintainer | Zohan | zohan@swiftsoftlabs.com |
| Shared ops email | — | Not available yet (v1) |

## One-time npm org setup (Mac only)

1. Sign in at [npmjs.com](https://www.npmjs.com) as **mac.reyes@swiftsoftlabs.com**
2. Enable **2FA** (WebAuthn/passkey)
3. Profile → **Add an Organization** → name `swiftsoftlabs` → **Unlimited public packages** (free)
4. Invite **zohan@swiftsoftlabs.com** (owner or developer with publish rights)
5. Zohan accepts invite and enables 2FA

## First publish (Mac only — required before CI OIDC)

The package must exist on npm before Trusted Publisher can be linked.

```bash
cd packages/onework-cli
npm login    # mac.reyes@swiftsoftlabs.com
npm run build
npm publish --access public --tag alpha --otp=123456   # 6-digit code from your 2FA app
```

**403 "Two-factor authentication ... is required"?** npm blocks publishes without 2FA on the account (or without an OTP at publish time).

1. [npmjs.com](https://www.npmjs.com) → avatar → **Account** → **Two-Factor Authentication** → enable **Authorization and publishing** (passkey or authenticator app).
2. Retry publish and pass the current code: `--otp=XXXXXX` (replace with the 6 digits from your app).
3. Do **not** use a read-only token for publish; session login + OTP is enough for manual first publish.

Expected version for first publish: `0.1.0-alpha.0` (see `package.json`).

## Trusted Publishing (Mac only — after first publish)

1. npmjs.com → `@swiftsoftlabs/onework-vault-cli` → **Settings** → **Trusted Publisher**
2. Provider: **GitHub Actions**
3. Repository: `SwiftSoftLabs/OneWork`
4. Workflow file: `publish-onework-vault-cli.yml`
5. Save

Subsequent releases: GitHub **Actions** → **Publish onework-vault-cli** → **Run workflow**, or push tag `onework-vault-cli-v0.1.0`.

No long-lived `NPM_TOKEN` in GitHub secrets when OIDC is configured.

## Promote alpha → latest

1. Bump version in `packages/onework-cli/package.json` to `0.1.0`
2. Merge to main
3. Run workflow with dist-tag `latest`, or:

```bash
cd packages/onework-cli
npm publish --access public --tag latest
```

## Verification

```bash
npm view @swiftsoftlabs/onework-vault-cli version
npm install -g @swiftsoftlabs/onework-vault-cli
onework --version

export ONEWORK_TOKEN=<from-vault-ui>
export ONEWORK_API_URL=https://app.onework.dev
onework env --project <project-id> --env development
```

Vault UI **CLI usage** modal should show `npm install -g @swiftsoftlabs/onework-vault-cli`.

## Rollback / rename

npm names cannot be renamed. Options:

- **Within 72h, no dependents:** `npm unpublish @swiftsoftlabs/onework-vault-cli --force`
- **After adoption:** `npm deprecate @swiftsoftlabs/onework-vault-cli "message"` + publish under a new name

## End-user auth (not npm)

Users need `ONEWORK_TOKEN` from Vault UI and optionally `ONEWORK_API_URL` (defaults to `https://app.onework.dev` in CLI). This is unrelated to npm publish credentials.

## Mac checklist (copy-paste)

1. npmjs.com → mac.reyes@swiftsoftlabs.com → 2FA
2. Create org `swiftsoftlabs`
3. Invite zohan@swiftsoftlabs.com
4. `cd packages/onework-cli && npm login && npm run build && npm publish --access public --tag alpha`
5. Configure Trusted Publisher → `SwiftSoftLabs/OneWork` / `publish-onework-vault-cli.yml`
6. `npm i -g @swiftsoftlabs/onework-vault-cli && onework --version`
7. Confirm Vault UI CLI usage + test with `ONEWORK_TOKEN`
