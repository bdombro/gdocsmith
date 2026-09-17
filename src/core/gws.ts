/* Direct Google Docs and Drive REST API client using gws OAuth tokens. */

import { getValidAccessToken } from "./auth.ts";
import type { GoogleDoc } from "./types.ts";

export const GOOGLE_DOC_MIMETYPE = "application/vnd.google-apps.document";
const DOCS_BASE_URL = "https://docs.googleapis.com/v1";
const DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";

export type ApiFetcher = (url: string, options?: RequestInit) => Promise<Response>;

/** Parses and formats Google Workspace / HTTP errors into actionable messages. */
export function gwsErrorFormat(raw: string, targetId?: string): string {
  if (!raw?.trim()) {
    return targetId ? `GWS operation failed for target ${targetId}` : "GWS operation failed";
  }

  const trimmed = raw.trim();
  let apiMessage: string | undefined;
  let status: number | string | undefined;

  // Try extracting error payload from JSON
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed.error) {
      status = parsed.error.code ?? parsed.error.status;
      apiMessage = parsed.error.message;
    }
  } catch {
    const match = trimmed.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.error) {
          status = parsed.error.code ?? parsed.error.status;
          apiMessage = parsed.error.message;
        }
      } catch {
        // Ignore JSON parse failure on regex snippet
      }
    }
  }

  const combined = `${trimmed} ${apiMessage ?? ""}`;

  // 403 Forbidden / Permission denied
  if (
    status === 403 ||
    /insufficient(File)?Permissions/i.test(combined) ||
    /does not have permission/i.test(combined) ||
    /not have write access/i.test(combined) ||
    /Access denied/i.test(combined)
  ) {
    const idHint = targetId ? ` on "${targetId}"` : "";
    const detail = apiMessage ? `: ${apiMessage}` : "";
    return `Permission denied${idHint}. You do not have sufficient permissions (e.g. view-only access, or restricted shared drive)${detail}.`;
  }

  // 404 Not Found
  if (
    status === 404 ||
    /notFound/i.test(combined) ||
    /File not found/i.test(combined) ||
    /Requested entity was not found/i.test(combined)
  ) {
    const idHint = targetId ? ` "${targetId}"` : "";
    return `Document or file not found${idHint}. Check that the ID or URL is correct and shared with your account.`;
  }

  // 401 Unauthorized
  if (
    status === 401 ||
    /invalid_grant|invalid authentication credentials|Unauthorized|Login Required/i.test(combined)
  ) {
    return "Google Workspace authentication expired or invalid. Run 'gws auth login' to re-authenticate.";
  }

  return apiMessage ? `Google API error (${status ?? "error"}): ${apiMessage}` : trimmed;
}

/** Parses and formats Google Workspace / HTTP errors (alias for gwsErrorFormat). */
export const formatGwsError = gwsErrorFormat;

/** Asserts that a Drive file is a Google Doc, unless force is true. */
export function googleDocMimeAssert(file: { name?: string; mimeType?: string }, force?: boolean): void {
  if (force) return;
  if (file.mimeType && file.mimeType !== GOOGLE_DOC_MIMETYPE) {
    throw new Error(
      `Target "${file.name ?? "file"}" is not a Google Doc (mimeType: ${file.mimeType}). Pass --force to override, or use "gws drive" for other file types.`,
    );
  }
}

/** Asserts that a Drive file is a Google Doc (alias for googleDocMimeAssert). */
export const assertGoogleDocMime = googleDocMimeAssert;

/** Low-level authenticated fetch helper with 401 retry. */
export async function googleApiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  let token = await getValidAccessToken();

  let res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  // If token expired, force refresh once and retry
  if (res.status === 401) {
    token = await getValidAccessToken(true);
    res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return res;
}

/** Low-level authenticated fetch helper with 401 retry (alias for googleApiFetch). */
export const fetchGoogleApi = googleApiFetch;

