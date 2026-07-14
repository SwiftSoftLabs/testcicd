/**
 * GET  /api/workspace/members?workspaceId=<uuid>&search=&role=&status=&sort=&page=&limit=
 * POST /api/workspace/members?workspaceId=<uuid>  — invite user by email (new or existing)
 */

import { NextResponse } from "next/server";
import { query, SCHEMA } from "@/lib/db";
import { roleFromUILabel, roleToUILabel } from "@/lib/rbac/roles";
import {
  WorkspaceAccessError,
  requireSessionUser,
  requireWorkspaceMember,
  requireWorkspacePermission,
} from "@/lib/rbac/workspace-access";
import { checkSeatLimit } from "@/lib/billing/enforce";
import { PRESENCE_DND_LABEL } from "@/lib/presence";
import { buildEffectivePresenceStatusSql } from "@/lib/presence/effective-status";

// ─── Type for raw DB row ──────────────────────────────────────────────────────

interface MemberRow {
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  ws_role: string | null; // NULL for non-members
  status: string;
  is_manual: boolean;
  updated_at: string | null;
  is_member: boolean;
  active_projects: string[] | null;
  total_count: string;
}

interface StatsRow {
  total_members: string;
  total_active: string;
  total_admins: string;
}

// ─── Normalization helpers ────────────────────────────────────────────────────

function normalizeStatusToUI(dbStatus: string, isManual = false): string {
  switch (dbStatus) {
    case "online":
      return "Active";
    case "away":
      return "Away";
    case "invited":
      return "Invited";
    case "offline":
      return isManual ? PRESENCE_DND_LABEL : "Offline";
    default:
      return "Offline";
  }
}

function normalizeStatusToDB(uiStatus: string): string | null {
  switch (uiStatus) {
    case "Active":
      return "online";
    case "Away":
      return "away";
    case "Invited":
      return "invited";
    case PRESENCE_DND_LABEL:
      return null;
    case "Offline":
      return "offline";
    default:
      return "offline";
  }
}

