/*

Image upload and URI resolution for insertInlineImage.

Stores: drive: (private blob via Apps Script), https: passthrough.

*/

import { AppsScriptImages } from "./apps-script-images.ts";
import type { GwsClient } from "./gws.ts";
import { gws } from "./gws.ts";
import { DriveImages } from "./images.ts";

export type UploadedImage = {
  /** Value stored on upload (drive: or https:). */
  src: string;
  /** Public HTTPS URL when applicable; drive: uses blob insert. */
  publicUrl: string;
  name: string;
  store: "drive" | "https";
  fileId?: string;
  parentFolderId?: string;
};

export type ImageStoreMode = "auto" | "drive";

export type ImageInsertOpts = {
  widthPt?: number;
  heightPt?: number;
  align?: string;
};

export interface ImageStore {
  upload(documentId: string, localPath: string, name?: string): Promise<UploadedImage>;
  resolve(src: string, documentId: string, localBase?: string): Promise<string>;
  usesDriveBlobInsert?(src: string): boolean;
  insertDriveBlob?(documentId: string, fileId: string, index: number, opts: ImageInsertOpts): Promise<void>;
}

export type ImageStoreOpts = {
  client?: GwsClient;
  mode?: ImageStoreMode;
  getDriveFolderId?: () => string | undefined;
  setDriveFolderId?: (folderId: string) => void;
  appsScript?: AppsScriptImages;
  drive?: DriveImages;
};

/** Routes uploads/resolves across Apps Script Drive blobs and https. */
export class CompositeImageStore implements ImageStore {
  readonly #drive: DriveImages;
  readonly #appsScript: AppsScriptImages;
  readonly #getDriveFolderId?: () => string | undefined;
  readonly #setDriveFolderId?: (folderId: string) => void;

  constructor(opts: ImageStoreOpts = {}) {
    const client = opts.client ?? gws;
    this.#drive = opts.drive ?? new DriveImages(client);
    this.#appsScript = opts.appsScript ?? new AppsScriptImages(client);
    this.#getDriveFolderId = opts.getDriveFolderId;
    this.#setDriveFolderId = opts.setDriveFolderId;
  }

  usesDriveBlobInsert(src: string): boolean {
    return src.trim().startsWith("drive:");
  }

  async insertDriveBlob(documentId: string, fileId: string, index: number, opts: ImageInsertOpts = {}): Promise<void> {
    await this.#appsScript.insertDriveImage(documentId, fileId, index, opts);
  }

  async upload(documentId: string, localPath: string, name?: string): Promise<UploadedImage> {
    try {
      return await this.#uploadDrive(documentId, localPath, name);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Drive image upload failed: ${detail}. Insert into the Doc still needs Apps Script API permission even after a successful upload.`,
      );
    }
  }

  async resolve(src: string, documentId: string, localBase?: string): Promise<string> {
    const trimmed = src.trim();
    if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
      return trimmed;
    }
    if (trimmed.startsWith("drive:")) {
      throw new Error(
        `drive:${trimmed.slice("drive:".length)} must be inserted via Apps Script blob path — ` +
          "ensure Apps Script bootstrap succeeded (src/core/apps-script-images.ts) and src is drive:ID",
      );
    }
    if (trimmed.startsWith("file:")) {
      const path = trimmed.slice("file:".length);
      const localPath = path.startsWith("/") ? path : `${localBase?.replace(/\/$/, "") ?? ""}/${path}`;
      const uploaded = await this.upload(documentId, localPath);
      if (uploaded.store === "drive") {
        throw new Error(`Uploaded ${uploaded.src} — apply uses Apps Script blob insert, not resolve`);
      }
      return uploaded.publicUrl;
    }
    throw new Error(`Unsupported image src "${src}" — use drive:, https://…, or file:relative.png`);
  }

  async #uploadDrive(documentId: string, localPath: string, name?: string): Promise<UploadedImage> {
    const cached = this.#getDriveFolderId?.();
    const uploaded = await this.#drive.upload(documentId, localPath, name, cached);
    this.#setDriveFolderId?.(uploaded.parentFolderId);
    return {
      fileId: uploaded.fileId,
      name: uploaded.name,
      parentFolderId: uploaded.parentFolderId,
      publicUrl: uploaded.src,
      src: uploaded.src,
      store: "drive",
    };
  }
}

/** Builds a composite store with optional Drive folder cache. */
export function createImageStore(opts: ImageStoreOpts = {}): CompositeImageStore {
  return new CompositeImageStore(opts);
}
