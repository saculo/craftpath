/**
 * Where this craftpath checkout lives, and the command that puts it on PATH.
 *
 * Hooks invoke `craftpath` by name, so it has to resolve from any directory.
 * `bun add -g <checkout>` links Bun's global bin to the checkout; `bun link`
 * does not -- it only links into one project's node_modules, which hooks never
 * see. Computed rather than documented as a placeholder, so the fix init and
 * doctor print can be pasted as-is on whoever's machine runs them.
 *
 * No Zod here: nothing needs a schema, and init and doctor both load it.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export const CRAFTPATH_ROOT = realpathSync(resolve(import.meta.dir, "../.."));

export function installCommand(): string {
    const root = /\s/.test(CRAFTPATH_ROOT) ? `"${CRAFTPATH_ROOT}"` : CRAFTPATH_ROOT;
    return `bun add -g ${root}`;
}
