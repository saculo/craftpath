/**
 * Where this copy of craftpath lives, and the command that puts it on PATH.
 *
 * Hooks invoke `craftpath` by name, so it has to resolve from any directory.
 * `bun add -g` links Bun's global bin; `bun link` does not -- it only links
 * into one project's node_modules, which hooks never see.
 *
 * WHAT to install differs by how this copy got here, and printing the wrong one
 * is worse than printing nothing. A registry install lives under node_modules,
 * where its unpacked path is an implementation detail nobody should be pasting;
 * a checkout is the thing a contributor wants linked, edits and all.
 *
 * No Zod here: nothing needs a schema, and init and doctor both load it.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const CRAFTPATH_ROOT = realpathSync(resolve(import.meta.dir, "../.."));

/**
 * Pure, with the root passed in, so both branches are testable -- the suite
 * runs from a checkout and can never observe the installed one otherwise.
 */
export function installCommandFor(root: string): string {
    // A SEGMENT, not a substring: a checkout at ~/node_modules-experiments is
    // still a checkout, and telling its owner to `bun add -g craftpath` would
    // silently replace the copy they are working on with the published one.
    const installed = root.split(/[\\/]/).includes("node_modules");
    if (installed) return "bun add -g craftpath";
    return `bun add -g ${/\s/.test(root) ? `"${root}"` : root}`;
}

export function installCommand(): string {
    return installCommandFor(CRAFTPATH_ROOT);
}
