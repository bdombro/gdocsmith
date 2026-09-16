/*

OAuth token provider for Google APIs using gws auth credentials.

Caches access tokens until expiration, refreshing automatically via
https://oauth2.googleapis.com/token using credentials from `gws auth export`.

*/

import { loadSkillConfig, saveSkillConfig } from "./config.ts";

export interface GwsCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  type?: string;
}

export interface CachedToken {
  access_token: string;
  expires_at: number; // Unix timestamp in ms
  token_type?: string;
}

/** In-memory cached token for fast repeated access during a single process run. */
let memTokenCache: CachedToken | null = null;

/** Resets in-memory token cache (primarily for tests). */
export function resetTokenCache(): void {
  memTokenCache = null;
}

/** Extracts OAuth credentials by invoking `gws auth export --unmasked`. */
export async function getGwsCredentials(): Promise<GwsCredentials> {
  const proc = Bun.spawn(["gws", "auth", "export", "--unmasked"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [code, stderr, stdout] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ]);

  if (code !== 0) {
    throw new Error(`Failed to export credentials from gws (exit code ${code}): ${stderr || stdout}`);
  }

  try {
    const parsed = JSON.parse(stdout);
    if (!parsed.client_id || !parsed.client_secret || !parsed.refresh_token) {
      throw new Error("Missing required OAuth fields in gws credentials");
    }
    return parsed as GwsCredentials;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid gws auth export output: ${msg}`);
  }
}

/** Refreshes the OAuth access token using Google's OAuth2 endpoint. */
export async function refreshAccessToken(creds?: GwsCredentials): Promise<CachedToken> {
  const credentials = creds ?? (await getGwsCredentials());

  const res = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth token refresh failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    token_type?: string;
  };

  if (!data.access_token) {
    throw new Error("No access_token returned by Google OAuth endpoint");
  }

  // Set expiration with a 60-second safety margin
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  const token: CachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + Math.max(0, expiresInMs - 60_000),
    token_type: data.token_type,
  };

  // Cache in memory and persist in config
  memTokenCache = token;
  try {
    saveSkillConfig({
      oauthToken: token,
    });
  } catch {
    // Config write failure shouldn't block execution
  }

  return token;
}

/** Returns a valid access token, using memory cache, disk cache, or refreshing if needed. */
export async function getValidAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();

  if (!forceRefresh && memTokenCache && memTokenCache.expires_at > now) {
    return memTokenCache.access_token;
  }

  if (!forceRefresh) {
    const config = loadSkillConfig();
    const diskToken = config.oauthToken;
    if (diskToken && diskToken.expires_at > now) {
      memTokenCache = diskToken;
      return diskToken.access_token;
    }
  }

  const refreshed = await refreshAccessToken();
  return refreshed.access_token;
}
