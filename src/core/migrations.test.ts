import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CLAUDE_CODE } from "../harness/claude-code";
import { cleanScratch, scratch } from "../../test/scratch";
import { loadConfig } from "./config";
import { init } from "./init";
import { MIGRATIONS } from "./migrations";
import { stampedVersion } from "./stamp";
import { update } from "./update";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

/** The config 0.3.0's init wrote, stamped `stamp`, with these runs filled in. */
function config030(stamp: string, runs: { test: string; build?: string; lint: string }): string {
    return `[craftpath]
version = "${stamp}"

# Craftpath configuration.
#
# Every command referenced by a task's \`verify\` is defined here, so plans stay
# repo-agnostic and there is exactly one place to change an invocation.
# Fill these in by hand -- a guessed command that silently does nothing is worse
# than a blank one.

[commands.test]
run = "${runs.test}"                 # e.g. "bun test" / "./gradlew test" / "pytest"

[commands.lint]
run = "${runs.lint}"
${runs.build === undefined ? "" : `\n[commands.build]\nrun = "${runs.build}"\n`}
[skills.backend]
default_verify = ["test"]

[gates]
# "auto":   the agent records the approval itself and continues.
# "manual": the agent stops until a human approves.
requirement = "auto"
plan = "manual"
result = "manual"

[git]
work_branch_prefix = "work/"
`;
}

const CONFIG = ".craftpath/config.toml";

async function projectWith(config: string): Promise<string> {
    const root = await scratch("craftpath-migrate-");
    await quietly(() => init(root, [CLAUDE_CODE], "0.3.0"));
    await Bun.write(join(root, CONFIG), config);
    return root;
}

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
        console.error = err;
    }
}

async function updateTo(root: string, version: string): Promise<Error | null> {
    return await quietly(() =>
        update(root, [CLAUDE_CODE], { version }).then(
            () => null,
            (e: Error) => e,
        ),
    );
}

const textOf = (root: string) => Bun.file(join(root, CONFIG)).text();

describe("migrations", () => {
    test("moves commands into a root module", async () => {
        const root = await projectWith(
            config030("0.3.0", { test: "bun test", build: "bun run build", lint: "" }),
        );

        expect(await updateTo(root, "0.4.1")).toBeNull();

        const config = await loadConfig(root);
        expect(config.modules).toEqual({
            app: { path: "./", test: "bun test", build: "bun run build", depends_on: [] },
        });
        const text = await textOf(root);
        expect(text).not.toMatch(/\[commands|\[skills/);
        expect(stampedVersion(text)).toBe("0.4.1");
        // update stamps the file the migration wrote, read afresh: a stale
        // read cut the migrated file short.
        expect(text.endsWith('work_branch_prefix = "work/"\n')).toBe(true);
    });

    test("migrates a project 0.4.0 already stamped", async () => {
        const root = await projectWith(config030("0.4.0", { test: "bun test", lint: "" }));

        expect(await updateTo(root, "0.4.1")).toBeNull();

        expect((await loadConfig(root)).modules.app).toEqual({
            path: "./",
            test: "bun test",
            build: "",
            depends_on: [],
        });
        expect((await textOf(root)).endsWith('work_branch_prefix = "work/"\n')).toBe(true);
    });

    test("refuses to drop a configured command it cannot carry", async () => {
        const before = config030("0.3.0", { test: "bun test", lint: "biome check" });
        const root = await projectWith(before);

        const error = await updateTo(root, "0.4.1");

        expect(error?.message).toContain("lint");
        expect(await textOf(root)).toBe(before);
    });

    test("the modules migration is safe to run twice", async () => {
        const root = await projectWith(config030("0.3.0", { test: "bun test", lint: "" }));
        const migration = MIGRATIONS.find((m) => m.since === "0.4.1");
        expect(migration).toBeDefined();

        await migration!.apply(root);
        const once = await textOf(root);
        await migration!.apply(root);

        expect(await textOf(root)).toBe(once);
    });
});
