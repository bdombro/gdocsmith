# Markdown Lens

Markdown is an editable view of a tab, not a lossless copy of every Docs object.
Writing an unchanged export sends no content requests. When markdown changes,
the lens aligns old and new blocks and preserves anything it does not need to
touch.

## Export

A markdown query includes frontmatter unless `skipFrontmatter` is true.

```yaml
doc: "document-id"
tab: "t.0"
title: "Main"
revision: "revision-id"
styles:
  color-E11D48:
    foregroundColor: "#E11D48"
```

Keep `doc`, `tab`, and `revision` when editing an export. A mismatched revision
fails safely instead of applying an edit to a stale document.

## Supported Markdown

- headings, paragraphs, bullet and numbered lists, code blocks, and simple GFM
  tables
- bold, italic, strike, inline code, and links
- frontmatter `styles` plus inline directives such as
  `::color-E11D48[important]::`
- structured links to tabs and headings
- position tokens for content that markdown cannot represent directly

Use `markdownFile` to write an edited export back. For small changes, pass
`markdown` directly.

Nested list items must use the same list kind as their parent. Markdown writes
refuse newly authored or edited mixed-kind nesting instead of changing its
meaning. Existing UI-created mixed-kind lists are preserved by unchanged exports
and unrelated edits; removing a mismatched nested item is supported. Use
same-kind markers for nested lists, or use `edit` for a literal text replacement
that leaves list membership unchanged. `force` does not make unsupported
markdown representable.

## Tokens

Position tokens preserve atomic content and prevent an accidental rewrite from
silently dropping it. Existing token references use an ordinal; creation forms
support people, dates, rich links, public images, page breaks, and section
breaks.

```markdown
{{person:person@example.com}}
{{date:2026-09-25T00:00:00Z}}
{{richlink:https://example.com}}
![Diagram](https://example.com/diagram.png)
{{pagebreak}}
```

Changing the informational label of an existing token is refused. Moving content
that Docs cannot recreate is refused rather than approximated.

## Style Directives

Directives represent deviations from a named style's base appearance. They are
defined in frontmatter and rendered inline:

```markdown
::color-E11D48+size-9[Review this detail]::
```

Supported directive attributes include color, background color, font family,
size, weight, bold, italic, underline, strike, baseline offset, and small caps.

## Limits

Read-only tables, equations, drawings, charts, TOCs, column breaks, positioned
objects, and some chips are preserved when untouched. The lens refuses edits that
would require recreating unsupported content.