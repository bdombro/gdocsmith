# Images

Images in an existing Google Doc can be preserved by leaving their containing
node untouched. A markdown write that changes unrelated nearby content does not
recreate images.

## Safe Operations

- Query nodes to identify image-bearing paragraphs or table cells.
- Edit visible caption text in place when the model can preserve the image.
- Copy content with public image URLs when the copy primitive reports it as
  recreatable.
- Create a public HTTPS image from markdown image syntax or an image token.

## Refused Operations

Drive-hosted images, positioned objects, and other image forms the API cannot
recreate block destructive rewrites unless the user explicitly approves force.
The warning identifies the affected content before anything sends.

For layout changes, resizing, or unsupported image sources, use the Google Docs
UI. Do not bypass the model with offsets or raw API calls.