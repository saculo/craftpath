import { afterAll, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { cleanScratch } from "./scratch";
import { barePath, SEARCH_TOOLS } from "./search-tools";

afterAll(cleanScratch);

test("the shared search-tool matcher flags the five tools and nothing that merely contains them", () => {
    for (const tool of ["rg", "fd", "zoxide", "ast-grep", "sg"]) {
        expect(`use ${tool} here`).toMatch(SEARCH_TOOLS);
    }
    for (const word of ["fdisk", "rgb", "sg-tool", "ast-grep-x"]) {
        expect(`see ${word} here`).not.toMatch(SEARCH_TOOLS);
    }
});

test("the shared bare path holds only what craftpath needs", async () => {
    const names = await readdir(await barePath());

    for (const tool of ["python3", "git", "bun", "sh", "env"]) expect(names).toContain(tool);
    for (const tool of ["rg", "fd", "zoxide", "ast-grep", "sg"]) expect(names).not.toContain(tool);
});
