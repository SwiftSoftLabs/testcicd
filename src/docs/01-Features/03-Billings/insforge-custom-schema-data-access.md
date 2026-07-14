# InsForge database + custom schema (agent guide)

**Reference implementation (database only):** [OneWork](../) — app tables in `app_onework`, queried via raw SQL.

**Typical other-project setup:** InsForge = **Postgres host + HTTP SQL API** only. **Auth = your own JWT** (not InsForge Auth). This doc prioritizes that split.

**Skills (optional):** `insforge-cli` (migrations, secrets). Skip `insforge` auth SDK unless you also use InsForge login.

---

## Choose your auth model

| Model | Use when | InsForge Auth | User table |
|--------|----------|---------------|------------|
| **A — Custom JWT (recommended for other projects)** | You issue/verify your own tokens | **No** | `{SCHEMA}.users` (your schema) |
| **B — InsForge Auth (OneWork)** | Login/OAuth via InsForge | **Yes** | `auth.users` + `{SCHEMA}.profiles` |

**Sections below apply to both models for data access.** Auth sections are split: **A** vs **B**.

---

## Quick facts (data layer — same for A and B)

| Topic | Value |
|--------|--------|
| App schema | `NEXT_PUBLIC_DB_SCHEMA` e.g. `app_myapp` (not `public`) |
| Server queries | `POST {INSFORGE_URL}/api/database/advance/rawsql` |
| Credential for SQL | `INSFORGE_API_KEY` (server-only admin key) |
| SQL | Always `` `SELECT ... FROM ${SCHEMA}.table WHERE col = $1` `` |
| Browser → DB | **Never direct.** Browser → your `/api/*` → `query()` |
| RLS on raw SQL | **Not automatic** — enforce in API code |

**Do not** put `INSFORGE_API_KEY` in `NEXT_PUBLIC_*`.

---

## Architecture (custom JWT + InsForge DB)

```text
Browser                         Your API (Next/Node)              InsForge
───────                         ───────────────────              ────────
Login → your /api/auth/login
        (issues JWT)

API calls ──Authorization: Bearer <your-jwt>──►  Route Handler
        or cookie                              1. verifyJwt(request)
                                               2. query(sql, params)
                                                    POST .../advance/rawsql
                                                    Bearer INSFORGE_API_KEY
```

InsForge is **not** in the login path. It only executes SQL you send.

---

## Prerequisites

### 1. Link InsForge (database host)

```bash
npx @insforge/cli whoami
npx @insforge/cli current
npx @insforge/cli link   # if needed
```

### 2. Secrets

```bash
npx @insforge/cli secrets get ANON_KEY   # optional; not needed for raw SQL + JWT auth
```

You **must** have `INSFORGE_API_KEY` (admin) for `query()`.

### 3. Create schema + tables (no `auth.users` required for model A)

```sql
CREATE SCHEMA IF NOT EXISTS app_myapp;

-- Model A: users live in your app schema
CREATE TABLE app_myapp.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_myapp.items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES app_myapp.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Model B (OneWork-style) can add `REFERENCES auth.users(id)` on `profiles` instead.

---

## Environment variables

### Model A — Custom JWT + InsForge DB (minimal)

```bash
NEXT_PUBLIC_INSFORGE_URL=https://your-project.insforge.app
NEXT_PUBLIC_DB_SCHEMA=app_myapp
INSFORGE_API_KEY=...                    # server only

