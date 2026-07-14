# Plugin developer setup guide

This document explains how to create developer accounts, OAuth apps, API keys, permissions, scopes, and webhooks for every **OneWork plugin** under **Settings → Plugins** (calendar, chat, and tasks).

Use your deployed app origin everywhere below:

```text
{APP_ORIGIN} = value of NEXT_PUBLIC_APP_URL (no trailing slash)
```

Examples:

- Local: `http://localhost:3000`
- Production: `https://your-app.example.com`

Copy variables from [`.env.example`](../.env.example) into `.env` (server-only secrets must never use a `NEXT_PUBLIC_` prefix).

---

## Prerequisites (all plugins)

| Variable | Required for | Notes |
|----------|--------------|-------|
| `NEXT_PUBLIC_APP_URL` | All OAuth redirects & webhooks | Must match the URL users open in the browser |
| `INSFORGE_API_KEY` | OAuth state signing | Used to sign `state` on plugin connect flows |

Optional **background sync** (manual “Sync now” works without these):

| Variable | Endpoint |
|----------|----------|
| `CALENDAR_PLUGIN_CRON_SECRET` | `POST {APP_ORIGIN}/api/plugins/calendar/sync/cron` with `Authorization: Bearer <secret>` |
| `CHAT_PLUGIN_CRON_SECRET` | `POST {APP_ORIGIN}/api/plugins/chat/sync/cron` with `Authorization: Bearer <secret>` |
| `TASK_PLUGIN_CRON_SECRET` | `POST {APP_ORIGIN}/api/plugins/tasks/sync/cron` with `Authorization: Bearer <secret>` |

Generate a cron secret:

```bash
openssl rand -base64 32
```

---

## Quick reference

