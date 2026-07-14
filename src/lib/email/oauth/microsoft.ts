export type MicrosoftTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

export async function exchangeMicrosoftAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<MicrosoftTokenResponse> {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Microsoft OAuth is not configured");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  const data = (await res.json()) as MicrosoftTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || "Microsoft token exchange failed",
    );
  }
  return data;
}

export async function refreshMicrosoftAccessToken(
  refreshToken: string,
): Promise<MicrosoftTokenResponse> {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Microsoft OAuth is not configured");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  const data = (await res.json()) as MicrosoftTokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.error_description || data.error || "Microsoft token refresh failed",
    );
  }
  return data;
}

export async function fetchMicrosoftPrimaryEmail(
  accessToken: string,
): Promise<string> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as {
    mail?: string;
    userPrincipalName?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message || "Could not read Microsoft account profile",
    );
  }
  const email = (data.mail || data.userPrincipalName || "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Microsoft account has no usable email address");
  }
  return email;
}