function formatRelativeTime(updatedAt: string | null): string {
  if (!updatedAt) return "--";
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins > 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function buildAvatarUrl(avatarUrl: string | null, name: string | null): string {
  if (avatarUrl) return avatarUrl;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "U")}&background=random`;
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  try {
    const user = await requireSessionUser(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId || !UUID_RE.test(workspaceId)) {
      return NextResponse.json(
        { error: "Missing or invalid workspaceId" },
        { status: 400 },
      );
    }

    await requireWorkspaceMember(workspaceId, user.id);

    const search = (searchParams.get("search") || "").trim();
    const uiRole = searchParams.get("role") || "";
    const uiStatus = searchParams.get("status") || "";
    const sort = searchParams.get("sort") || "Newest";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("limit") || "5", 10)),
    );
    const offset = (page - 1) * limit;

    const orderKey =
      sort === "Alphabetical (A-Z)"
        ? "full_name_asc"
        : sort === "Alphabetical (Z-A)"
          ? "full_name_desc"
          : "newest";

    const lite = searchParams.get("lite") === "true";
    const dbRole = uiRole ? roleFromUILabel(uiRole) : null;
    const filterDnd = uiStatus === PRESENCE_DND_LABEL;
    const dbStatus =
      uiStatus && !filterDnd ? normalizeStatusToDB(uiStatus) : null;
    const effectiveStatusSql = buildEffectivePresenceStatusSql();

    const activeProjectsSql = lite
      ? `ARRAY[]::text[]`
      : `(
                        SELECT COALESCE(array_agg(DISTINCT proj.name ORDER BY proj.name), ARRAY[]::text[])
                        FROM (
                            SELECT DISTINCT t.project_id AS pid
                            FROM ${SCHEMA}.tasks t
                            WHERE t.assignee_id = p.id
                              AND t.workspace_id = $1
                              AND t.status NOT IN ('done', 'archived')
                            UNION
                            SELECT pm.project_id AS pid
                            FROM ${SCHEMA}.project_members pm
                            WHERE pm.user_id = p.id
                        ) up
                        JOIN ${SCHEMA}.projects proj ON proj.id = up.pid
                        WHERE proj.workspace_id = $1
                    )`;

    const [membersResult, statsResult] = await Promise.all([
      query<MemberRow>(
        `SELECT
                    p.id AS user_id,
                    p.email,
                    p.full_name,
                    p.avatar_url,
                    wm.role AS ws_role,
                    ${effectiveStatusSql} AS status,
                    COALESCE(wp.is_manual, FALSE) AS is_manual,
                    COALESCE(wp.updated_at, p.updated_at) AS updated_at,
                    (wm.user_id IS NOT NULL) AS is_member,
                    ${activeProjectsSql} AS active_projects,
                    COUNT(*) OVER () AS total_count
                FROM ${SCHEMA}.profiles p
                JOIN ${SCHEMA}.workspace_members wm
                    ON wm.user_id = p.id AND wm.workspace_id = $1
                LEFT JOIN ${SCHEMA}.workspace_presence wp
                    ON wp.user_id = p.id AND wp.workspace_id = $1
                WHERE
                    ($2 = '' OR p.full_name ILIKE '%' || $2 || '%' OR p.email ILIKE '%' || $2 || '%')
                    AND ($3::text IS NULL OR wm.role = $3)
                    AND (
                        ($4::text IS NULL AND NOT $8::boolean)
                        OR ($8::boolean AND COALESCE(wp.is_manual, FALSE) = TRUE AND ${effectiveStatusSql} = 'offline')
                        OR ($4::text IS NOT NULL AND NOT $8::boolean AND ${effectiveStatusSql} = $4)
                    )
                ORDER BY
                    CASE WHEN $7 = 'full_name_asc'  THEN p.full_name END ASC  NULLS LAST,
                    CASE WHEN $7 = 'full_name_desc' THEN p.full_name END DESC NULLS LAST,
                    CASE WHEN $7 = 'newest' OR $7 IS NULL THEN COALESCE(wp.updated_at, p.updated_at) END DESC NULLS LAST
                LIMIT $5 OFFSET $6`,
        [workspaceId, search, dbRole, dbStatus, limit, offset, orderKey, filterDnd],
      ),
      query<StatsRow>(
        `SELECT
                    COUNT(*) AS total_members,
                    COUNT(*) FILTER (WHERE ${effectiveStatusSql} = 'online')  AS total_active,
                    COUNT(*) FILTER (WHERE wm.role = 'admin')    AS total_admins
                FROM ${SCHEMA}.workspace_members wm
                LEFT JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
                LEFT JOIN ${SCHEMA}.workspace_presence wp
                    ON wp.user_id = wm.user_id AND wp.workspace_id = wm.workspace_id
                WHERE wm.workspace_id = $1`,
        [workspaceId],
      ),
    ]);

    const total =
      membersResult.rows.length > 0 ? parseInt(membersResult.rows[0].total_count, 10) : 0;
    const statsRow = statsResult.rows[0];
    const totalMembers = statsRow ? parseInt(statsRow.total_members, 10) : 0;
    const totalActive = statsRow ? parseInt(statsRow.total_active, 10) : 0;
    const totalAdmins = statsRow ? parseInt(statsRow.total_admins, 10) : 0;

    const data = membersResult.rows.map((row) => ({
      id: row.user_id,
      name: row.full_name || "Anonymous",
      email: row.email || "",
      role: roleToUILabel(row.ws_role),
      status: normalizeStatusToUI(row.status, Boolean(row.is_manual)),
      lastActive: row.status === "invited" ? "--" : formatRelativeTime(row.updated_at),
      avatar: buildAvatarUrl(row.avatar_url, row.full_name),
      activeProjects: row.active_projects || [],
      isMember: Boolean(row.is_member),
    }));

    return NextResponse.json({ data, total, totalMembers, totalActive, totalAdmins });
  } catch (error: unknown) {
    if (error instanceof WorkspaceAccessError) {
      const status = error.message === "Unauthorized" ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Error fetching members:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  try {
    const user = await requireSessionUser(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId || !UUID_RE.test(workspaceId)) {
      return NextResponse.json(
        { error: "Missing or invalid workspaceId" },
        { status: 400 },
      );
    }

    await requireWorkspacePermission(workspaceId, user.id, "invite_members");

    const seatCheck = await checkSeatLimit(workspaceId);
    if (!seatCheck.allowed) {
      return NextResponse.json({ error: seatCheck.error, code: seatCheck.code }, { status: 403 });
    }

    let body: { email?: string; role?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { email, role } = body;
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    const dbRole = roleFromUILabel(role || "Member");

    let userId: string;

    const insforgeBase = new URL(process.env.NEXT_PUBLIC_INSFORGE_URL!).origin;
    const tempPassword = crypto.randomUUID().replace(/-/g, "");
    let shouldSendEmail = false;
    let isNewUser = false;

    // Pre-check: if a profile already exists for this email, use it directly and skip
    // the InsForge auth call. This prevents duplicate UUIDs from being created when
    // InsForge doesn't return 409 for a duplicate email signup attempt.
    const existingProfile = await query<{ id: string; status: string }>(
      `SELECT id, status FROM ${SCHEMA}.profiles WHERE email = $1 LIMIT 1`,
      [email],
    );

    if (existingProfile.rows.length > 0) {
      userId = existingProfile.rows[0].id;

      // Check if already an active workspace member
      const memberResult = await query<{ status: string }>(
        `SELECT p.status
                 FROM ${SCHEMA}.workspace_members wm
                 JOIN ${SCHEMA}.profiles p ON p.id = wm.user_id
                 WHERE wm.workspace_id = $1
                   AND wm.user_id = $2
                 LIMIT 1`,
        [workspaceId, userId],
      );

      if (memberResult.rows.length > 0 && memberResult.rows[0].status !== "invited") {
        return NextResponse.json(
          { error: "User is already an active member." },
          { status: 409 },
        );
      }

      // Re-invite: trigger password reset so they can set a new password via Forgot Password
      await fetch(`${insforgeBase}/api/auth/email/send-reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        cache: "no-store",
      }).catch((err) =>
        console.error("Failed to trigger reset email for re-invite:", err),
      );

      await query(
        `UPDATE ${SCHEMA}.profiles SET status = 'invited', updated_at = NOW() WHERE id = $1`,
        [userId],
      );
      shouldSendEmail = true;
    } else {
      // No profile exists — attempt to create an InsForge auth account via the standard
      // signup flow so the password is stored correctly.
      const createRes = await fetch(`${insforgeBase}/api/auth/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!}`,
        },
        body: JSON.stringify({ email, password: tempPassword }),
        cache: "no-store",
      });

      if (createRes.ok) {
        // Brand new user
        const createData = (await createRes.json()) as { user?: { id: string } };
        userId = createData?.user?.id ?? "";
        if (!userId) {
          return NextResponse.json(
            { error: "User creation succeeded but no ID returned." },
            { status: 502 },
          );
        }
        isNewUser = true;
        shouldSendEmail = true;

        // Upsert profile with invited status
        await query(
          `INSERT INTO ${SCHEMA}.profiles (id, email, full_name, onboarding_type, status, updated_at)
                   VALUES ($1, $2, $3, 'joiner', 'invited', NOW())
                   ON CONFLICT (id) DO UPDATE SET
                       email           = EXCLUDED.email,
                       onboarding_type = EXCLUDED.onboarding_type,
                       status          = 'invited',
                       updated_at      = NOW()`,
          [userId, email, email.split("@")[0]],
        );
      } else if (createRes.status === 409) {
        // InsForge has this user in auth but we have no profile — look up their auth ID.
        // Handle both { users: [...] } and flat-array response shapes.
        const lookupRes = await fetch(`${insforgeBase}/api/auth/users?per_page=1000`, {
          headers: { "x-api-key": process.env.INSFORGE_API_KEY! },
          cache: "no-store",
        });
        if (!lookupRes.ok) {
          const errText = await lookupRes.text();
          console.error("InsForge user lookup failed:", lookupRes.status, errText);
          return NextResponse.json(
            { error: "Could not retrieve existing user from auth." },
            { status: 502 },
          );
        }
        const lookupData = (await lookupRes.json()) as unknown;
        type AuthUser = { id: string; email: string };
        const userList: AuthUser[] =
          (lookupData as { data?: AuthUser[] })?.data ??
          (lookupData as { users?: AuthUser[] })?.users ??
          (Array.isArray(lookupData) ? (lookupData as AuthUser[]) : []);
        const matchedUser = userList.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase(),
        );
        const authUserId = matchedUser?.id ?? "";
        if (!authUserId) {
          return NextResponse.json(
            { error: "User exists in auth but could not be located in user list." },
            { status: 502 },
          );
        }
        userId = authUserId;
        await query(
          `INSERT INTO ${SCHEMA}.profiles (id, email, full_name, status, updated_at)
                     VALUES ($1, $2, $3, 'invited', NOW())
                     ON CONFLICT (id) DO UPDATE SET
                         email      = EXCLUDED.email,
                         status     = 'invited',
                         updated_at = NOW()`,
          [userId, email, email.split("@")[0]],
        );
        shouldSendEmail = true;
      } else {
        const errBody = await createRes.text();
        console.error("InsForge user creation error:", createRes.status, errBody);
        return NextResponse.json(
          { error: "Failed to create user account." },
          { status: 502 },
        );
      }
    }

    // Send invite email for new users and re-invites
    if (shouldSendEmail) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
      const inviteHtml = isNewUser
        ? `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:40px;">
  <div style="max-width:480px;margin:0 auto;background:#161b22;border-radius:12px;padding:32px;">
    <h2 style="color:#58a6ff;margin-top:0;">You've been invited to OneWork</h2>
    <p>You've been added to a workspace. Use the credentials below to sign in and get started:</p>
    <div style="background:#0d1117;border-radius:8px;padding:16px;margin:24px 0;">
      <p style="margin:4px 0;"><strong>Email:</strong> ${email}</p>
      <p style="margin:4px 0;"><strong>Temporary password:</strong> <span style="font-family:monospace;color:#58a6ff;">${tempPassword}</span></p>
    </div>
    <a href="${appUrl}/login" style="display:inline-block;background:#238636;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Sign in to OneWork</a>
    <p style="margin-top:24px;color:#8b949e;font-size:13px;">Please change your password after signing in. This invite was sent on behalf of your workspace admin.</p>
  </div>
</body>
</html>`
        : `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:40px;">
  <div style="max-width:480px;margin:0 auto;background:#161b22;border-radius:12px;padding:32px;">
    <h2 style="color:#58a6ff;margin-top:0;">You've been added to a workspace on OneWork</h2>
    <p>You have been added to a new workspace. We've sent a <strong>separate email</strong> to this address with a 6-digit password reset code.</p>
    <p>To get started:</p>
    <ol style="padding-left:20px;line-height:1.8;">
      <li>Check your inbox for the password reset code email.</li>
      <li>On the OneWork login page, click <strong>&ldquo;Forgot Password&rdquo;</strong>.</li>
      <li>Enter your email and the 6-digit code to set a new password.</li>
    </ol>
    <a href="${appUrl}/login" style="display:inline-block;background:#238636;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Login</a>
    <p style="margin-top:24px;color:#8b949e;font-size:13px;">If you already know your password, you can sign in directly. This invite was sent on behalf of your workspace admin.</p>
  </div>
</body>
</html>`;

      await fetch(`${insforgeBase}/api/email/send-raw`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.INSFORGE_API_KEY!,
        },
        body: JSON.stringify({
          to: [email],
          subject: "You've been invited to OneWork",
          html: inviteHtml,
        }),
        cache: "no-store",
      }).catch((err) => console.error("Failed to send invite email:", err));
    }

    // Add to workspace_members (upsert role if already a member)
    await query(
      `INSERT INTO ${SCHEMA}.workspace_members (workspace_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [workspaceId, userId, dbRole],
    );

    void import('@/lib/integrations/git/provisioning').then(({ ensureOneworkMemberIntegration }) =>
      ensureOneworkMemberIntegration({
        workspaceId,
        userId,
        email,
        fullName: email.split('@')[0],
      }),
    ).catch((err) => console.error('[onework-vc] member invite provision:', err));

    return NextResponse.json(
      { message: "Invitation sent successfully." },
      { status: 201 },
    );
  } catch (error: unknown) {
    if (error instanceof WorkspaceAccessError) {
      const status = error.message === "Unauthorized" ? 401 : 403;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Error inviting member:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
