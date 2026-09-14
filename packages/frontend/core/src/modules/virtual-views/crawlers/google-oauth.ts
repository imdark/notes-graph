import { getLinkCardBaseUrl } from '../../link-card';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Exchange a Google OAuth refresh token for a short-lived access token,
 * server-side through the sidecar (the client secret must not touch the
 * browser network layer directly). Shared by the Gmail and Drive crawlers.
 */
export async function getGoogleAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const res = await fetch(
    `${getLinkCardBaseUrl()}/clip/fetch?url=${encodeURIComponent(TOKEN_URL)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    }
  );
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!json.access_token) {
    throw new Error(
      json.error_description ?? json.error ?? 'Google token refresh failed'
    );
  }
  return json.access_token;
}
