/* Image upload and URI resolution for insertInlineImage. */

import { AppsScriptImages } from "./appsScriptImages.ts";
import { type GwsClient, gws } from "./gws.ts";
import { DriveImages } from "./images.ts";

/** Options for sizing and positioning an inserted image. */
export type ImageInsertOpts = {
  align?: string;
  heightPt?: number;
  widthPt?: number;
};

/** Image storage strategy mode. */
export type ImageStoreMode = "auto" | "drive";

/** Configuration options for instantiating an ImageStore. */
export type ImageStoreOpts = {
  appsScript?: AppsScriptImages;
  client?: GwsClient;
  drive?: DriveImages;
  getDriveFolderId?: () => string | undefined;
  mode?: ImageStoreMode;
  setDriveFolderId?: (folderId: string) => void;
};

/** Interface for image storage and insertion providers. */
export interface ImageStore {
  /** Inserts a Drive blob into the document using Apps Script. */
  insertDriveBlob?(documentId: string, fileId: string, index: number, opts: ImageInsertOpts): Promise<void>;
  /** Resolves an image source reference to an accessible URI. */
  resolve(src: string, documentId: string, localBase?: string): Promise<string>;
  /** Uploads a local file to storage for the given document. */
  upload(documentId: string, localPath: string, name?: string): Promise<UploadedImage>;
  /** Checks if the image source requires Apps Script Drive blob insertion. */
  usesDriveBlobInsert?(src: string): boolean;
}

/** Information about an uploaded image asset. */
export type UploadedImage = {
  fileId?: string;
  name: string;
  parentFolderId?: string;
  /** Public HTTPS URL when applicable; drive: uses blob insert. */
  publicUrl: string;
  /** Value stored on upload (drive: or https:). */
  src: string;
  store: "drive" | "https";
};

/** Routes uploads/resolves across Apps Script Drive blobs and https. */
export class CompositeImageStore implements ImageStore {
  readonly #appsScript: AppsScriptImages;
  readonly #drive: DriveImages;
  readonly #getDriveFolderId?: () => string | undefined;
  readonly #setDriveFolderId?: (folderId: string) => void;

  constructor(opts: ImageStoreOpts = {}) {
    const client = opts.client ?? gws;
    this.#drive = opts.drive ?? new DriveImages(client);
    this.#appsScript = opts.appsScript ?? new AppsScriptImages(client);
    this.#getDriveFolderId = opts.getDriveFolderId;
    this.#setDriveFolderId = opts.setDriveFolderId;
  }

  /** Checks if the src uses a drive: scheme. */
  usesDriveBlobInsert(src: string): boolean {
    return src.trim().startsWith("drive:");
  }

  /** Inserts a Drive blob via Apps Script. */
  async insertDriveBlob(documentId: string, fileId: string, index: number, opts: ImageInsertOpts = {}): Promise<void> {
    await this.#appsScript.insertDriveImage(documentId, fileId, index, opts);
  }

  /** Uploads an image to Google Drive. */
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

  /** Resolves a URL or relative file path to an insertable image URI. */
  async resolve(src: string, documentId: string, localBase?: string): Promise<string> {
    const trimmed = src.trim();
    if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
      return trimmed;
    }
    if (trimmed.startsWith("drive:")) {
      throw new Error(
        `drive:${trimmed.slice("drive:".length)} must be inserted via Apps Script blob path — ` +
          "ensure Apps Script bootstrap succeeded (src/core/appsScriptImages.ts) and src is drive:ID",
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
export function imageStoreCreate(opts: ImageStoreOpts = {}): CompositeImageStore {
  return new CompositeImageStore(opts);
}

/** Builds a composite store with optional Drive folder cache (alias for imageStoreCreate). */
export const createImageStore = imageStoreCreate;
