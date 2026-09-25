/* Direct Google Docs and Drive REST API client using gws OAuth tokens. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getValidAccessToken } from "./auth.ts";
import { fetchWithRetry } from "./fetchWithRetry.ts";
import type { GoogleDoc } from "./types.ts";

/** Promisified child process runner. */
const execFileAsync = promisify(execFile);

export const GOOGLE_DOC_MIMETYPE = "application/vnd.google-apps.document";
const DOCS_BASE_URL = "https://docs.googleapis.com/v1";
const DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";

export type ApiFetcher = (url: string, options?: RequestInit) => Promise<Response>;

/** Drive file permission returned by the Drive v3 API. */
export type DrivePermission = {
  /** Display name of the grantee. */
  displayName?: string;
  /** Domain name when grantee is a domain. */
  domain?: string;
  /** Email address of user or group grantee. */
  emailAddress?: string;
  /** Unique ID of the permission. */
  id: string;
  /** Role granted to the grantee. */
  role: DrivePermissionRole;
  /** Grantee category or scope. */
  type: DrivePermissionScope;
};

/** Optional query parameters for Drive permission creation. */
export type DrivePermissionCreateOptions = {
  /** Plain text message included in notification emails. */
  emailMessage?: string;
  /** Whether to move the file to the new owner's My Drive root when transferring ownership. */
  moveToNewOwnersRoot?: boolean;
  /** Whether to send notification email to grantees. */
  sendNotificationEmail?: boolean;
  /** Whether to transfer file ownership to grantee (role must be 'owner'). */
  transferOwnership?: boolean;
};

/** Body payload for creating a Drive file permission. */
export type DrivePermissionInput = {
  /** Domain name when type is 'domain'. */
  domain?: string;
  /** Email address for user or group grantee. */
  emailAddress?: string;
  /** Access role granted by the permission. */
  role: DrivePermissionRole;
  /** Grantee access scope. */
  type: DrivePermissionScope;
};

/** Role assigned to a Drive file permission. */
export type DrivePermissionRole = "commenter" | "fileOrganizer" | "organizer" | "owner" | "reader" | "writer";

/** Grantee access scope for a Drive file permission. */
export type DrivePermissionScope = "anyone" | "domain" | "group" | "internal" | "user";

/** One Drive comment (only the fields the G3 comment/suggestion guard needs). */
export type DriveComment = {
  /** True when the comment was deleted (its `quotedFileContent` is stripped by the API). */ deleted?: boolean;
  /** Comment id. */ id: string;
  /** The exact text the comment anchors to, when not deleted. */ quotedFileContent?: { value?: string };
  /** True when the comment thread has been resolved. */ resolved?: boolean;
};

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
  /** Lightweight Docs revisionId for cache freshness (no tab bodies). */
  revisionIdGet?(documentId: string): Promise<string | undefined>;
  /** Executes an arbitrary gws CLI command. */
  run(args: string[]): Promise<string>;
}

/** Drive operations the G3 core engine needs (copy, permissions, comments, delete/trash), independent of the Docs-specific `DocsClient`. */
export interface DriveApi {
  /** Lists a file's unresolved, non-deleted, non-empty-quote comments (paginated internally). */
  commentsList(fileId: string): Promise<DriveComment[]>;
  /** Copies a Drive file (supports all drives). */
  copyFile(fileId: string, name: string): Promise<{ id: string; name: string }>;
  /** Creates a permission on a Drive file. */
  createPermission(
    fileId: string,
    permission: DrivePermissionInput,
    options?: DrivePermissionCreateOptions,
  ): Promise<DrivePermission>;
  /** Permanently deletes a file from Drive. */
  deleteFile(fileId: string): Promise<void>;
  /** Deletes an existing permission from a Drive file. */
  deletePermission(fileId: string, permissionId: string): Promise<void>;
  /** Lists a file's permissions. */
  listPermissions(fileId: string, fields?: string): Promise<DrivePermission[]>;
  /** Updates Drive file metadata (name, trashed, etc). */
  updateFile(fileId: string, body: Record<string, unknown>): Promise<{ id: string; name: string; trashed?: boolean }>;
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
    const url = `${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}?includeTabsContent=true`;
    try {
      const res = await fetchWithRetry(url, undefined, {
        fetcher: this.fetcher,
        retries: 3,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, documentId));
      }
      return JSON.parse(text) as GoogleDoc;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, documentId));
    }
  }

  /** Fetches Docs revisionId without downloading tab content (Google Docs use this, not Drive headRevisionId). */
  async revisionIdGet(documentId: string): Promise<string | undefined> {
    try {
      const url = `${DOCS_BASE_URL}/documents/${encodeURIComponent(documentId)}?fields=revisionId`;
      const res = await fetchWithRetry(url, undefined, {
        fetcher: this.fetcher,
        retries: 3,
      });
      const text = await res.text();
      if (!res.ok) return undefined;
      const data = JSON.parse(text) as { revisionId?: string };
      return data.revisionId;
    } catch {
      return undefined;
    }
  }

  /** Runs an arbitrary gws command and returns stdout or throws on failure. */
  async run(args: string[]): Promise<string> {
    try {
      const res = await execFileAsync("gws", args);
      return res.stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`gws failed: ${msg}`);
    }
  }
}

/** Default client instance used by Gdoc.load. */
export const gws: GwsClientImpl = new GwsClientImpl();
export type GwsClient = DocsClient;

/** Invokes direct REST API for Google Drive API access (no CLI fallback). */
export class DriveClient implements DriveApi {
  /** Memoized workspace domain from the authenticated Drive user profile. */
  private cachedUserDomain?: string;

  constructor(private fetcher: ApiFetcher = fetchGoogleApi) {}

