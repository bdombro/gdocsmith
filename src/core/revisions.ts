/* Drive revision pin + restore hint for non-atomic Docs apply. */

import { type GwsClient, gws } from "./gws.ts";

/** Information about a pinned Drive head revision. */
export type PinnedRevision = {
  id: string;
  keepForever?: boolean;
  modifiedTime?: string;
};

/** Raw item from Drive revisions.list API response. */
type RevisionListItem = {
  id?: string;
  keepForever?: boolean;
  modifiedTime?: string;
};

/** Pins the current Drive head revision and builds restore hints. */
export class DriveRevisions {
  /** Lists head revision, attempts keepForever, returns the id even if pin fails. */
  static async pinHead(fileId: string, client: GwsClient = gws): Promise<PinnedRevision | null> {
    let head: PinnedRevision | null = null;
    try {
      const out = await client.run([
        "drive",
        "revisions",
        "list",
        "--params",
        JSON.stringify({
          fields: "revisions(id,modifiedTime,keepForever)",
          fileId,
          pageSize: 1000,
        }),
      ]);
      head = DriveRevisions.#newest(DriveRevisions.#parseList(out));
    } catch {
      return null;
    }
    if (!head) return null;

    try {
      await client.run([
        "drive",
        "revisions",
        "update",
        "--params",
        JSON.stringify({ fileId, revisionId: head.id }),
        "--json",
        JSON.stringify({ keepForever: true }),
      ]);
      return { ...head, keepForever: true };
    } catch {
      return head;
    }
  }

  /** One-paragraph restore instructions (same Doc URL). */
  static restoreHint(fileId: string, revisionId?: string): string {
    const url = `https://docs.google.com/document/d/${fileId}/revisions/revisions`;
    const pin = revisionId ? `Pinned Drive revision ${revisionId} before apply. ` : "";
    return `${pin}Docs API cannot roll back in-place. ` + `Restore: File → Version history (${url}).`;
  }

  static #parseList(out: string): RevisionListItem[] {
    const json = DriveRevisions.#parseJson(out);
    if (Array.isArray(json)) return json as RevisionListItem[];
    if (json && typeof json === "object" && "revisions" in json) {
      const revs = (json as { revisions?: unknown }).revisions;
      return Array.isArray(revs) ? (revs as RevisionListItem[]) : [];
    }
    return [];
  }

  static #parseJson(out: string): unknown {
    const text = out.trim();
    const startObj = text.indexOf("{");
    const startArr = text.indexOf("[");
    let start = -1;
    if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj;
    else if (startArr >= 0) start = startArr;
    if (start < 0) return null;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      return null;
    }
  }

  static #newest(revs: RevisionListItem[]): PinnedRevision | null {
    const withId = revs.filter((r): r is RevisionListItem & { id: string } => Boolean(r.id));
    if (!withId.length) return null;
    const dated = withId.filter((r) => r.modifiedTime);
    const pool = dated.length ? dated : withId;
    pool.sort((a, b) => Date.parse(a.modifiedTime ?? "") - Date.parse(b.modifiedTime ?? ""));
    const head = pool.at(-1)!;
    return {
      id: head.id,
      keepForever: head.keepForever,
      modifiedTime: head.modifiedTime,
    };
  }
}
