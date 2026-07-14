# TestSprite AI Testing Report (MCP)

---

## 1️⃣ Document Metadata
- **Project Name:** OneWork (01-OneWork)
- **Date:** 2026-07-06
- **Prepared by:** TestSprite AI Team
- **Test Type:** Backend route / HTML smoke tests (HTTP GET against Next.js pages)
- **Environment:** `http://localhost:3000` (Next.js 16 dev server)
- **Scope:** Codebase
- **Total Tests:** 10
- **Pass Rate:** 90% (9 passed, 1 failed)

---

## 2️⃣ Requirement Validation Summary

### Requirement: Marketing Homepage
- **Description:** Public landing page introducing OneWork without authentication.

#### Test TC001 — getmarketinghomepagepublicaccess
- **Test Code:** [TC001_getmarketinghomepagepublicaccess.py](./TC001_getmarketinghomepagepublicaccess.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/ff73703a-7b8d-4f31-ac88-3dcba63de09c
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /` returns HTTP 200 with `text/html` content. The public homepage is reachable without credentials.

---

### Requirement: User Authentication
- **Description:** Login, signup, and email verification pages are publicly accessible.

#### Test TC002 — getloginpageauthenticationoptions
- **Test Code:** [TC002_getloginpageauthenticationoptions.py](./TC002_getloginpageauthenticationoptions.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/9d76ce70-f2d8-431a-bc0d-43feb9818114
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /login` returns 200 HTML containing email/password fields and passkey login option.

#### Test TC003 — getsignuppageregistrationflow
- **Test Code:** [TC003_getsignuppageregistrationflow.py](./TC003_getsignuppageregistrationflow.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/2028c58d-6729-421f-95e3-b2d851ec6fb0
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /signup` returns 200 HTML registration page without requiring prior session.

#### Test TC004 — getverifyemailstatuspage
- **Test Code:** [TC004_getverifyemailstatuspage.py](./TC004_getverifyemailstatuspage.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/5130c232-eaeb-4e62-94f3-f8125d1d36ce
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /verify-email` returns 200 HTML both with and without auth headers, matching the public verification flow.

---

### Requirement: Dashboard
- **Description:** Authenticated workspace home with overview widgets and sidebar navigation.

#### Test TC005 — getdashboardauthenticatedaccess
- **Test Code:** [TC005_getdashboardauthenticatedaccess.py](./TC005_getdashboardauthenticatedaccess.py)
- **Test Error:** `AssertionError: Expected HTML content to include 'sidebar' or 'navigation'`
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/69c29cbe-cf6e-4bfd-8413-c3a750843474
- **Status:** ❌ Failed
- **Severity:** MEDIUM
- **Analysis / Findings:** Unauthenticated access to `/dashboard` correctly returns a redirect/denial (302/307/401). The authenticated request returns HTTP 200 HTML, but the response body does not contain the strings `sidebar`, `navigation`, or `nav`. This is likely a **false negative** caused by two factors: (1) OneWork uses cookie/session-based InsForge auth, not HTTP Basic Auth — the test's `HTTPBasicAuth` does not establish a real session; (2) the dashboard shell is client-rendered by React, so the initial SSR HTML may not include sidebar markup or those literal keywords. Recommend re-running with browser-based (Playwright) frontend tests or a proper login/session cookie flow.

---

### Requirement: Task Management
- **Description:** Kanban task board with project selector and deep-linkable task modals.

#### Test TC006 — gettasksboardanddeeplinkmodal
- **Test Code:** [TC006_gettasksboardanddeeplinkmodal.py](./TC006_gettasksboardanddeeplinkmodal.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/a5de094e-c861-49a4-83a8-a32f6514c2d0
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /tasks` returns 200 HTML with task-board-related content. Invalid deep-link query params (`projectId=invalid&open=invalid`) return 200 without opening a modal — expected graceful handling. Valid deep-link modal behavior was not fully exercised (no seeded task UUIDs in test).

---

### Requirement: Team Chat
- **Description:** Real-time messaging interface with conversations and threads.

#### Test TC007 — getchatinterfaceauthenticatedaccess
- **Test Code:** [TC007_getchatinterfaceauthenticatedaccess.py](./TC007_getchatinterfaceauthenticatedaccess.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/fdb394f3-6bd7-4ecb-8f41-a4985efafaf4
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** Authenticated `GET /chat` returns 200 HTML with chat/conversation/message keywords. Unauthenticated access is correctly denied or redirected to login.

---

### Requirement: Video Calls
- **Description:** Calls list and LiveKit call room pages.

#### Test TC008 — getcallslistandroomaccess
- **Test Code:** [TC008_getcallslistandroomaccess.py](./TC008_getcallslistandroomaccess.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/f2ebcf5b-ee9a-41af-adaa-6e657492659a
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /calls` returns 200 HTML calls interface. Route-level smoke test passes; LiveKit media permissions and room join were not exercised in this HTTP-only test.

---

### Requirement: Calendar
- **Description:** Calendar view with synced events from integrations.

#### Test TC009 — getcalendarviewwithintegrations
- **Test Code:** [TC009_getcalendarviewwithintegrations.py](./TC009_getcalendarviewwithintegrations.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/2b6549df-b719-4cba-93e0-89fc3d552b33
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /calendar` returns 200 HTML calendar page. Integration sync states (empty/error) were not deeply validated.

---

### Requirement: Email
- **Description:** Inbox listing and compose email pages.

#### Test TC010 — getemailinboxandcomposepages
- **Test Code:** [TC010_getemailinboxandcomposepages.py](./TC010_getemailinboxandcomposepages.py)
- **Test Error:** —
- **Test Visualization and Result:** https://www.testsprite.com/dashboard/mcp/tests/99e52e9c-c936-4c16-a6b8-e62bb7b0026b/68fb0b7f-0f73-468f-9912-0a9eb1d540c2
- **Status:** ✅ Passed
- **Severity:** LOW
- **Analysis / Findings:** `GET /email` and `GET /email/compose` both return 200 HTML. Unauthenticated access is correctly blocked. OAuth-linked mailbox behavior was not tested.

---

## 3️⃣ Coverage & Matching Metrics

- **90%** of tests passed (9/10)

| Requirement            | Total Tests | ✅ Passed | ❌ Failed |
|------------------------|-------------|-----------|-----------|
| Marketing Homepage     | 1           | 1         | 0         |
| User Authentication    | 3           | 3         | 0         |
| Dashboard              | 1           | 0         | 1         |
| Task Management        | 1           | 1         | 0         |
| Team Chat              | 1           | 1         | 0         |
| Video Calls            | 1           | 1         | 0         |
| Calendar               | 1           | 1         | 0         |
| Email                  | 1           | 1         | 0         |
| **Total**              | **10**      | **9**     | **1**     |

**Modules not covered in this run:** Files (`/files`), Vault (`/vault`), Settings (`/settings`), Notifications (`/notifications`), Analytics, Version Control, Support, API route handlers (`/api/*`).

---

## 4️⃣ Key Gaps / Risks

1. **Auth model mismatch (TC005 failure):** Tests use HTTP Basic Auth, but OneWork authenticates via InsForge cookie/session tokens set after form login or passkey. Route smoke tests may return 200 shells without a real authenticated session, producing misleading pass/fail signals on protected pages.

2. **Client-side rendering blind spot:** Next.js pages return minimal SSR HTML. Keyword checks (`sidebar`, `navigation`, `modal`) miss content rendered client-side. **Frontend Playwright tests** are needed for reliable UI validation.

3. **Deep link coverage incomplete:** Task deep-link test (TC006) only validated invalid UUIDs. Shareable URL behavior (`/tasks?projectId=&open=`) with real seeded data was not exercised.

4. **Integration-dependent features untested:** LiveKit calls, OAuth email/calendar, and vault secrets require external services or permissions not reachable via simple GET requests.

5. **No API-level regression:** This run targeted page routes only. REST endpoints under `src/app/api/` (tasks CRUD, chat messages, billing webhooks, etc.) were not included despite backend test type selection.

**Recommended next steps:**
- Re-bootstrap with **Frontend** test type for browser-based login flows.
- Or add a TestSprite login helper that obtains a real session cookie before hitting protected routes.
- Expand coverage to Files, Vault, Settings, and Notifications modules.
- Re-run TC005 after switching to Playwright or session-cookie auth.

---
