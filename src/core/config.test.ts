import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "./config";
import { cleanScratch, scratch } from "../../test/scratch";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

/** The tables every config must carry, so a test only writes what it is about. */
const REQUIRED = `
[gates]
requirement = "auto"
plan = "manual"
result = "manual"

[git]
work_branch_prefix = "work/"
`;

/** A root holding only a config.toml made of `modules` plus the required tables. */
async function withModules(modules: string): Promise<string> {
    const root = await scratch("craftpath-config-");
    await Bun.write(join(root, ".craftpath/config.toml"), modules + REQUIRED);
    return root;
}

/** The message loading fails with, or null when it loads. */
async function loadError(root: string): Promise<string | null> {
    return await loadConfig(root).then(
        () => null,
        (e: Error) => e.message,
    );
}

describe("modules config", () => {
    test("reads path, test, build and depends_on", async () => {
        const root = await withModules(`
[modules.shared]
path = "./shared"

[modules.web]
path = "./apps/web/"
test = "bun test"
build = "bun run build"
depends_on = ["shared"]
`);
        const config = await loadConfig(root);
        expect(config.modules.web).toEqual({
            path: "./apps/web",
            test: "bun test",
            build: "bun run build",
            depends_on: ["shared"],
        });
    });

    test("refuses an unknown field", async () => {
        const root = await withModules(`
[modules.web]
path = "./web"
lint = "bun run lint"
`);
        const message = await loadError(root);
        expect(message).toContain("modules.web");
        expect(message).toContain("lint");
    });

    test("refuses a path outside the project", async () => {
        for (const path of ["/srv/web", "./web/../../etc", "web"]) {
            const root = await withModules(`[modules.web]\npath = "${path}"\n`);
            expect(await loadError(root), path).toContain("modules.web.path");
        }
    });

    test("refuses a dependency on an unknown module", async () => {
        const root = await withModules(`
[modules.api]
path = "./api"
depends_on = ["ghost"]
`);
        const message = await loadError(root);
        expect(message).toContain("modules.api");
        expect(message).toContain("ghost");
    });

    test("refuses a dependency cycle", async () => {
        const root = await withModules(`
[modules.a]
path = "./a"
depends_on = ["c"]

[modules.b]
path = "./b"
depends_on = ["a"]

[modules.c]
path = "./c"
depends_on = ["b"]

[modules.d]
path = "./d"
depends_on = ["a"]
`);
        const message = await loadError(root);
        expect(message).toContain("cycle");
        expect(message).toMatch(/\ba\b.*\bb\b.*\bc\b|\bc\b.*\bb\b.*\ba\b|\bb\b.*\bc\b.*\ba\b/);
        expect(message).not.toMatch(/\bd\b/);
    });

    test("refuses two modules with one path", async () => {
        const root = await withModules(`
[modules.web]
path = "./apps/web"

[modules.site]
path = "./apps/web/"
`);
        const message = await loadError(root);
        expect(message).toContain("web");
        expect(message).toContain("site");
    });
});