JWT_SECRET=...                          # server only (or RS256 key pair)
JWT_ACCESS_EXPIRES_IN=15m                # your choice
```

You do **not** need `NEXT_PUBLIC_INSFORGE_ANON_KEY` or `NEXT_PUBLIC_APP_URL` unless you add the optional Supabase proxy (Section 8).

### Model B — OneWork (InsForge Auth + proxy)

Also set `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, and implement [src/proxy.ts](../src/proxy.ts). See [OneWork reference files](#reference-files-in-onework) at the end.

| Variable | Model A | Model B |
|----------|---------|---------|
| `NEXT_PUBLIC_INSFORGE_URL` | Required | Required |
| `INSFORGE_API_KEY` | Required | Required |
| `NEXT_PUBLIC_DB_SCHEMA` | Required | Required |
| `JWT_SECRET` (or keys) | Required | — |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | Skip | Required |
| `NEXT_PUBLIC_APP_URL` | Skip | Required |

---

## Step 1 — `lib/db.ts` (database only)

Keep InsForge access **separate** from auth. Suggested layout:

- `lib/db.ts` — `SCHEMA`, `query()`, `buildInsert`, `buildSet` only
- `lib/auth/jwt.ts` — verify/issue tokens (your project)
- `lib/auth/session.ts` — `getUserFromRequest(request)` calls JWT verifier

Mirror [src/lib/db.ts](../src/lib/db.ts) but **remove** InsForge `getUserFromRequest` from `db.ts` if using model A.

### `query()` contract

```http
POST {INSFORGE_ORIGIN}/api/database/advance/rawsql
Authorization: Bearer {INSFORGE_API_KEY}
Content-Type: application/json

{ "query": "SELECT id, email FROM app_myapp.users WHERE id = $1", "params": ["uuid"] }
```

```json
{ "rows": [ {} ], "rowCount": 1 }
```

**Checklist:**

- [ ] `SCHEMA = process.env.NEXT_PUBLIC_DB_SCHEMA || "app_myapp"`
- [ ] Parameterized SQL only (`$1`, `$2`)
- [ ] Every table prefixed with `` `${SCHEMA}.` ``
- [ ] `cache: "no-store"` on fetch
- [ ] Never import `query()` in Client Components

---

## Step 2 — Custom JWT auth (model A)

### Issue token (login route)

```typescript
// app/api/auth/login/route.ts — illustrative
import { SignJWT } from "jose"; // or jsonwebtoken
import { query, SCHEMA } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  const { email, password } = await request.json();
  const result = await query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM ${SCHEMA}.users WHERE email = $1 LIMIT 1`,
    [email],
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await new SignJWT({ sub: user.id, email })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));

  return Response.json({ accessToken: token });
}
```

### Verify token (every protected route)

```typescript
// lib/auth/session.ts
import { jwtVerify } from "jose";

export type AuthUser = { id: string; email?: string };

