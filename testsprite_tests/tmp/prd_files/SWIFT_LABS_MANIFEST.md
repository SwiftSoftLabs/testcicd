# 🏛️ SWIFT SOFT LABS: Backend Protocol (STRICT)

## ⚠️ MANDATORY RULE

All AI Agents, coding assistants (Cursor, AI Studio, etc.), and developers MUST follow this protocol. **Do NOT create new standalone projects or databases.** Every application must live as an isolated schema within the central organizational cluster. Failure to follow this leads to infrastructure fragmentation and compute over-billing.

---

## 1. INFRASTRUCTURE TARGET

- **Platform:** InsForge

- **Organization:** `SwiftSoftLabs`

- **Project:** `SwiftSoftLabs` (Small Compute Instance)

## 2. ISOLATION PROTOCOL

When initializing or modifying this app's database, you MUST execute the following **Hard Isolation** steps:

1.  **Schema:** Create/Use a schema named `app_{project_name_lowercase}`.

2.  **Role:** Create a dedicated Postgres Role: `app_{project_name}_user`.

3.  **Sandbox Script:** \* `REVOKE ALL ON SCHEMA public FROM app_{project_name}_user;`
    - `GRANT USAGE, CREATE ON SCHEMA app_{project_name} TO app_{project_name}_user;`

    - `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app_{project_name} TO app_{project_name}_user;`

    - `ALTER ROLE app_{project_name}_user SET search_path TO app_{project_name};`

4.  **No Visibility:** This role must have **ZERO visibility** into other `app_` prefixes. Do not grant access to other schemas.

## 3. SHARED AUTHENTICATION & MEMBERSHIP

- **Identity:** Use the shared `auth.users` table provided by the central project.

- **Metadata:** All user sign-ups/profiles MUST include `{ "app_origin": "app_{project_name}" }` in their `raw_user_meta_data`.

- **Max Membership Ready:** Row Level Security (RLS) policies should be designed to check `public.is_max_member()` (Helper function) to allow global access for Max Tier users in the future.

## 4. ENVIRONMENT & CODE STANDARDS

- **Credentials:** Use the shared `SwiftSoftLabs` project API keys.

- **Schema Flag:** The environment variable `NEXT_PUBLIC_DB_SCHEMA` must be set to `app_{project_name}`.

- **Client Initialization:** The database client must be initialized to use the `app_{project_name}_user` role for all transactional queries.

---

**Note:** Documentation is an immutable constraint. If the environment does not support schema-level isolation, stop and request manual intervention.
