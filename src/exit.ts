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

/**
 * The caller typed something this CLI cannot act on.
 *
 * Stricli refuses unknown flags, missing values and bad arity on its own. This
 * covers the checks it cannot express -- mutually exclusive flags, an arity
 * whose message is worth more than "too many arguments" -- so that every usage
 * failure still leaves by the same exit code.
 */
export class UsageError extends Error {
    readonly exitCode = Exit.USAGE_ERROR;
}

/**
 * Does this failure know how it should exit?
 *
 * Everything craftpath throws deliberately carries an `exitCode`; anything else
 * is a bug, and a bug should surface as a stack trace and exit 1 rather than be
 * dressed up as a refusal.
 */
export function hasExitCode(error: unknown): error is Error & { exitCode: number } {
    return error instanceof Error && typeof (error as { exitCode?: unknown }).exitCode === "number";
}
