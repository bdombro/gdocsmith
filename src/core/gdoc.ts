/* In-memory model of a loaded Google Doc. Wraps raw documents.get payloads and provides tab overlay and table resolution helpers. */

import { type DocCacheOptions, docCache } from "~/core/cache/docCache.ts";
import { type GwsClient, gws } from "./gws.ts";
import { overlayTab, parseRef } from "./tabs.ts";
import type { DocElement, GoogleDoc } from "./types.ts";

/** Snapshot of a fetched document. */
export class Gdoc {
  constructor(
    /** Raw documents.get payload (or a tab overlay). */
    readonly data: GoogleDoc,
    /** Document id used for fetch. */
    readonly id: string,
    /** Selected Docs tab id, when known. */
    readonly tabId?: string,
  ) {}

  /** Fetches a document from the API and wraps it for reading, with two-tier caching. */
  static async load(id: string, client: GwsClient = gws, options?: DocCacheOptions): Promise<Gdoc> {
    return docCache.get(id, client, options);
  }

  /** Validates and returns the document ID, rejecting full URLs. */
  static idParse(input: string): string {
    return parseRef(input).documentId;
  }

  /** Validates and returns the document ID, rejecting full URLs (alias for idParse). */
  static parseId(input: string): string {
    return Gdoc.idParse(input);
  }

  /** Validates and returns a DocRef ({ documentId }), rejecting full URLs. */
  static refParse(input: string): { documentId: string; tabId?: string } {
    return parseRef(input);
  }

  /** Validates and returns a DocRef ({ documentId }), rejecting full URLs (alias for refParse). */
  static parseRef(input: string): { documentId: string; tabId?: string } {
    return Gdoc.refParse(input);
  }

  /** Overlay this tab's documentTab onto legacy body/headers/lists. */
  withTab(tabId: string): Gdoc {
    return new Gdoc(overlayTab(this.data, tabId), this.id, tabId);
  }

  /** Locates a table element near an insert cursor after insertTable. */
  tableAtFind(index: number): DocElement | undefined {
    const tables = (this.data.body?.content ?? []).filter((el) => el.table);
    return (
      tables.find((el) => el.startIndex === index) ??
      tables.find((el) => el.startIndex >= index && el.startIndex <= index + 3) ??
      tables.find((el) => el.startIndex <= index && el.endIndex > index)
    );
  }

  /** Locates a table element near an insert cursor after insertTable (alias for tableAtFind). */
  findTableAt(index: number): DocElement | undefined {
    return this.tableAtFind(index);
  }

  /** Table inserted at `insertTable` cursor — never a table that merely contains index. */
  insertedTableAtFind(index: number): DocElement | undefined {
    const tables = (this.data.body?.content ?? []).filter((el) => el.table);
    return (
      tables.find((el) => el.startIndex === index) ??
      tables
        .filter((el) => el.startIndex >= index && el.startIndex <= index + 5)
        .sort((a, b) => a.startIndex - b.startIndex)[0]
    );
  }

  /** Table inserted at `insertTable` cursor — never a table that merely contains index (alias for insertedTableAtFind). */
  findInsertedTableAt(index: number): DocElement | undefined {
    return this.insertedTableAtFind(index);
  }
}