| Area | Provider | Portal | Env vars |
|------|----------|--------|----------|
| Calendar | Google Calendar | [Google Cloud Console](https://console.cloud.google.com/) | `GOOGLE_CALENDAR_OAUTH_CLIENT_ID`, `GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET` |
| Calendar | Microsoft Outlook | [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) | `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` |
| Calendar | Calendly | [Calendly Developer](https://developer.calendly.com/) | `CALENDLY_OAUTH_CLIENT_ID`, `CALENDLY_OAUTH_CLIENT_SECRET` |
| Chat | Slack | [Slack API](https://api.slack.com/apps) | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` |
| Chat | Microsoft Teams | Same Azure app as Outlook (recommended) | `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` |
| Chat | Discord | [Discord Developer Portal](https://discord.com/developers/applications) | `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` |
| Tasks | Trello | [Trello Power-Up admin](https://trello.com/power-ups/admin) | `TRELLO_API_KEY` |
| Tasks | Jira | [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/) | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` |
| Tasks | ClickUp | [ClickUp → Integrations → API](https://app.clickup.com/settings/apps) | `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET` |
| Tasks | Asana | [Asana Developer Console](https://app.asana.com/0/my-apps) | `ASANA_CLIENT_ID`, `ASANA_CLIENT_SECRET` |

**Where users connect:** Settings → Plugins (calendar / chat / tasks sections).

---

## Shared Microsoft app (Outlook + Teams)

Outlook **calendar** and Microsoft **Teams chat** both use `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET` but request **different scopes** and **different redirect URIs**.

Register **all** redirect URIs on one Azure app registration:

| Flow | Redirect URI |
|------|----------------|
| Outlook calendar plugin | `{APP_ORIGIN}/api/plugins/calendar/outlook/callback` |
| Teams chat plugin | `{APP_ORIGIN}/api/plugins/chat/teams/callback` |

**API permissions (Application registration → API permissions → Microsoft Graph → Delegated):**

Combine permissions needed for both features (admin consent may be required in the tenant):

| Permission | Used by |
|------------|---------|
| `openid`, `email`, `profile` | Both |
| `offline_access` | Both (refresh tokens) |
| `User.Read` | Both |
| `Calendars.ReadWrite` | Outlook calendar plugin |
| `ChannelMessage.Read.All` | Teams (read channel messages) |
| `ChannelMessage.Send` | Teams (send messages) |
| `Channel.ReadBasic.All` | Teams (list channels) |
| `Team.ReadBasic.All` | Teams (list teams) |

> **Note:** Mailbox OAuth (`/api/email/oauth/microsoft/*`) uses the same client ID with **different** scopes (`IMAP.AccessAsUser.All`, `SMTP.Send`). If you use one Azure app for mail + plugins, grant the **union** of all delegated permissions.

**Teams webhooks:** Graph subscriptions are created automatically per linked channel. Notifications are delivered to:

```text
{APP_ORIGIN}/api/plugins/chat/webhooks/teams
```

The app must be reachable over HTTPS in production.

---

# Calendar plugins

Configure under **Settings → Plugins → Calendar**.

Also set `CALENDAR_INTEGRATION_TOKEN_KEY` (encrypts stored tokens):

```bash
openssl rand -base64 48
```

---

## Google Calendar

**Console:** [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services.

### 1. Enable APIs

- Enable **Google Calendar API**.

### 2. OAuth consent screen

- User type: **External** (or Internal for Workspace-only).
- Add test users while in **Testing** mode.

### 3. Create OAuth client

- Type: **Web application**.
- **Authorized redirect URIs:**
  - `{APP_ORIGIN}/api/plugins/calendar/google_calendar/callback`

### 4. Scopes requested by OneWork

| Scope | Purpose |
|-------|---------|
| `openid` | Sign-in identity |
| `email` | Account email |
| `profile` | Display name |
| `https://www.googleapis.com/auth/calendar` | Read/write calendars and events |

OAuth uses `access_type=offline` and `prompt=consent` so a **refresh token** is issued.

### 5. Push notifications (optional)

On connect/sync, OneWork can register a Google Calendar **watch** channel to:

```text
{APP_ORIGIN}/api/plugins/calendar/webhooks/google
```

Requirements:

- Public HTTPS URL (not `localhost` unless tunneled).
- Calendar API enabled on the same project.

### 6. Environment

```env
GOOGLE_CALENDAR_OAUTH_CLIENT_ID=
GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET=
```

---

## Microsoft Outlook (calendar plugin)

**Portal:** [Azure Portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade).

### 1. Register application

- Supported account types: usually **Accounts in any organizational directory and personal Microsoft accounts**.
- Platform: **Web** → Redirect URI:
  - `{APP_ORIGIN}/api/plugins/calendar/outlook/callback`

### 2. Client secret

- Certificates & secrets → New client secret → copy into `MICROSOFT_OAUTH_CLIENT_SECRET`.

### 3. API permissions (Microsoft Graph, Delegated)

| Scope | Purpose |
|-------|---------|
| `openid`, `email`, `profile` | User identity |
| `offline_access` | Refresh token |
| `User.Read` | Profile |
| `Calendars.ReadWrite` | Sync and update events |

Grant **admin consent** if your tenant requires it.

### 4. Environment

```env
MICROSOFT_OAUTH_CLIENT_ID=
MICROSOFT_OAUTH_CLIENT_SECRET=
```

---

## Calendly

**Portal:** [Calendly Developer Portal](https://developer.calendly.com/) → OAuth applications.

### 1. Create OAuth application

- **Redirect URI:**
  - `{APP_ORIGIN}/api/plugins/calendar/calendly/callback`

### 2. Scopes

OneWork uses Calendly’s standard OAuth authorize URL; enable scopes that allow:

- Reading the authenticated user
- Listing scheduled events / event types (as permitted by your Calendly app configuration)

Refer to [Calendly API authentication](https://developer.calendly.com/api-docs/ZG9jOjM2MzE2MDM4-authentication) for the latest scope names on new apps.

### 3. Behavior

- **Inbound-only** for arbitrary event creation: bookings should be managed in Calendly.
- Webhook support is implemented in code for Calendly lifecycle events when configured on the Calendly side.

### 4. Environment

```env
CALENDLY_OAUTH_CLIENT_ID=
CALENDLY_OAUTH_CLIENT_SECRET=
```

---

## Calendar: related (not under Plugins)

These live under **Settings → Integrations** but share Google/Microsoft credentials in some setups:

| Integration | Redirect URI | Env vars |
|-------------|--------------|----------|
| Google Meet (calendar) | `{APP_ORIGIN}/api/integrations/calendar/google/callback` | Same `GOOGLE_CALENDAR_OAUTH_*` |
| Zoom | `{APP_ORIGIN}/api/integrations/calendar/zoom/callback` | `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |

Use a **separate** Google OAuth client if you want to isolate mailbox, calendar plugin, and Meet scopes.

---

# Chat plugins

Configure under **Settings → Plugins → Chat**. Requires permission **Manage Bot Integrations**.

---

## Slack

**Portal:** [Slack API → Your Apps](https://api.slack.com/apps) → **Create New App**.

### 1. OAuth & Permissions

- **Redirect URL:**
  - `{APP_ORIGIN}/api/plugins/chat/slack/callback`

**Bot Token Scopes** (must match what OneWork requests):

| Scope | Purpose |
|-------|---------|
| `channels:history` | Read public channel messages |
| `channels:read` | List public channels |
| `channels:join` | Auto-join public channels when linking (reconnect Slack after adding this scope) |
| `chat:write` | Post messages |
| `groups:history` | Read private channel messages |
| `groups:read` | List private channels |
| `users:read` | Resolve users (`users.info`) |
| `users:read.email` | Map assignees by email |
| `users.profile:read` | Display names for @mentions (granular; add with `users:read` if needed) |

**History backfill:** On link or **Sync now**, OneWork paginates channel history (default **30 days**, up to 90 via `CHAT_PLUGIN_HISTORY_DAYS`). Older installs only pulled 7 days and one API page (~100 messages); run **Sync now** after upgrading to backfill. Tune `CHAT_PLUGIN_HISTORY_MAX_PAGES` if channels are very active.

### 2. Event Subscriptions (real-time inbound)

- Enable **Event Subscriptions**.
- **Request URL:**
  - `{APP_ORIGIN}/api/plugins/chat/webhooks/slack`

**Slack cannot call `http://localhost` from the internet.** For local development, expose your app with a tunnel and use the **HTTPS** tunnel URL in Slack (not `localhost`):

```bash
# Example: ngrok (install from https://ngrok.com)
ngrok http 3000
# Request URL → https://YOUR-SUBDOMAIN.ngrok-free.app/api/plugins/chat/webhooks/slack
```

Set `SLACK_SIGNING_SECRET` in `.env` **before** saving the Request URL (Basic Information → Signing Secret). The webhook verifies the signature on the challenge request when the secret is set.

Verify locally (dev server running on port 3000):

```bash
curl -s -X POST http://localhost:3000/api/plugins/chat/webhooks/slack \
  -H 'Content-Type: application/json' \
  -d '{"type":"url_verification","challenge":"test_challenge_123"}'
# Expected: {"challenge":"test_challenge_123"}
```

- Subscribe to bot events (minimum):
  - `message.channels` (public channels)
  - `message.groups` (private channels)

### 3. Signing secret

- **Basic Information** → **App Credentials** → **Signing Secret** → `SLACK_SIGNING_SECRET`.

### 4. Install to workspace

Users click **Connect Slack** in OneWork; Slack OAuth v2 returns a **bot token** stored encrypted server-side.

**Private channels:** the bot must be invited manually. In the Slack channel, run `/invite @YourBotName`, then use **Sync now** in OneWork. Public channels are joined automatically when linked (requires `channels:join` scope — reconnect Slack if you added this scope to an older app).

### 5. Environment

```env
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
```

---

## Microsoft Teams

Uses the **Microsoft** app registration described in [Shared Microsoft app](#shared-microsoft-app-outlook--teams).

### Redirect URI

```text
{APP_ORIGIN}/api/plugins/chat/teams/callback
```

### Scopes (space-separated in authorize URL)

| Scope | Purpose |
|-------|---------|
| `ChannelMessage.Read.All` | Read linked channel messages |
| `ChannelMessage.Send` | Send messages |
| `Channel.ReadBasic.All` | List channels |
| `Team.ReadBasic.All` | List teams |
| `User.Read` | User profile |
| `offline_access` | Refresh token |

### Webhooks

- Graph **change notifications** URL:
  - `{APP_ORIGIN}/api/plugins/chat/webhooks/teams`
- Subscriptions are **created automatically** when a channel is linked; renewed via cron/manual sync.

### Environment

```env
MICROSOFT_OAUTH_CLIENT_ID=
MICROSOFT_OAUTH_CLIENT_SECRET=
```

---

## Discord

**Portal:** [Discord Developer Portal](https://discord.com/developers/applications) → New Application.

### 1. Bot

- **Bot** tab → **Add Bot** → copy **Token** → `DISCORD_BOT_TOKEN`.
- Enable **Message Content Intent** if you need full message bodies (recommended for sync).

### 2. OAuth2

- **Redirects:**
  - `{APP_ORIGIN}/api/plugins/chat/discord/callback`
- **OAuth2 URL Generator** (for reference):
  - Scopes: `bot`, `identify`
  - Bot permissions used by OneWork: integer **`68608`**
    - View Channels
    - Send Messages
    - Read Message History

### 3. Install flow

**Connect Discord** runs the OAuth2 bot install flow; users pick a server and channel to link in OneWork.

### 4. Sync model

- No Gateway websocket in MVP: use **Sync now** or **chat plugin cron**.
- Outbound/inbound via REST using the bot token.

### 5. Environment

```env
DISCORD_APPLICATION_ID=    # Application ID (Client ID)
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
```

---

# Task plugins

Configure under **Settings → Plugins → Tasks**. Requires permission **Manage Workflows**.

Synced tasks show a provider badge; they **cannot be deleted** in OneWork (delete in the source tool).

---

## Trello

**Portal:** [Trello Power-Up / API Key](https://trello.com/power-ups/admin) (or [Atlassian Developer – Trello](https://developer.atlassian.com/cloud/trello/)).

### 1. API key

- Generate an **API Key** → `TRELLO_API_KEY`.

### 2. Allowed origins (if prompted)

- Add `{APP_ORIGIN}`.

### 3. Authorization model

- OneWork uses Trello’s **token** authorization (not OAuth 2 code flow).
- **Return URL** (implicit token in URL fragment):
  - `{APP_ORIGIN}/api/plugins/tasks/trello/callback?state=...`
- Token scope requested: `read,write` (boards, cards, lists).

### 4. Linking

- Link a **board** (`board:{id}`) to an optional OneWork project.
- Card list names map to task status; outbound updates move cards between lists.

### 5. Environment

```env
TRELLO_API_KEY=
```

---

## Jira (Atlassian Cloud)

**Portal:** [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/) → Create **OAuth 2.0 (3LO)** app.

### 1. Callback URL

```text
{APP_ORIGIN}/api/plugins/tasks/jira/callback
```

### 2. Permissions / scopes

Enable in the developer console and consent during connect:

| Scope | Purpose |
|-------|---------|
| `read:jira-work` | Read issues, projects |
| `write:jira-work` | Update issues, transitions |
| `read:me` | User identity |
| `offline_access` | Refresh token |

### 3. APIs used

- Jira Cloud REST API v3 (`api.atlassian.com/ex/jira/{cloudId}/...`)
- Issue search, update fields, **transitions** for status sync

### 4. Environment

```env
ATLASSIAN_CLIENT_ID=
ATLASSIAN_CLIENT_SECRET=
```

---

## ClickUp

**Portal:** [ClickUp Settings → Apps](https://app.clickup.com/settings/apps) (or ClickUp API settings).

### 1. Create OAuth app

- **Redirect URI:**
  - `{APP_ORIGIN}/api/plugins/tasks/clickup/callback`

### 2. Scopes

ClickUp OAuth grants workspace access per ClickUp’s app settings. Ensure the app can:

- Read teams, spaces, folders, lists
- Read and update tasks

### 3. Linking

- Link a **list** (`list:{id}`) to an optional OneWork project.
- Status names are **list-specific**; OneWork resolves them when pushing status changes.

### 4. Environment

```env
CLICKUP_CLIENT_ID=
CLICKUP_CLIENT_SECRET=
```

---

## Asana

**Portal:** [Asana Developer Console](https://app.asana.com/0/my-apps) → Create new app.

### 1. OAuth

- **Redirect URL:**
  - `{APP_ORIGIN}/api/plugins/tasks/asana/callback`

### 2. Scopes

Asana uses classic OAuth; grant access to:

- Read user and workspaces
- Read/write tasks and projects

(Exact checkbox labels follow Asana’s developer UI for your app.)

### 3. Behavior

- Connect stores the user’s **first workspace** in installation settings.
- Link an Asana **project** (`project:{gid}`).
- Status maps to **sections**; **Done** sets `completed: true`.

### 4. Environment

```env
ASANA_CLIENT_ID=
ASANA_CLIENT_SECRET=
```

---

# Verification checklist

After filling `.env` and restarting the server:

1. Open **Settings → Plugins**.
2. Each card should show **Connect** (not “Not configured”) when env vars are set.
3. Complete OAuth for one provider; confirm redirect back to `/settings/plugins` with a success toast.
4. Create a **link** (channel / board / project / list) and run **Sync now**.
5. Confirm data appears on **Calendar**, **Chat**, or **Tasks**.
6. For Slack/Teams/Google, confirm webhooks receive events (HTTPS deployment).

### Common failures

| Symptom | Likely cause |
|---------|----------------|
| `redirect_uri_mismatch` | Redirect URL in provider console ≠ exact `NEXT_PUBLIC_APP_URL` + path |
| Slack URL verification fails | Used `localhost` in Slack (use HTTPS tunnel); or `SLACK_SIGNING_SECRET` missing/wrong; or dev server not running |
| Slack events not arriving | Event Subscriptions URL not verified or missing `message.channels` / `message.groups` |
| Teams 403 on messages | Missing Graph delegated permissions or admin consent |
| Jira “no accessible sites” | Atlassian app missing Jira platform scope or user has no Cloud site |
| Trello “no token” | Pop-up blocked; or return URL not allowlisted |
| Cron sync 401 | Wrong `*_CRON_SECRET` or missing `Authorization: Bearer` header |

---

# File reference (code)

| Area | Path |
|------|------|
| Calendar providers | `src/lib/plugins/calendar/` |
| Chat providers | `src/lib/plugins/chat/` |
| Task providers | `src/lib/plugins/tasks/` |
| Env template | `.env.example` |
| SQL migrations | `sql/chat_plugins_migration.sql`, `sql/task_plugins_migration.sql`, calendar tables via app migrations |

When adding a new provider, update this document, `.env.example`, and the plugin status route so the UI shows “configured” correctly.