export interface DocsClient {
  /** Sends batchUpdate requests to the Google Docs API. */
  batchUpdate(documentId: string, requests: object[], opts?: { requiredRevisionId?: string }): Promise<string>;
  /** Creates a new Google Doc with the specified title. */
  createDocument?(title: string): Promise<{ documentId: string; title: string }>;
  /** Fetches document data with full tabs content. */
  getDocument(documentId: string): Promise<GoogleDoc>;
  /** Executes an arbitrary gws CLI command. */
  run(args: string[]): Promise<string>;
}

/** Invokes direct REST API for Google Docs API access (no CLI fallback). */
export class GwsClientImpl implements DocsClient {
  constructor(private fetcher: ApiFetcher = fetchGoogleApi) {}

  /** Sends a batchUpdate request payload to the Docs API. Never retried — a timeout after a successful write would double-apply. */
  async batchUpdate(
    documentId: string,
    requests: object[],
    opts: { requiredRevisionId?: string } = {},
  ): Promise<string> {
    const body: { requests: object[]; writeControl?: { requiredRevisionId: string } } = { requests };
    if (opts.requiredRevisionId) {
      body.writeControl = { requiredRevisionId: opts.requiredRevisionId };
    }

    try {
      const url = `${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}:batchUpdate`;
      const res = await this.fetcher(url, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, documentId));
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, documentId));
    }
  }

  /** Creates a new Google Doc via documents.create. */
  async createDocument(title: string): Promise<{ documentId: string; title: string }> {
    try {
      const url = `${DOCS_BASE_URL}/documents`;
      const res = await this.fetcher(url, {
        body: JSON.stringify({ title }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg));
    }
  }

  /** Fetches the full document with tab content. */
  async getDocument(documentId: string): Promise<GoogleDoc> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = `${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}?includeTabsContent=true`;
        const res = await this.fetcher(url);
        const text = await res.text();
        if (!res.ok) {
          throw new Error(formatGwsError(text, documentId));
        }
        return JSON.parse(text) as GoogleDoc;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < 2 && /HTTP request failed|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(msg)) {
          await Bun.sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error(formatGwsError(msg, documentId));
      }
    }
    const finalMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(formatGwsError(finalMsg, documentId));
  }

  /** Runs an arbitrary gws command and returns stdout or throws on failure. */
  async run(args: string[]): Promise<string> {
    const proc = Bun.spawn(["gws", ...args], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [code, stderr, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
    ]);
    if (code !== 0) throw new Error(stderr || stdout || `gws exited ${code}`);
    return stdout;
  }
}

/** Default client instance used by Gdoc.load. */
export const gws: GwsClientImpl = new GwsClientImpl();
export type GwsClient = DocsClient;

/** Invokes direct REST API for Google Drive API access (no CLI fallback). */
export class DriveClient {
  constructor(private fetcher: ApiFetcher = fetchGoogleApi) {}

  /** Fetches Drive file metadata (supports all drives). */
  async getFile(
    fileId: string,
    fields = "id,name,mimeType,trashed",
  ): Promise<{ id: string; name: string; mimeType: string; trashed?: boolean }> {
    try {
      const q = new URLSearchParams({
        fields,
        supportsAllDrives: "true",
      });
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?${q.toString()}`;
      const res = await this.fetcher(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }

  /** Copies a Drive file (supports all drives). */
  async copyFile(fileId: string, name: string): Promise<{ id: string; name: string }> {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true`;
      const res = await this.fetcher(url, {
        body: JSON.stringify({ name }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }

  /** Updates Drive file metadata (name, trashed, etc.) */
  async updateFile(
    fileId: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; name: string; trashed?: boolean }> {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`;
      const res = await this.fetcher(url, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }

  /** Permanently deletes a file from Drive. */
  async deleteFile(fileId: string): Promise<void> {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`;
      const res = await this.fetcher(url, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const text = await res.text();
        throw new Error(formatGwsError(text, fileId));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }
}

/** Default Drive client instance. */
export const gwsDrive = new DriveClient();
