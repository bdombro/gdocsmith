/* Helpers for in-memory dry-run document simulation on Gdoc. */

import type { DocNode } from "~/core/dom/types.ts";
import type { Gdoc } from "~/core/gdoc.ts";
import type { SimulatedGdoc } from "./types.ts";

/**
 * Returns simulated tape nodes when present on a dry-run Gdoc, optionally scoped to a tab ID.
 *
 * If a tab ID is provided and per-tab simulated nodes exist, returns those.
 * Otherwise falls back to document-level simulated nodes.
 */
export function simulatedNodesOf(gdoc: Gdoc, tabId?: string): DocNode[] | undefined {
  const sim = gdoc as SimulatedGdoc;
  if (sim.simulatedTabs && tabId) return sim.simulatedTabs.get(tabId);
  return sim.simulatedNodes;
}

/**
 * Attaches simulated tape nodes to a Gdoc for dry-run diffing, optionally scoped to a tab ID.
 */
export function simulatedNodesSet(gdoc: Gdoc, nodes: DocNode[], tabId?: string): void {
  const sim = gdoc as SimulatedGdoc;
  sim.simulatedNodes = nodes;
  if (tabId) {
    if (!sim.simulatedTabs) sim.simulatedTabs = new Map();
    sim.simulatedTabs.set(tabId, nodes);
  }
}
