This is a [Next.js](https://nextjs.org) project bootstrapped with `[create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app)`.

## Plugin integrations (calendar, chat, tasks)

Step-by-step guides for creating developer apps, OAuth clients, scopes, webhooks, and environment variables:

**[docs/plugin-developer-setup.md](docs/plugin-developer-setup.md)**

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

## Conflict lab (PR merge test)

**Branch `main`:** Keep stable production copy and Gitea webhook notification SQL as the source of truth.

**Owner:** onework-admin — conflict scenario A (main branch)


## Deploy smoke (main)

Auto-deploy check pushed to `main` at 2026-07-10T11:35:03Z.

## Deploy smoke (feature → main)

Second change merged via feature branch at 2026-07-10T11:35:03Z.

Auto-deploy e2e ping at 2026-07-10T11:43:33Z.

Cloudflare-tunnel auto-deploy ping 11:51:32Z

VC migrate host smoke 2026-07-13T04:23:32Z
