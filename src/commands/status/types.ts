/* Status command output types for schemagen and CLI output formatting. */

/** JSON stdout for `gdocsmith status --json`. */
/** @sg */
export interface StatusJsonOutput {
  /** App version from program root. */
  version: string;
}
