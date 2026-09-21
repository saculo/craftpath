/**
 * Hook I/O. Deliberately imports nothing but `exit.ts` (plain constants).
 *
 * Hooks fire on EVERY Edit, Write and Bash tool call, so the hook path must
 * stay import-free. Measured: ~4ms bare vs ~28ms once Zod is loaded. Anything
 * heavy belongs behind a dynamic import in a non-hook command.
 */
import { ALLOW, BLOCK } from "../exit";

export const STATE_MARKER = ".craftpath/state";

export interface HookEvent {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
}

/** Read the hook event from stdin. Returns {} on any failure (fail open). */
export async function readEvent(): Promise<HookEvent> {
    try {
        const raw = await Bun.stdin.text();
        if (!raw.trim()) return {};
        return JSON.parse(raw) as HookEvent;
    } catch {
        return {};
    }
}

/** Block the tool call and tell the model why, naming the sanctioned path. */
export function block(reason: string): never {
    console.error(reason);
    process.exit(BLOCK);
}

export function allow(): never {
    process.exit(ALLOW);
}

/** Normalize separators so Windows paths hit the same marker. */
export function normalize(path: string): string {
    return path.replaceAll("\\", "/");
}

/**
 * Env vars that name the project root, in precedence order.
 *
 * Each harness announces the root differently -- Claude Code sets
 * CLAUDE_PROJECT_DIR, a pi extension sets PI_PROJECT_DIR -- and the guards need
 * the root to resolve `..` out of a path before testing it against state/.
 * CRAFTPATH_PROJECT_DIR leads so a harness craftpath does not know about can be
 * adapted by its shim without waiting for a release.
 *
 * A list rather than a lookup in the harness registry: this module is on the
 * hook path, which fires on every Edit, Write and Bash call and must stay
 * import-free (~4ms bare vs ~28ms once a module graph loads).
 */
export const PROJECT_DIR_ENVS = [
    "CRAFTPATH_PROJECT_DIR",
    "CLAUDE_PROJECT_DIR",
    "PI_PROJECT_DIR",
] as const;

/**
 * The project root a guard should resolve paths against.
 *
 * Empty is treated as unset. A harness that exports the variable but leaves it
 * blank would otherwise resolve every relative path against "", which makes
 * `insideState` compare against the wrong directory and silently weakens the
 * exact half of the trust boundary.
 *
 * Pure, with the environment passed in, so the precedence is testable without
 * mutating process.env under a parallel test runner.
 */
export function projectRootFrom(env: Record<string, string | undefined>, cwd: string): string {
    for (const name of PROJECT_DIR_ENVS) {
        const value = env[name];
        if (typeof value === "string" && value !== "") return value;
    }
    return cwd;
}
