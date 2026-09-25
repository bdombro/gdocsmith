# Style

Use `style` for existing content and markdown for new structured content.

## Text

Text patches support color, background color, bold, italic, underline, strike,
font family, font size, and links. Set a property to `null` to reset it to the
inherited value.

Use `where` with a text patch to affect only runs whose explicitly set values
match. For example, clear one known color without altering other colored text.

## Paragraphs

Paragraph patches support named style, alignment, spacing, indentation, shading,
and bullet preset. Resettable properties accept `null`.

Changing a paragraph's named style or list membership is planned as a model edit
instead of a delete-and-recreate operation. That preserves the paragraph's text
and identity when Docs permits it.

## Tables

Use `table` for cell backgrounds, padding, vertical alignment, row heights,
header rows, and widths. Target a table node or a single cell anchor. Widths are
in points; `null` requests an even width.