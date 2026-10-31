/** Helpers for the guards that init and doctor stay silent about the modern search tools. */
import { symlink } from "node:fs/promises";
import { join } from "node:path";

import { scratch } from "./scratch";

/** A PATH holding only what craftpath needs: python3, git, bun, sh and env. */
export async function barePath(): Promise<string> {
    const bin = await scratch("craftpath-bare-bin-");
    for (const tool of ["python3", "git", "bun", "sh", "env"]) {
        const found = Bun.which(tool);
        if (found) await symlink(found, join(bin, tool));
    }
    return bin;
}

/** The five tool names as whole words: `fdisk`, `rgb` and `sg-tool` do not match. */
export const SEARCH_TOOLS = /(^|[^\w-])(rg|fd|zoxide|ast-grep|sg)([^\w-]|$)/m;
