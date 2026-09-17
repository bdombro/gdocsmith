/* Helpers for in-memory dry-run document simulation on Gdoc. */

import type { DocNode } from "~/core/dom/types.ts";
import type { Gdoc } from "~/core/gdoc.ts";
import type { SimulatedGdoc } from "./types.ts";

/** Returns simulated tape nodes when present on a dry-run Gdoc. */
export function simulatedNodesOf(gdoc: Gdoc): DocNode[] | undefined {
  return (gdoc as SimulatedGdoc).simulatedNodes;
}

/** Attaches simulated tape nodes to a Gdoc for dry-run diffing. */
export function simulatedNodesSet(gdoc: Gdoc, nodes: DocNode[]): void {
  (gdoc as SimulatedGdoc).simulatedNodes = nodes;
}
