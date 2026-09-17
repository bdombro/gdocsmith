/* TypeScript type declaration for importing Markdown text files directly. */

/**
 * Module augmentation enabling import of raw markdown files as text strings.
 */
declare module "*.md" {
  /** The text content of the markdown file. */
  const text: string;
  export default text;
}
