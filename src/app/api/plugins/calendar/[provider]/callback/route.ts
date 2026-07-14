import { NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/db';
import { exchangeCalendlyPluginCode, fetchCalendlyPluginUser } from '@/lib/plugins/calendar/calendly';
import { exchangeGooglePluginCode, fetchGooglePluginUser } from '@/lib/plugins/calendar/google';
import { exchangeOutlookPluginCode, fetchOutlookPluginUser } from '@/lib/plugins/calendar/outlook';
import { parsePluginProviderParam, safeReturnTo, verifyCalendarPluginOAuthState } from '@/lib/plugins/calendar/oauth';
import { upsertCalendarPluginInstallation } from '@/lib/plugins/calendar/repository';
import { syncCalendarPluginForUser } from '@/lib/plugins/calendar/sync-engine';

function popupResponse(payload: { status: 'connected' | 'error'; error?: string }): NextResponse {
    const body = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Calendar plugin</title></head>
<body>
<script>
(function () {
  var msg = ${JSON.stringify({ source: 'onework-calendar-plugin-oauth', ...payload })};
  try {
    if (window.opener && !window.opener.closed) window.opener.postMessage(msg, location.origin);
  } catch (e) {}
  window.close();
})();
</script>
<p style="font-family:system-ui">You can close this window.</p>
</body>
</html>`;
    return new NextResponse(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function redirectWith(returnTo: string, params: Record<string, string>): NextResponse {
    const url = new URL(returnTo);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return NextResponse.redirect(url.toString());
}

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
    const provider = parsePluginProviderParam((await context.params).provider);
    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state') ?? '';
    const code = searchParams.get('code');
    const oauthError = searchParams.get('error');
    const oauthErrorDescription = searchParams.get('error_description');

    let payload;
    try {
        payload = verifyCalendarPluginOAuthState(state);
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Invalid OAuth state';
        return redirectWith(safeReturnTo(request, '/settings/plugins'), { pluginOAuth: 'error', error: msg });
    }

    const fail = (message: string) => {
        if (payload.popup) return popupResponse({ status: 'error', error: message });
        return redirectWith(payload.returnTo, { pluginOAuth: 'error', error: message });
    };

    if (payload.provider !== provider) return fail('Provider mismatch. Try connecting again.');
    if (oauthError) return fail(oauthErrorDescription || oauthError);
    if (!code) return fail('Missing authorization code');

    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.redirect(`${new URL(payload.returnTo).origin}/login?error=calendar_plugin_oauth_unauthorized`);
    if (user.id !== payload.userId) return fail('Session mismatch. Try connecting again.');

    try {
        if (provider === 'google_calendar') {
            const token = await exchangeGooglePluginCode(code);
            const profile = await fetchGooglePluginUser(token.access_token);
            await upsertCalendarPluginInstallation({
                userId: user.id,
                provider,
                accountEmail: profile.email,
                accountName: profile.name,
                accountId: profile.id,
                scopes: token.scope?.split(/\s+/).filter(Boolean) ?? ['https://www.googleapis.com/auth/calendar'],
                accessToken: token.access_token,
                refreshToken: token.refresh_token ?? null,
                tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            });
        } else if (provider === 'outlook') {
            const token = await exchangeOutlookPluginCode(code);
            const profile = await fetchOutlookPluginUser(token.access_token);
            await upsertCalendarPluginInstallation({
                userId: user.id,
                provider,
                accountEmail: profile.email,
                accountName: profile.name,
                accountId: profile.id,
                scopes: token.scope?.split(/\s+/).filter(Boolean) ?? ['Calendars.ReadWrite'],
                accessToken: token.access_token,
                refreshToken: token.refresh_token ?? null,
                tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
            });
        } else {
            const token = await exchangeCalendlyPluginCode(code);
            const profile = await fetchCalendlyPluginUser(token.access_token);
            await upsertCalendarPluginInstallation({
                userId: user.id,
                provider,
                accountEmail: profile.email,
                accountName: profile.name,
                accountId: profile.id,
                scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
                accessToken: token.access_token,
                refreshToken: token.refresh_token ?? null,
                tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            });
        }

        try {
            await syncCalendarPluginForUser(user.id, provider);
        } catch {
            /* initial sync is best-effort */
        }

        if (payload.popup) return popupResponse({ status: 'connected' });
        return redirectWith(payload.returnTo, { pluginOAuth: 'connected' });
    } catch (error: unknown) {
        return fail(error instanceof Error ? error.message : 'Calendar plugin connection failed');
    }
}
