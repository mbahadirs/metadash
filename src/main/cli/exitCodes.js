/** `metadash --cli` exit codes (docs/cli.md). */
export const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1,          // unexpected failure
  USAGE: 2,          // bad arguments, unknown command, ambiguous account (candidates printed)
  PARTIAL: 3,        // finished with errors (e.g. sync partial)
  AUTH: 4,           // token invalid / missing
  LOCKED: 5,         // another process holds the lease (sync already running in the MetaDash app)
  READ_ONLY: 6,      // subscriber (shared) workspace: mutating commands are disabled
  NOT_IMPLEMENTED: 7,
});
