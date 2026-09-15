/**
 * Process exit codes. Hooks and CI branch on these.
 *
 * Claude Code's hook protocol treats exit 2 as "block this tool call" and
 * feeds stderr back to the model. Any other non-zero code is a hook error and
 * does not block, so guards must fail open.
 */
export const Exit = {
    OK: 0,
    VALIDATION_FAILED: 1,
    PRECONDITION_FAILED: 2,
    CORRUPT_STATE: 3,
    USAGE_ERROR: 4,
} as const;

export type ExitCode = (typeof Exit)[keyof typeof Exit];

/** Hook-protocol aliases, so guard code reads as intent rather than numbers. */
export const BLOCK = Exit.PRECONDITION_FAILED;
export const ALLOW = Exit.OK;
