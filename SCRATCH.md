This file for brain-dumping and future ideas. Nothing in this file is finalized. 

Agents: don't consider this file or contents in your answers unless I tell you to, don't edit this file unless I tell you to.

# Idea: gsheetsmith

Pitch: The missing data layer between LLMs and Google Sheets—reliable 2D table manipulation and clean formatting without raw A1 range math or batchUpdate JSON boilerplate.

Architecture:
- Dynamic Range Discovery: Inspect sheets to resolve header rows, table bounds, and append points without hardcoding fragile A1 offsets.
- 2D / Record Ingestion: Map JSON arrays or tabular data directly into sheet matrices in one shot.
- Aesthetic Presets: Built-in macros for header freeze, auto-resizing column widths, zebra striping, and standard number/date formats.
- Tab ID Resolution: Abstract away the mismatch between user-facing sheet names (`"Q3 Actuals"`) and internal integer `sheetId`s required by mutation APIs.

# Idea: gslidesmith

Pitch: Declarative, template-driven Google Slides generation from Markdown—preventing spatial layout corruption by delegating reflow to native slide templates.

Architecture:
- Marp-Inspired Markdown Parser: Delimit slides with `---` and parse slide roles (title, section break, content, bullets).
- Native Placeholder Slotting: Map parsed content directly into built-in layout placeholders (`TITLE`, `BODY`, `SUBTITLE`) so Google's engine handles font scaling, wrapping, and margins automatically.
- Deck & Slide Targeting: Inspect, reorder, or surgically update slides by title or index without touching or corrupting master layouts.
- Zero Coordinate Math: Strictly avoid arbitrary 2D shape coordinates to guarantee clean, readable slide output for agents.



# Idea: register plugin

No, you don't need to register to use or share it, but registration is required for one-click public directory discovery.

1. Cursor:
   - Without registering: You and local users can install via `just install-plugin-cursor` (links to `~/.cursor/plugins/local/`). Teams can import your GitHub repo directly in Dashboard → Plugins → Team Marketplaces → Import from Repo.
   - With registering (Cursor Marketplace): Submit `https://github.com/bdombro/gdocsmith` at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish). Once approved, anyone can find it in the Customize menu or install via `/add-plugin gdocsmith`.

2. Claude Code:
   - Without registering: Anyone can add your repo directly with `/plugin marketplace add bdombro/gdocsmith` and install via `/plugin install gdocsmith`.
   - With registering (Anthropic Official Directory): Submit a PR to [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) under `external_plugins/`. Once merged, users install via `/plugin install gdocsmith@claude-plugins-official` with no repo setup.

# Idea: less reliance on gws

I use gws, but not everyone may.

Towards that, we'd alternate, direct auth without reliance on gws.

- the default should be default auth
- need to extend auth to get/manage it's own tokens instead of gws
- need to brainstorm docs, how to handle/setup a google cloud app
- need to make it easy for users to setup/use gws
- Consider sharing gws env vars, and/or instruct to set our own with special instructions for gws