  /** Lists a file's unresolved, non-deleted comments with a non-empty quote, following pagination. */
  async commentsList(
    /** Target Drive file ID. */
    fileId: string,
  ): Promise<DriveComment[]> {
    const comments: DriveComment[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const q = new URLSearchParams({
          fields: "comments(id,resolved,deleted,quotedFileContent/value),nextPageToken",
          includeDeleted: "false",
          pageSize: "100",
        });
        if (pageToken) q.set("pageToken", pageToken);
        const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/comments?${q.toString()}`;
        const res = await this.fetcher(url);
        const text = await res.text();
        if (!res.ok) throw new Error(formatGwsError(text, fileId));
        const data = JSON.parse(text) as { comments?: DriveComment[]; nextPageToken?: string };
        for (const comment of data.comments ?? []) {
          if (!comment.resolved && !comment.deleted && comment.quotedFileContent?.value) comments.push(comment);
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
      return comments;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }

  /** Copies a Drive file (supports all drives). */
  async copyFile(
    /** ID of the Drive file to copy. */
    fileId: string,
    /** Title for the newly copied file. */
    name: string,
  ): Promise<{ id: string; name: string }> {
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

  /** Creates a permission on a Drive file (supports all drives). */
  async createPermission(
    /** Target Drive file ID. */
    fileId: string,
    /** Body payload describing the grantee role and type. */
    permission: DrivePermissionInput,
    /** Optional sharing settings such as email notification or transfer. */
    options?: DrivePermissionCreateOptions,
  ): Promise<DrivePermission> {
    try {
      const q = new URLSearchParams({
        fields: "id,displayName,emailAddress,domain,role,type",
        supportsAllDrives: "true",
      });
      if (options?.emailMessage) q.set("emailMessage", options.emailMessage);
      if (options?.moveToNewOwnersRoot != null) q.set("moveToNewOwnersRoot", String(options.moveToNewOwnersRoot));
      if (options?.sendNotificationEmail != null) q.set("sendNotificationEmail", String(options.sendNotificationEmail));
      if (options?.transferOwnership != null) q.set("transferOwnership", String(options.transferOwnership));

      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/permissions?${q.toString()}`;
      const body: Record<string, unknown> = {
        role: permission.role,
        type: permission.type === "internal" ? "domain" : permission.type,
      };
      if (permission.emailAddress) body.emailAddress = permission.emailAddress;
      if (permission.domain) body.domain = permission.domain;

      const res = await this.fetcher(url, {
        body: JSON.stringify(body),
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

  /** Permanently deletes a file from Drive. */
  async deleteFile(
    /** Target Drive file ID to permanently delete. */
    fileId: string,
  ): Promise<void> {
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

  /** Deletes an existing permission from a Drive file (supports all drives). */
  async deletePermission(
    /** Target Drive file ID. */
    fileId: string,
    /** Permission ID to revoke. */
    permissionId: string,
  ): Promise<void> {
    try {
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`;
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

  /** Fetches Drive file metadata (supports all drives). */
  async getFile(
    /** Target Drive file ID. */
    fileId: string,
    /** Drive API field projection string. */
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

  /** Alias for headRevisionIdGet. */
  async getHeadRevisionId(
    /** Target Drive file ID. */
    fileId: string,
  ): Promise<string | undefined> {
    return this.headRevisionIdGet(fileId);
  }

  /** Fetches the head revision ID of a Drive file for cache freshness verification. */
  async headRevisionIdGet(
    /** Target Drive file ID. */
    fileId: string,
  ): Promise<string | undefined> {
    try {
      const q = new URLSearchParams({
        fields: "headRevisionId",
        supportsAllDrives: "true",
      });
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?${q.toString()}`;
      const res = await fetchWithRetry(url, undefined, {
        fetcher: this.fetcher,
        retries: 3,
      });
      const text = await res.text();
      if (!res.ok) return undefined;
      const data = JSON.parse(text) as { headRevisionId?: string };
      return data.headRevisionId;
    } catch {
      return undefined;
    }
  }

  /** Lists permissions on a Drive file (supports all drives). */
  async listPermissions(
    /** Target Drive file ID. */
    fileId: string,
    /** Drive API field projection string. */
    fields = "permissions(id,displayName,emailAddress,domain,role,type)",
  ): Promise<DrivePermission[]> {
    try {
      const q = new URLSearchParams({
        fields,
        pageSize: "100",
        supportsAllDrives: "true",
      });
      const url = `${DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}/permissions?${q.toString()}`;
      const res = await this.fetcher(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text, fileId));
      }
      const data = JSON.parse(text) as { permissions?: DrivePermission[] };
      return data.permissions ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg, fileId));
    }
  }

  /** Updates Drive file metadata (name, trashed, etc.) */
  async updateFile(
    /** Target Drive file ID. */
    fileId: string,
    /** Metadata patch payload. */
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

  /** Fetches the authenticated user's Google Workspace domain from Drive metadata. */
  async userDomainGet(): Promise<string> {
    if (this.cachedUserDomain) {
      return this.cachedUserDomain;
    }
    try {
      const url = `${DRIVE_BASE_URL}/about?fields=user`;
      const res = await this.fetcher(url);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(formatGwsError(text));
      }
      const data = JSON.parse(text) as { user?: { emailAddress?: string } };
      const email = data.user?.emailAddress;
      const domain = email?.split("@")[1];
      if (!domain || domain.toLowerCase() === "gmail.com" || domain.toLowerCase() === "googlemail.com") {
        throw new Error(
          `Cannot auto-detect workspace domain from personal account "${email ?? "unknown"}". Specify domain: "<domain>".`,
        );
      }
      this.cachedUserDomain = domain;
      return domain;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(formatGwsError(msg));
    }
  }
}

/** Default Drive client instance. */
export const gwsDrive = new DriveClient();
