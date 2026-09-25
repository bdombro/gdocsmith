/* In-memory fake Docs + Drive client for offline tests: documents, revisions, comments, and permissions, backed by the emulator (see G3 M4). */

import type {
  DocsClient,
  DriveApi,
  DriveComment,
  DrivePermission,
  DrivePermissionCreateOptions,
  DrivePermissionInput,
} from "~/core/gws.ts";
import type { GoogleDoc } from "~/core/types.ts";
import type { JsonObject } from "../model/rawJson.ts";
import { requestsEmulate } from "./emulate.ts";

/** One call recorded in `FakeGoogle.callLog`, for assertions like "batchUpdate was called once per doc". */
export interface FakeGoogleCall {
  /** Positional arguments passed to the call. */ args: unknown[];
  /** Method name. */ method: string;
}

/** Internal per-document record: its current JSON, a monotonic revision counter, and lifecycle flags. */
interface FakeDoc {
  deleted: boolean;
  json: GoogleDoc;
  revision: number;
  trashed: boolean;
}

/**
 * In-memory `DocsClient` + `DriveApi` for tests, backed entirely by `requestsEmulate`. Revisions
 * are `rev-<N>`, incrementing on every successful `batchUpdate`; a mismatched
 * `requiredRevisionId` throws the same message text real `batchUpdate` uses on conflict (a
 * placeholder pending G3 M5's recorded text).
 */
export class FakeGoogle implements DocsClient, DriveApi {
  /** Every call made through this instance, in order. */
  callLog: FakeGoogleCall[] = [];
  /** Hook invoked right before a `batchUpdate`'s requests are applied, so a test can inject an external edit mid-flush. */
  beforeBatchUpdate?: (docId: string) => void;

  #comments = new Map<string, DriveComment[]>();
  #docs = new Map<string, FakeDoc>();
  #nextDocNum = 1;
  #nextPermNum = 1;
  #permissions = new Map<string, DrivePermission[]>();

