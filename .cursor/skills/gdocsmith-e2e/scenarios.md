# gdocsmith E2E Scenario Catalog

Prompt variations and validation criteria for headless agent E2E testing of `gdocsmith`.

## Scenarios

- [`full-workflow`](#full-workflow): Complete end-to-end planning spec assembly across multiple tabs.
- [`placeholder-preservation`](#placeholder-preservation): Surgical placeholder edits under headings with child fixtures.
- [`leaf-section-transfer`](#leaf-section-transfer): Server-side AST section copying between documents and tabs.
- [`multi-tab-structure`](#multi-tab-structure): Multi-tab creation, single-step root tab seeding, and ordering.
- [`symbolic-linking`](#symbolic-linking): Cross-tab deep links and anchor verification.
- [`child-heading-guard`](#child-heading-guard): Fail-closed safety assertion on non-leaf heading deletion.
- [`table-mutation`](#table-mutation): Grid operations and row insertions inside existing tables.
- [`dry-run-inspection`](#dry-run-inspection): Previewing diffs without mutating live cloud documents.

---

## full-workflow

**Goal**: Full 3-phase authoring of "[TEST] Intergalactic Pigeon Post" from template `1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc`.
**Target Turn Budget**: 3 turns (Discover, Structure, Populate).
**Batching Ratio**: 100% batched per phase.

```prompt
Google doc 1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc is an engineering planning workflow and spec template for the Intergalactic Pigeon Post project.

Task: Author a new planning doc titled "[TEST] Intergalactic Pigeon Post" using /gdocsmith following the instructions in the "Workflow Manual" tab:
1. Phase 1 (Discover): Query outlines and source sections from Mission Brief, Epic - Quantum Breadcrumbs, and Spec Template.
2. Phase 2 (Structure): Create the doc and seed root tab t.0 as "Intergalactic Pigeon Post" via docCreate (fromDoc, fromTab). Create child tabs "Quantum Breadcrumb Telemetry" (after parent) and "Reference Manual" (after epic). Tab titles must be unique across the document.
3. Phase 3 (Populate & Link):
   - For leaf sections without child subsections (Overview & Problem Statement, Architectural Decisions), use sectionCopy or replaceSection.
   - For "System Architecture", the heading contains child fixtures (Personnel chips, Topology image, Roost table). Replace ONLY the placeholder paragraph under System Architecture with content from Mission Brief (Fleet Requirements) using replaceMarkdown with find: "*Placeholder: Replace with architectural specification and component breakdown.*" so child subsections are preserved.
   - Add the cross-tab deep links requested in Workflow Manual step 8.

Rules:
- Batch steps into 3 focused phases (Discover, Structure, Populate). Do not run serial single-step calls.
- If you encounter unexpected errors or bugs with gdocsmith, halt immediately without attempting workarounds. Report what failed and why.
```

**Success Criteria**:
- Created doc has 3 tabs in order: `Intergalactic Pigeon Post`, `Quantum Breadcrumb Telemetry`, `Reference Manual`.
- `System Architecture` preserves `Avionics Personnel & Timeline` chips, `Network Topology Diagram` image, and `Roost Capacity Matrix` table.
- Leaf sections (`Overview & Problem Statement`, `Architectural Decisions`) contain transferred source markdown.
- Cross-tab links resolve to native Docs deep links.

---

## placeholder-preservation

**Goal**: Verify surgical placeholder replacement preserves child subsections, chips, images, and tables.
**Target Turn Budget**: 1–2 turns.
**Batching Ratio**: Single pass or 2-phase query + replace.

```prompt
Google doc 1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc has a "Spec Template" tab containing heading "System Architecture" with placeholder text "*Placeholder: Replace with architectural specification and component breakdown.*" followed by child subsections (smart chips, diagram, and table).

Task: Using /gdocsmith:
1. Create a test doc titled "[TEST] Placeholder Preservation" seeding root tab from "Spec Template" via docCreate (fromDoc, fromTab: "Spec Template", tabTitle: "Spec").
2. Replace ONLY the placeholder paragraph under "System Architecture" with:
"### Core Engine Architecture\n\n1. **Avionics Bus**: High-throughput optical breadcrumb bus.\n2. **Telemetry Transceiver**: Quantum-entangled coo relay."
Do NOT delete or modify child subsections ("Avionics Personnel & Timeline", "Network Topology Diagram", "Roost Capacity Matrix"). Use replaceMarkdown with find:.

Rules:
- Halt immediately if any child subsection, chip, or table is deleted or altered.
```

**Success Criteria**:
- Placeholder paragraph replaced with formatted markdown list.
- Child subsections and fixtures remain intact with original styles and tables.

---

## leaf-section-transfer

**Goal**: Verify server-side AST section copying (`sectionCopy`) between tabs without markdown degradation.
**Target Turn Budget**: 1–2 turns.

```prompt
Google doc 1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc has a "Mission Brief" tab with sections "Problem Statement" and "Goals & Non-Goals".

Task: Using /gdocsmith:
1. Create a test doc titled "[TEST] Leaf Section Transfer".
2. Use sectionCopy to transfer "Problem Statement" from "Mission Brief" into the new doc.
3. Use sectionCopy to transfer "Goals & Non-Goals" after "Problem Statement".

Rules:
- Use sectionCopy server-side AST transfer. Do not export to markdown and re-parse manually.
- Halt immediately if sectionCopy fails or loses nested list formatting.
```

**Success Criteria**:
- Both sections transferred cleanly into target document.
- Sub-bullets and bold runs retained in `Goals & Non-Goals`.

---

## multi-tab-structure

**Goal**: Verify creation-time tab seeding and ordering without Google Docs API HTTP 500 rename bugs.
**Target Turn Budget**: 2 turns (Discover, Structure).

```prompt
Google doc 1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc is a multi-tab engineering template.

Task: Using /gdocsmith:
1. Create a new document titled "[TEST] Tab Structure & Ordering".
2. Seed the initial root tab directly as "Overview" using docCreate with fromDoc and fromTab: "Spec Template".
3. Add a second tab "Specifications" after "Overview" using tabCreate with fromDoc and fromTab: "Spec Template".
4. Add a third tab "Reference" after "Specifications" using tabCreate with fromDoc and fromTab: "Reference Manual".
5. Query document tabs to confirm final titles and sequence: ["Overview", "Specifications", "Reference"].

Rules:
- Never use post-hoc tabRename or tabMove on cloned template docs to avoid Google Docs API 500 bugs.
- Halt immediately if tab ordering or titles fail to match.
```

**Success Criteria**:
- Document contains 3 tabs in sequence: `Overview`, `Specifications`, `Reference`.
- No orphan `Tab 1` or `Main` tab.
- Zero HTTP 500 errors from Google Docs API.

---

## symbolic-linking

**Goal**: Verify symbolic cross-tab and anchor markdown links compile to native Google Docs deep links.
**Target Turn Budget**: 2 turns.

```prompt
Task: Using /gdocsmith:
1. Create a new document titled "[TEST] Symbolic Links".
2. In the initial tab "Overview", insert heading "# System Architecture" followed by body text.
3. Create a second tab "Telemetry" after "Overview".
4. In "Telemetry", insert markdown containing cross-tab links:
   - "[Return to Architecture](tab:Overview#System Architecture)"
   - "[Go to Overview Tab](tab:Overview)"
5. Query markdown or AST nodes in "Telemetry" to confirm gdocsmith compiled symbolic links into native Google Docs URL links.

Rules:
- Halt immediately if symbolic link resolution fails or leaves raw "tab:" hrefs uncompiled.
```

**Success Criteria**:
- Links compiled to native Docs URLs matching `?tab=...#heading=...` or `?tab=...`.
- No raw `tab:` scheme left in document text.

---

## child-heading-guard

**Goal**: Negative safety test asserting fail-closed protection against accidental subsection deletion.
**Target Turn Budget**: 1–2 turns.

```prompt
Google doc 1QuCvvolxaAVZ6DroVAxAoO7ClZFiPUOp7453MN7l-Yc has a "Spec Template" tab where "System Architecture" (HEADING_2) contains 3 child subsections ("Avionics Personnel & Timeline", "Network Topology Diagram", "Roost Capacity Matrix").

Task: Using /gdocsmith:
1. Create a test doc titled "[TEST] Safety Guard Verification" seeding from "Spec Template".
2. Intentionally execute replaceSection on "System Architecture" with markdown: "## System Architecture\n\nReplaced body." WITHOUT passing force: true.
3. Assert that gdocsmith fails closed with an error stating child headings would be deleted, and halt.

Rules:
- The goal is to verify the safety guard fires as designed. Do NOT pass force: true.
- Report the exact error message surfaced by gdocsmith.
```

**Success Criteria**:
- `replaceSection` fails closed with error naming the 3 child headings.
- Error message contains actionable instructions (`To replace only the placeholder... target the body node with replace/replaceMarkdown... To bypass, pass force: true.`).
- Document content is not mutated.

---

## table-mutation

**Goal**: Verify table row insertion and cell edits without offset drift or paragraph splitting.
**Target Turn Budget**: 1–2 turns.

```prompt
Task: Using /gdocsmith:
1. Create a new document titled "[TEST] Table Mutation".
2. Insert a markdown section with a 3x3 table:
   | Metric | Threshold | Status |
   | --- | --- | --- |
   | Latency | < 50ms | Optimal |
   | Packet Loss | < 0.001% | Nominal |
3. Using kind: "surgical", target the table node and execute insertTableRow with insertBelow: true and cells: ["Jitter", "< 5ms", "Nominal"].
4. Query the table to verify the new row was appended cleanly.

Rules:
- Halt immediately if table structure is corrupted or row insertion fails.
```

**Success Criteria**:
- Table contains 3 data rows plus header row.
- Table columns and cells align cleanly.

---

## dry-run-inspection

**Goal**: Verify dry-run mode returns accurate diffs without mutating cloud document state.
**Target Turn Budget**: 1–2 turns.

```prompt
Task: Using /gdocsmith:
1. Create a new document titled "[TEST] Dry Run Inspection".
2. Add heading "# Executive Summary" with body "Initial draft content.".
3. Execute a dryRun: true step with replaceSection on "Executive Summary" proposing new markdown "## Executive Summary\n\nApproved final copy.".
4. Inspect the returned JSON payload: verify diff is present, non-empty, and previews the change.
5. Query the live document to confirm "Initial draft content." was NOT modified in Google Docs.

Rules:
- Halt if dryRun modifies cloud state or fails to return a unified diff.
```

**Success Criteria**:
- Step returns valid unified `diff` string.
- Live Google Doc content remains unchanged.
