# OneWork Version Control — VPS deployment

Internal engine: **Gitea** (never shown to users). Product name: **OneWork Version Control**.

## Quick deploy (Hetzner)

```bash
# From your machine (SSH key preferred; password auth also works)
scp -r services/onework-vc root@5.78.232.172:/tmp/onework-vc-src
ssh root@5.78.232.172 'bash /tmp/onework-vc-src/onework-vc/setup-vps.sh'
# Rootless image needs data/config owned by UID 1000 (setup-vps.sh handles this).
```

## Ports

| Port | Purpose |
|------|---------|
| 22 | Host SSH |
| 3001 | Gitea HTTP API + web UI (internal) |
| 2222 | Git SSH |

## OneWork app env

```bash
ONEWORK_VC_GITEA_URL=http://5.78.232.172:3001
ONEWORK_VC_ADMIN_TOKEN=<admin API token from Gitea>
ONEWORK_VC_ADMIN_PASSWORD=<Gitea admin account password>
ONEWORK_VC_GIT_SSH_HOST=5.78.232.172
ONEWORK_VC_GIT_SSH_PORT=2222
```

## First-run bootstrap

1. Visit `http://5.78.232.172:3001` → create admin account.
2. **Site Administration → Applications → Generate New Token** (all scopes).
3. Paste token into `ONEWORK_VC_ADMIN_TOKEN` and admin password into `ONEWORK_VC_ADMIN_PASSWORD`.
4. Verify: `curl -H "Authorization: token $TOKEN" $ONEWORK_VC_GITEA_URL/api/v1/version`

Registration is disabled in compose; OneWork provisions users via Admin API.

## Domain migration (later)

1. DNS A record → VPS IP.
2. Add Caddy/nginx with TLS on 443.
3. Update Gitea `ROOT_URL` and `ONEWORK_VC_GITEA_URL`.
4. Update clone URL helpers (env-only change).

## Secret rotation

1. Generate new admin token in Gitea.
2. Update deployment env `ONEWORK_VC_ADMIN_TOKEN`.
3. Redeploy OneWork app.

## Data backup

Back up `/opt/onework-vc/data` (Gitea repositories and DB).
