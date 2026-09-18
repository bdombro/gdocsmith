/* OAuth token provider for Google APIs using gws auth credentials. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { skillConfigLoad, skillConfigSave } from "./config.ts";

/** Promisified child process runner. */
const execFileAsync = promisify(execFile);

/**
 * Cached access token record with expiration time.
 */
export interface CachedToken {
  /** OAuth2 bearer access token string. */
  access_token: string;
  /** Unix timestamp in milliseconds when the token expires. */
  expires_at: number;
  /** Token type identifier (e.g. Bearer). */
  token_type?: string;
}

/**
 * Credentials structure exported by gws CLI.
 */
export interface GwsCredentials {
  /** Google OAuth client ID. */
  client_id: string;
  /** Google OAuth client secret. */
  client_secret: string;
  /** OAuth refresh token for obtaining fresh access tokens. */
  refresh_token: string;
  /** Optional credential type string. */
  type?: string;
}

/**
 * Refreshes the OAuth access token using Google's OAuth2 token endpoint.
 */
export async function accessTokenRefresh(
  /** Optional explicit credentials; defaults to reading via gws auth export. */
  creds?: GwsCredentials,
): Promise<CachedToken> {
  const credentials = creds ?? (await gwsCredentialsGet());

  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Google OAuth token refresh failed: ${msg}`);
  }

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

  memTokenCache = token;
  try {
    skillConfigSave({
      oauthToken: token,
    });
  } catch {
    // Config write failure shouldn't block execution
  }

  return token;
}

/**
 * Alias for accessTokenRefresh.
 */
export const refreshAccessToken = accessTokenRefresh;

/**
 * Extracts OAuth credentials by invoking `gws auth export --unmasked`.
 */
export async function gwsCredentialsGet(): Promise<GwsCredentials> {
  let stdout: string;
  try {
    const res = await execFileAsync("gws", ["auth", "export", "--unmasked"]);
    stdout = res.stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to export credentials from gws: ${msg}`);
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

/**
 * Alias for gwsCredentialsGet.
 */
export const getGwsCredentials = gwsCredentialsGet;

/**
 * Resets the in-memory token cache (primarily for testing).
 */
export function tokenCacheReset(): void {
  memTokenCache = null;
}

/**
 * Alias for tokenCacheReset.
 */
export const resetTokenCache = tokenCacheReset;

/**
 * Returns a valid access token from memory, disk cache, or by requesting a refresh.
 */
export async function validAccessTokenGet(
  /** When true, bypasses caches and forces a token refresh. */
  forceRefresh = false,
): Promise<string> {
  const now = Date.now();

  if (!forceRefresh && memTokenCache && memTokenCache.expires_at > now) {
    return memTokenCache.access_token;
  }

  if (!forceRefresh) {
    const config = skillConfigLoad();
    const diskToken = config.oauthToken;
    if (diskToken && diskToken.expires_at > now) {
      memTokenCache = diskToken;
      return diskToken.access_token;
    }
  }

  const refreshed = await accessTokenRefresh();
  return refreshed.access_token;
}

/**
 * Alias for validAccessTokenGet.
 */
export const getValidAccessToken = validAccessTokenGet;

/** In-memory cached token for fast repeated access during a single process run. */
let memTokenCache: CachedToken | null = null;
