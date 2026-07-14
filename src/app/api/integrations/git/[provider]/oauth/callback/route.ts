import { NextResponse } from "next/server";

import { exchangeGitHubOAuthCode } from "@/lib/integrations/git/github";
import { exchangeGitLabOAuthCode } from "@/lib/integrations/git/gitlab";
import { getProviderClient } from "@/lib/integrations/git/registry";
import { verifyOAuthState } from "@/lib/integrations/git/oauth";
import { upsertIntegration } from "@/lib/integrations/git/repository";
import { oauthCallbackQuerySchema } from "@/lib/integrations/git/schemas";

import {
  parseProviderParam,
  parseZodError,
  requireSessionUser,
} from "@/lib/integrations/git/route-helpers";
import {
  isWorkspaceMember,
  isProjectInWorkspace,
} from "@/lib/integrations/git/workspace";

function fallbackOrigin(req: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      /* continue */
    }
  }
  return new URL(req.url).origin;
}

function redirectFail(
  provider: string,
  message: string,
  returnTo?: string,
  request?: Request,
) {
  const origin = (() => {
    if (request) return fallbackOrigin(request);
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
    try {
      return new URL(base).origin;
    } catch {
      return "http://localhost:3000";
    }
  })();
  const base = returnTo?.trim() || `${origin}/settings/git-ssh`;
  const sep = base.includes("?") ? "&" : "?";
  const qs = `integration=${provider}&status=error&error=${encodeURIComponent(message)}`;
  return NextResponse.redirect(`${base}${sep}${qs}`);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const provider = parseProviderParam((await context.params).provider);
  if (provider === "onework") {
    return redirectFail(
      provider,
      "OneWork Version Control does not use OAuth",
      undefined,
      request,
    );
  }
  const { searchParams } = new URL(request.url);
  const raw = Object.fromEntries(searchParams.entries());

  try {
    const parsed = oauthCallbackQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return redirectFail(provider, parsed.error.message, undefined, request);
    }
    const { code, state, error, error_description } = parsed.data;

    let payload;
    try {
      payload = verifyOAuthState(state);
    } catch (e: unknown) {
      return redirectFail(provider, parseZodError(e), undefined, request);
    }

    if (error) {
      return redirectFail(
        provider,
        error_description || error,
        payload.returnTo,
        request,
      );
    }

    if (!code) {
      return redirectFail(
        provider,
        "Missing authorization code",
        payload.returnTo,
        request,
      );
    }

    const user = await requireSessionUser(request);
    if (!user) {
      const base = fallbackOrigin(request);
      return NextResponse.redirect(`${base}/login?error=oauth_unauthorized`);
    }
    if (user.id !== payload.userId || payload.provider !== provider) {
      return redirectFail(
        provider,
        "Session mismatch — try connecting again.",
        payload.returnTo,
        request,
      );
    }

    const member = await isWorkspaceMember(payload.workspaceId, user.id);
    if (!member) {
      return redirectFail(
        provider,
        "Workspace access denied",
        payload.returnTo,
        request,
      );
    }

    const projectOk = await isProjectInWorkspace(
      payload.projectId,
      payload.workspaceId,
    );
    if (!projectOk) {
      return redirectFail(
        provider,
        "Project not found in this workspace",
        payload.returnTo,
        request,
      );
    }

    if (provider === "github") {
      const tok = await exchangeGitHubOAuthCode(code);
      const client = getProviderClient("github", tok.access_token);
      const viewer = await client.getViewer();
      const scopes = tok.scope ? tok.scope.split(/[\s,]+/).filter(Boolean) : [];

      await upsertIntegration({
        workspaceId: payload.workspaceId,
        userId: user.id,
        provider: "github",
        authMethod: "oauth",
        accountLogin: viewer.login,
        accountId: viewer.id,
        accountAvatarUrl: viewer.avatarUrl,
        scopes,
        accessToken: tok.access_token,
        refreshToken: null,
        tokenExpiresAt: null,
      });
    } else {
      const tok = await exchangeGitLabOAuthCode(code);
      const client = getProviderClient("gitlab", tok.access_token);
      const viewer = await client.getViewer();
      await upsertIntegration({
        workspaceId: payload.workspaceId,
        userId: user.id,
        provider: "gitlab",
        authMethod: "oauth",
        accountLogin: viewer.login,
        accountId: viewer.id,
        accountAvatarUrl: viewer.avatarUrl,
        scopes: ["read_api", "read_repository", "read_user"],
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        tokenExpiresAt: tok.expires_in
          ? new Date(Date.now() + tok.expires_in * 1000)
          : null,
      });
    }

    const sep = payload.returnTo.includes("?") ? "&" : "?";
    const url = `${payload.returnTo}${sep}integration=${provider}&status=connected&projectId=${encodeURIComponent(payload.projectId)}&pickRepos=1`;
    return NextResponse.redirect(url);
  } catch (e: unknown) {
    return redirectFail(provider, parseZodError(e), undefined, request);
  }
}
