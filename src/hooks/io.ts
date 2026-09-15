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
