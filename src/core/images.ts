/* Google Drive storage and URI resolution for doc images. */

import { basename } from "node:path";
import { type GwsClient, gws } from "./gws.ts";

/** Path segments from Drive root to the images library folder. */
export const DRIVE_IMAGE_ROOT = ["googleworkspace-cli", "gdocsmith", "images"] as const;

/**
 * Result of publishing a Google Drive file for public URL access.
 */
export type PublishResult = {
  /** Whether the file was successfully published. */
  published: boolean;
  /** Optional error message if publishing failed. */
  publishError?: string;
  /** Direct link URI for the published resource. */
  uri: string;
};

/**
 * Details of an image uploaded to Google Drive.
 */
export type UploadedImage = {
  /** Unique Google Drive file identifier. */
  fileId: string;
  /** File display name. */
  name: string;
  /** Google Drive parent folder identifier. */
  parentFolderId: string;
  /** Drive reference URI in drive:id format. */
  src: string;
  /** Direct link URI for viewing or downloading the image. */
  uri: string;
};

/** Uploads images to Drive and resolves drive: refs for insertInlineImage. */
export class DriveImages {
  constructor(
    /** Google Workspace client for Drive operations. */
    private readonly client: GwsClient = gws,
  ) {}

  /** Ensures .../images/<documentId>/ exists; returns folder id. */
  async ensureDocFolder(
    /** Target Google Docs document identifier. */
    documentId: string,
    /** Optional cached folder identifier to avoid API lookup. */
    cachedFolderId?: string,
  ): Promise<string> {
    if (cachedFolderId) return cachedFolderId;

    let parent: string | undefined;
    for (const name of DRIVE_IMAGE_ROOT) {
      parent = await DriveImages.#ensureFolder(this.client, name, parent);
    }
    return DriveImages.#ensureFolder(this.client, documentId, parent);
  }

  /** Uploads a local file into the doc image folder and returns drive: ref. */
  async upload(
    /** Target Google Docs document identifier. */
    documentId: string,
    /** Absolute or relative local path to the image file. */
    localPath: string,
    /** Optional target file name in Drive. */
    name?: string,
    /** Optional cached parent folder identifier. */
    cachedFolderId?: string,
  ): Promise<UploadedImage> {
    const parentFolderId = await this.ensureDocFolder(documentId, cachedFolderId);
    const fileName = name ?? basename(localPath);
    const out = await this.client.run([
      "drive",
      "+upload",
      localPath,
      "--parent",
      parentFolderId,
      "--name",
      fileName,
      "--format",
      "json",
    ]);
    const file = JSON.parse(out) as { id?: string; name?: string };
    if (!file.id) throw new Error(`Drive upload failed: ${out}`);
    const { uri } = await this.publishAndUri(file.id);
    return {
      fileId: file.id,
      name: file.name ?? fileName,
      parentFolderId,
      src: `drive:${file.id}`,
      uri,
    };
  }

  /** Makes file readable by link and returns Docs-compatible URI. */
  async publishAndUri(
    /** Target Google Drive file identifier to publish. */
    fileId: string,
  ): Promise<PublishResult> {
    const uri = `https://drive.google.com/uc?export=view&id=${fileId}`;
    try {
      await this.client.run([
        "drive",
        "permissions",
        "create",
        "--params",
        JSON.stringify({ fileId }),
        "--json",
        JSON.stringify({ role: "reader", type: "anyone" }),
      ]);
      return { published: true, uri };
    } catch (err) {
      const publishError = err instanceof Error ? err.message : String(err);
      return { published: false, publishError, uri };
    }
  }

  /**
   * Finds or creates a Drive folder by name under the specified parent.
   */
  static async #ensureFolder(
    /** Google Workspace client for Drive operations. */
    client: GwsClient,
    /** Name of the folder to find or create. */
    name: string,
    /** Optional parent folder ID; searches root if undefined. */
    parentId?: string,
  ): Promise<string> {
    const q = parentId
      ? `name='${DriveImages.#escapeQuery(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `name='${DriveImages.#escapeQuery(name)}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const listOut = await client.run([
      "drive",
      "files",
      "list",
      "--params",
      JSON.stringify({ fields: "files(id,name)", pageSize: 10, q }),
    ]);
    const listed = JSON.parse(listOut) as { files?: Array<{ id: string }> };
    const existing = listed.files?.[0]?.id;
    if (existing) return existing;

    const createOut = await client.run([
      "drive",
      "files",
      "create",
      "--params",
      JSON.stringify({ fields: "id" }),
      "--json",
      JSON.stringify({
        mimeType: "application/vnd.google-apps.folder",
        name,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    ]);
    const created = JSON.parse(createOut) as { id?: string };
    if (!created.id) throw new Error(`Failed to create Drive folder: ${name}`);
    return created.id;
  }

  /**
   * Escapes single quotes for Google Drive search queries.
   */
  static #escapeQuery(
    /** Value to escape for Drive query string literal. */
    value: string,
  ): string {
    return value.replace(/'/g, "\\'");
  }
}

/** Maps alignment names to Docs API enum values. */
export function imageAlignment(
  /** Alignment name such as left, center, or right. */
  align?: string,
): "CENTER" | "END" | "START" | undefined {
  if (!align) return undefined;
  const n = align.toLowerCase();
  if (n === "center") return "CENTER";
  if (n === "right") return "END";
  if (n === "left") return "START";
  return undefined;
}
