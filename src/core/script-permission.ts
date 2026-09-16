/*

Apps Script API permission — insert/bootstrap need it; Drive upload does not.

*/

/** Agent/human message when Script API is missing on the gws OAuth project. */
export const SCRIPT_PERMISSION_MSG =
  "Apps Script API is not enabled on this gws OAuth project. " +
  "Image insert into the Doc is not available until that permission is granted. " +
  "Workaround: put diagrams in with the Google Docs UI. Do not retry.";

/** True when gws/script failed because the API is off, forbidden, or unauthorized. */
export function isScriptPermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /401|403|Unauthorized|forbidden|accessNotConfigured|insufficientPermissions|API has not been used|script.*api|PERMISSION_DENIED/i.test(
    msg,
  );
}

/** Rewrites a Script API failure into SCRIPT_PERMISSION_MSG; rethrows others. */
export function wrapScriptError(err: unknown, what: string): Error {
  const detail = err instanceof Error ? err.message : String(err);
  if (isScriptPermissionError(err)) {
    return new Error(`${what}: ${SCRIPT_PERMISSION_MSG}\n(${detail})`);
  }
  return err instanceof Error ? err : new Error(`${what}: ${detail}`);
}
