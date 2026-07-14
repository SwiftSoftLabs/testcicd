import { NextResponse } from "next/server";

import { getUserFromRequest, query, SCHEMA } from "@/lib/db";
import {
  createMailAuditEvent,
  getPrimaryMailAccountWithSecret,
} from "@/lib/email/accounts";
import { encryptMailboxSecret } from "@/lib/email/crypto";
import {
  exchangeGoogleAuthorizationCode,
  fetchGooglePrimaryEmail,
} from "@/lib/email/oauth/google";
import {
  exchangeMicrosoftAuthorizationCode,
  fetchMicrosoftPrimaryEmail,
} from "@/lib/email/oauth/microsoft";
import {
  mailOAuthCallbackUrl,
  verifyMailOAuthState,
  type MailOAuthProvider,
} from "@/lib/email/oauth/state";
import { providerPresetByType } from "@/lib/email/providers/profiles";
import { runMailboxSync } from "@/lib/email/sync";

function safeOriginFromRequest(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(request.url).origin;
}

function safeReturnTo(request: Request, pathOrUrl: string): string {
  const origin = safeOriginFromRequest(request);
  if (pathOrUrl.startsWith("http")) {
    try {
      const u = new URL(pathOrUrl);
      const o = new URL(origin);
      if (u.origin === o.origin && u.pathname.startsWith("/")) {
        return pathOrUrl;
      }
    } catch {
      /* fallback */
    }
    return `${origin}/settings/plugins`;
  }
  if (pathOrUrl.startsWith("/")) return `${origin}${pathOrUrl}`;
  return `${origin}/settings/plugins`;
}

export function redirectWithMailOAuth(
  request: Request,
  returnTo: string,
  params: Record<string, string>,
): NextResponse {
  const base = safeReturnTo(request, returnTo);
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return NextResponse.redirect(u.toString());
}

export function mailOAuthPopupResponse(payload: {
  status: "connected" | "error";
  error?: string;
}): NextResponse {
  const body = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Mailbox</title></head>
<body>
<script>
(function () {
  var msg = ${JSON.stringify({
    source: "onework-mail-oauth",
    status: payload.status,
    ...(payload.error ? { error: payload.error } : {}),
  })};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(msg, location.origin);
    }
  } catch (e) {}
  window.close();
})();
</script>
<p style="font-family:system-ui">You can close this window.</p>
</body>
</html>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function handleMailOAuthCallback(
  request: Request,
  provider: MailOAuthProvider,
  code: string,
  stateToken: string,
): Promise<NextResponse> {
  let payload;
  try {
    payload = verifyMailOAuthState(stateToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid state";
    return redirectWithMailOAuth(request, "/settings/plugins", {
      mailOAuth: "error",
      error: msg,
    });
  }

  const user = await getUserFromRequest(request);
  if (!user) {
    const origin = safeOriginFromRequest(request);
    return NextResponse.redirect(
      `${origin}/login?error=mail_oauth_unauthorized`,
    );
  }
  if (user.id !== payload.userId) {
    const err = "Session mismatch — try connecting again.";
    if (payload.popup) {
      return mailOAuthPopupResponse({ status: "error", error: err });
    }
    return redirectWithMailOAuth(request, payload.returnTo, {
      mailOAuth: "error",
      error: err,
    });
  }

  const redirectUri = mailOAuthCallbackUrl(provider);
  const providerType = provider === "google" ? "gmail" : "outlook";
  const preset = providerPresetByType(providerType);
  if (!preset) {
    const err = "Invalid mail provider preset";
    if (payload.popup)
      return mailOAuthPopupResponse({ status: "error", error: err });
    return redirectWithMailOAuth(request, payload.returnTo, {
      mailOAuth: "error",
      error: err,
    });
  }

  try {
    let accessToken: string;
    let refreshToken: string | undefined;
    let expiresIn: number;
    let emailAddress: string;

    if (provider === "google") {
      const tok = await exchangeGoogleAuthorizationCode(code, redirectUri);
      accessToken = tok.access_token;
      refreshToken = tok.refresh_token;
      expiresIn = tok.expires_in;
      emailAddress = await fetchGooglePrimaryEmail(accessToken);
    } else {
      const tok = await exchangeMicrosoftAuthorizationCode(code, redirectUri);
      accessToken = tok.access_token;
      refreshToken = tok.refresh_token;
      expiresIn = tok.expires_in;
      emailAddress = await fetchMicrosoftPrimaryEmail(accessToken);
    }

    const encAccess = encryptMailboxSecret(accessToken);
    const encRefresh = refreshToken ? encryptMailboxSecret(refreshToken) : null;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const upsert = await query<{ id: string }>(
      `INSERT INTO ${SCHEMA}.mail_accounts (
                user_id, email_address, provider_type, auth_method, username,
                encrypted_password, encrypted_refresh_token, token_expires_at,
                imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
                status, sync_cursor
             ) VALUES (
                $1, $2, $3, 'oauth', $2,
                $4, $5, $6,
                $7, $8, $9, $10, $11, $12,
                'connected', '{}'::jsonb
             )
             ON CONFLICT (user_id, email_address)
             DO UPDATE SET
                provider_type = EXCLUDED.provider_type,
                auth_method = 'oauth',
                username = EXCLUDED.username,
                encrypted_password = EXCLUDED.encrypted_password,
                encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                imap_host = EXCLUDED.imap_host,
                imap_port = EXCLUDED.imap_port,
                imap_secure = EXCLUDED.imap_secure,
                smtp_host = EXCLUDED.smtp_host,
                smtp_port = EXCLUDED.smtp_port,
                smtp_secure = EXCLUDED.smtp_secure,
                status = 'connected',
                sync_cursor = '{}'::jsonb,
                updated_at = NOW()
             RETURNING id`,
      [
        user.id,
        emailAddress,
        providerType,
        encAccess,
        encRefresh,
        expiresAt.toISOString(),
        preset.imapHost,
        preset.imapPort,
        preset.imapSecure,
        preset.smtpHost,
        preset.smtpPort,
        preset.smtpSecure,
      ],
    );

    const accountId = upsert.rows[0]?.id;
    await createMailAuditEvent(
      user.id,
      accountId ?? null,
      "MAIL_ACCOUNT_CONNECTED_OAUTH",
      {
        emailAddress,
        providerType,
        oauthProvider: provider,
        workspaceId: payload.workspaceId,
      },
    );

    const account = await getPrimaryMailAccountWithSecret(user.id);
    if (account) {
      try {
        await runMailboxSync(account, payload.workspaceId, "initial");
      } catch {
        await createMailAuditEvent(
          user.id,
          account.id,
          "MAIL_OAUTH_SYNC_FAILED",
          {
            emailAddress,
            workspaceId: payload.workspaceId,
          },
        );
      }
    }

    if (payload.popup) {
      return mailOAuthPopupResponse({ status: "connected" });
    }
    return redirectWithMailOAuth(request, payload.returnTo, {
      mailOAuth: "connected",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Mailbox OAuth failed";
    await createMailAuditEvent(
      user.id,
      null,
      "MAIL_ACCOUNT_CONNECT_OAUTH_FAILED",
      {
        provider,
        reason: msg,
      },
    );
    if (payload.popup) {
      return mailOAuthPopupResponse({ status: "error", error: msg });
    }
    return redirectWithMailOAuth(request, payload.returnTo, {
      mailOAuth: "error",
      error: msg,
    });
  }
}