export async function getUserFromRequest(request: Request): Promise<AuthUser | null> {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const cookie = /* parse your access_token cookie if used */;
  const token = bearer ?? cookie;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.JWT_SECRET!),
    );
    const sub = payload.sub;
    if (typeof sub !== "string") return null;
    return { id: sub, email: typeof payload.email === "string" ? payload.email : undefined };
  } catch {
    return null;
  }
}
```

**Agent checklist:**

- [ ] JWT secret server-only
- [ ] `sub` (or `userId`) = primary key in `{SCHEMA}.users`
- [ ] Protected routes: `const user = await getUserFromRequest(request); if (!user) return 401`
- [ ] Optional: load full profile with second `query()` on `{SCHEMA}.users` / `profiles`

### Frontend

```typescript
// After login, store token (memory + localStorage or httpOnly cookie via API)
const res = await fetch("/api/items", {
  headers: { Authorization: `Bearer ${accessToken}` },
  credentials: "include", // if using cookies instead
});
```

Same-origin `/api/*` wrappers in `lib/api.ts` should attach the JWT your app uses.

---

## Step 3 — API route pattern (with JWT)

```typescript
import { NextResponse } from "next/server";
import { query, SCHEMA } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await query(
    `SELECT id, name FROM ${SCHEMA}.items WHERE owner_id = $1`,
    [user.id],
  );

  return NextResponse.json({ data: result.rows });
}
```

**Order of operations:** verify JWT → authorize (RBAC) → `query()` → respond.

---

## Step 4 — Schema naming (model A)

| Data | Schema | Example |
|------|--------|---------|
| App users (JWT `sub`) | `{SCHEMA}` | `app_myapp.users` |
| All app tables | `{SCHEMA}` | `app_myapp.orders` |
| `public` | Avoid for app data | — |
| `auth.users` | **Optional** — only if you also use InsForge Auth (model B) | — |

---

## Step 5 — InsForge Auth (model B only — OneWork)

Skip this section for custom JWT projects.

1. Users sign up/login via InsForge (`/auth/v1` proxy or SDK).
2. `getUserFromRequest` calls `GET /api/auth/sessions/current` with InsForge access token ([src/lib/db.ts](../src/lib/db.ts)).
3. Profile row in `{SCHEMA}.profiles` references `auth.users(id)`.

---

## Step 6 (optional) — Supabase-compat proxy

**Not needed** for model A (JWT + `/api` + raw SQL).

Only for model B if the client uses `@supabase/ssr` against `/rest/v1`. See [src/proxy.ts](../src/proxy.ts): rewrite to `/api/database/records`, header `X-Role: {schema}_user`.

---

## Security (both models)

1. `INSFORGE_API_KEY` — server only; raw SQL has admin-level access.
2. Parameterized queries — no user input in SQL strings.
3. JWT — strong secret, short TTL, HTTPS in production; consider refresh tokens separately.
4. App RBAC — check `owner_id` / workspace membership in code before `query()`.
5. Do not trust client-sent `userId` — always take `id` from verified JWT.

---

## Verification

```bash
# Env
grep -E 'INSFORGE_API_KEY|DB_SCHEMA|JWT_SECRET' .env.local

# SQL smoke (server script or临时 route)
# SELECT 1 AS ok;
# SELECT COUNT(*) FROM app_myapp.users;

# Auth + data
# POST /api/auth/login → JWT
# GET /api/items with Authorization: Bearer <jwt> → 200
# Same request without token → 401
```

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Validating JWT via InsForge | Verify JWT locally (or your auth service) |
| Using `auth.users` without InsForge Auth | Use `{SCHEMA}.users` |
| Missing schema prefix | `` `${SCHEMA}.table` `` |
| Client calls `rawsql` with API key | Only server `query()` |
| Trusting `?userId=` query param | Use JWT `sub` only |

---

## Agent task template — Model A (JWT + InsForge DB)

```markdown
## Task: InsForge Postgres + custom schema + JWT auth

1. `npx @insforge/cli link`; set NEXT_PUBLIC_INSFORGE_URL, INSFORGE_API_KEY, NEXT_PUBLIC_DB_SCHEMA.
2. Migration: CREATE SCHEMA app_<name>; CREATE users + app tables in that schema (no auth.users dependency).
3. lib/db.ts: SCHEMA, query() → POST /api/database/advance/rawsql only.
4. lib/auth: issue JWT on login; getUserFromRequest() verifies JWT (not InsForge).
5. app/api/* routes: getUserFromRequest → RBAC → query(`... FROM ${SCHEMA}.<table> ...`, [params]).
6. Frontend: fetch /api/* with Authorization: Bearer <token> or httpOnly cookie.
7. Do NOT add NEXT_PUBLIC_INSFORGE_ANON_KEY unless adding Supabase proxy.
8. Do NOT expose INSFORGE_API_KEY or JWT_SECRET to the client.
9. Verify: login → JWT → protected read/write.
```

---

## Agent task template — Model B (OneWork / InsForge Auth)

```markdown
## Task: InsForge Auth + custom schema (OneWork style)

Follow Model A steps 1–3, then:
- Use auth.users + {SCHEMA}.profiles with FK to auth.users(id).
- getUserFromRequest via GET /api/auth/sessions/current + sb-access-token cookie.
- Add proxy.ts for /auth/v1 and /rest/v1; set NEXT_PUBLIC_INSFORGE_ANON_KEY and NEXT_PUBLIC_APP_URL.
See OneWork reference files below.
```

---

## Reference files in OneWork

| File | Use for |
|------|---------|
| [src/lib/db.ts](../src/lib/db.ts) | **`query()`, `SCHEMA`, SQL helpers** (copy this for model A) |
| [src/lib/db.ts](../src/lib/db.ts) `getUserFromRequest` | Model B only (InsForge session) |
| [src/app/api/tasks/[id]/route.ts](../src/app/api/tasks/[id]/route.ts) | Route → `query()` + RBAC pattern |
| [src/proxy.ts](../src/proxy.ts) | Model B only |
| [.env.example](../.env.example) | Full OneWork env (includes InsForge Auth vars) |

---

## Summary for agents

- **InsForge** = run SQL against `app_<name>.*` via **admin API key** and `advance/rawsql`.
- **Custom JWT** = your login, your `users` table, your `getUserFromRequest`; InsForge does not validate the JWT.
- **OneWork** = same DB pattern + InsForge Auth; treat as model B, not the default for greenfield apps.
