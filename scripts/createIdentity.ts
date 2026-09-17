/* CLI identity configuration used across scripts and program metadata. */

/**
 * CLI identity constants for naming, repository coordinates, and descriptions.
 */
export const identityCreate = {
  /** PascalCase class name for Ruby formula and classes. */
  className: "Gdocsmith",
  /** Short package and CLI description. */
  desc: "Google Docs surgical authoring and workflow engine",
  /** Environment variable prefix for configuration overrides. */
  envPrefix: "GDOCSMITH",
  /** Canonical project homepage URL. */
  homepage: "https://github.com/bdombro/gdocsmith",
  /** CLI binary name and command route key. */
  key: "gdocsmith",
  /** GitHub repository slug for releases. */
  releaseRepo: "bdombro/gdocsmith",
  /** Homebrew tap repository identifier. */
  tap: "bdombro/gdocsmith",
  /** argsbarg template type. */
  template: "json",
} as const;

/** Alias for identityCreate (argsbarg template naming). */
export const createIdentity = identityCreate;
