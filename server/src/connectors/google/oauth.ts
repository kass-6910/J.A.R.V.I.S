import { config } from "../../config.js";

export { GOOGLE_SCOPES } from "./scopes.js";

export function isGoogleConfigured(): boolean {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REFRESH_TOKEN);
}

let accessToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) return accessToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: config.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google OAuth a refusé le jeton (${res.status}) : ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return accessToken.value;
}