  async batchUpdate(
    documentId: string,
    requests: object[],
    opts: { requiredRevisionId?: string } = {},
  ): Promise<string> {
    this.callLog.push({ args: [documentId, requests, opts], method: "batchUpdate" });
    const doc = this.#docRequire(documentId);
    if (opts.requiredRevisionId && opts.requiredRevisionId !== this.#revisionId(doc)) {
      throw new Error("The document revision ID provided does not match the current revision");
    }
    this.beforeBatchUpdate?.(documentId);
    const { json, replies } = requestsEmulate(doc.json, requests as JsonObject[]);
    doc.json = json;
    doc.revision += 1;
    return JSON.stringify({ documentId, replies, writeControl: { requiredRevisionId: this.#revisionId(doc) } });
  }

  async commentsList(fileId: string): Promise<DriveComment[]> {
    this.callLog.push({ args: [fileId], method: "commentsList" });
    return structuredClone(this.#comments.get(fileId) ?? []);
  }

  async copyFile(fileId: string, name: string): Promise<{ id: string; name: string }> {
    this.callLog.push({ args: [fileId, name], method: "copyFile" });
    const source = this.#docRequire(fileId);
    const id = `fake-doc-${this.#nextDocNum++}`;
    const json = { ...structuredClone(source.json), documentId: id, title: name } as GoogleDoc;
    this.#docs.set(id, { deleted: false, json, revision: 1, trashed: false });
    return { id, name };
  }

  async createDocument(title: string): Promise<{ documentId: string; title: string }> {
    this.callLog.push({ args: [title], method: "createDocument" });
    const documentId = `fake-doc-${this.#nextDocNum++}`;
    this.#docs.set(documentId, { deleted: false, json: blankDocJson(documentId, title), revision: 1, trashed: false });
    return { documentId, title };
  }

  async createPermission(
    fileId: string,
    permission: DrivePermissionInput,
    _options?: DrivePermissionCreateOptions,
  ): Promise<DrivePermission> {
    this.callLog.push({ args: [fileId, permission], method: "createPermission" });
    const created = { id: `perm-${this.#nextPermNum++}`, ...permission } as unknown as DrivePermission;
    this.#permissions.set(fileId, [...(this.#permissions.get(fileId) ?? []), created]);
    return created;
  }

  async deleteFile(fileId: string): Promise<void> {
    this.callLog.push({ args: [fileId], method: "deleteFile" });
    this.#docRequire(fileId).deleted = true;
  }

  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    this.callLog.push({ args: [fileId, permissionId], method: "deletePermission" });
    this.#permissions.set(
      fileId,
      (this.#permissions.get(fileId) ?? []).filter((p) => p.id !== permissionId),
    );
  }

  /** Simulates an edit made outside this session (e.g. by another collaborator), bumping the revision without going through `batchUpdate`'s revision check. */
  externalEdit(docId: string, requests: object[]): void {
    const doc = this.#docRequire(docId);
    doc.json = requestsEmulate(doc.json, requests as JsonObject[]).json;
    doc.revision += 1;
  }

  async getDocument(documentId: string): Promise<GoogleDoc> {
    this.callLog.push({ args: [documentId], method: "getDocument" });
    return structuredClone(this.#docRequire(documentId).json);
  }

  async listPermissions(fileId: string): Promise<DrivePermission[]> {
    this.callLog.push({ args: [fileId], method: "listPermissions" });
    return structuredClone(this.#permissions.get(fileId) ?? []);
  }

  async revisionIdGet(documentId: string): Promise<string | undefined> {
    return this.#revisionId(this.#docRequire(documentId));
  }

  async run(): Promise<string> {
    throw new Error("FakeGoogle.run is not implemented (no CLI in tests)");
  }

  /** Seeds a comment list for a doc/file id, as `commentsList` would return it (unresolved, non-deleted, quoted). */
  seedComments(fileId: string, comments: DriveComment[]): void {
    this.#comments.set(fileId, comments);
  }

  /** Seeds a document directly (bypassing `createDocument`), for tests that start from a fixture. */
  seedDocument(docId: string, json: GoogleDoc, opts: { revision?: number } = {}): void {
    this.#docs.set(docId, {
      deleted: false,
      json: structuredClone(json),
      revision: opts.revision ?? 1,
      trashed: false,
    });
  }

  async updateFile(
    fileId: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; name: string; trashed?: boolean }> {
    this.callLog.push({ args: [fileId, body], method: "updateFile" });
    const doc = this.#docRequire(fileId);
    if (typeof body.trashed === "boolean") doc.trashed = body.trashed;
    if (typeof body.name === "string") doc.json.title = body.name;
    return { id: fileId, name: doc.json.title ?? "", trashed: doc.trashed };
  }

  #docRequire(docId: string): FakeDoc {
    const doc = this.#docs.get(docId);
    if (!doc) throw new Error(`FakeGoogle: unknown document "${docId}"`);
    return doc;
  }

  #revisionId(doc: FakeDoc): string {
    return `rev-${doc.revision}`;
  }
}

/** A blank single-tab document: leading section break + one empty paragraph, matching what `documents.create` actually returns (see G1 `docCreate.ts`). */
function blankDocJson(documentId: string, title: string): GoogleDoc {
  return {
    documentId,
    revisionId: "rev-1",
    tabs: [
      {
        documentTab: {
          body: {
            content: [
              { endIndex: 1, sectionBreak: { sectionStyle: {} }, startIndex: 0 },
              {
                endIndex: 2,
                paragraph: { elements: [{ endIndex: 2, startIndex: 1, textRun: { content: "\n", textStyle: {} } }] },
                startIndex: 1,
              },
            ],
          },
        },
        tabProperties: { tabId: "t.0", title: "Tab 1" },
      },
    ],
    title,
  } as unknown as GoogleDoc;
}
