import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { loadConfig } from "./config";
import { BLANK_CONFIG, init } from "./init";
import { stampBlock } from "./stamp";
import { cleanScratch, scratch } from "../../test/scratch";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

/** Runs init in root, returning what it printed. */
async function initIn(root: string): Promise<string> {
    const lines: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    console.error = () => {};
    try {
        await init(root);
    } finally {
        console.log = log;
        console.error = err;
    }
    return lines.join("\n");
}

async function project(files: Record<string, string>): Promise<string> {
    const root = await scratch("craftpath-init-");
    for (const [path, body] of Object.entries(files)) await Bun.write(join(root, path), body);
    return root;
}

/** The root module init wrote, and whether the config still has the old tables. */
async function rootModule(root: string): Promise<{ test?: string; build?: string; path?: string }> {
    const config = Bun.TOML.parse(await Bun.file(join(root, ".craftpath/config.toml")).text()) as {
        modules: { app: { path: string; test?: string; build?: string } };
    };
    return config.modules.app;
}

/** A git repository in root on `branch`, with one commit. */
async function gitRepo(
    root: string,
    branch: string,
): Promise<(...args: string[]) => Promise<unknown>> {
    const git = (...args: string[]) =>
        Bun.$`git -C ${root} -c user.email=t@example.com -c user.name=T ${args}`.quiet();
    await git("init", "-q", "-b", branch);
    await git("commit", "-q", "--allow-empty", "-m", "first");
    return git;
}

const PACKAGE = JSON.stringify({ scripts: { test: "bun test", lint: "biome check" } });

describe("init detection", () => {
    test("writes one root module", async () => {
        const root = await project({ "README.md": "# something\n" });
        await initIn(root);

        const config = Bun.TOML.parse(
            await Bun.file(join(root, ".craftpath/config.toml")).text(),
        ) as Record<string, unknown>;
        expect(config.modules).toEqual({ app: { path: "./", test: "", build: "" } });
        expect(config).not.toHaveProperty("commands");
        expect(config).not.toHaveProperty("skills");
        expect((await loadConfig(root)).modules.app?.path).toBe("./");
    });

    test("fills the root module from what the project declares", async () => {
        const root = await project({ "package.json": PACKAGE });
        const output = await initIn(root);

        expect(await rootModule(root)).toEqual({ path: "./", test: "bun run test", build: "" });
        expect(output).toMatch(/detected.*test = "bun run test"/);
        expect(output).not.toMatch(/lint/);
    });

    test("fills only what the evidence supports", async () => {
        const root = await project({ gradlew: "#!/bin/sh\n" });
        await initIn(root);

        expect(await rootModule(root)).toEqual({ path: "./", test: "./gradlew test", build: "" });
    });

    test("refuses to choose between two ecosystems", async () => {
        // Two declarations are not evidence for either: which one the project's
        // tests live in is exactly the guess D21 exists to prevent.
        const root = await project({ "package.json": PACKAGE, gradlew: "#!/bin/sh\n" });
        const output = await initIn(root);

        expect(await rootModule(root)).toEqual({ path: "./", test: "", build: "" });
        expect(output).not.toContain("detected");
    });

    test("sets base_branch to the repository's branch", async () => {
        const root = await project({ "README.md": "# something\n" });
        await gitRepo(root, "main");
        const output = await initIn(root);

        expect((await loadConfig(root)).git.base_branch).toBe("main");
        expect(output).toMatch(/detected.*base_branch = "main"/);
    });

    test("prefers the remote's default branch", async () => {
        const root = await project({ "README.md": "# something\n" });
        const git = await gitRepo(root, "master");
        await git("branch", "main");
        await git("update-ref", "refs/remotes/origin/main", "HEAD");
        await git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
        await initIn(root);

        expect((await loadConfig(root)).git.base_branch).toBe("main");
    });

    test("leaves base_branch to its default outside git", async () => {
        const root = await project({ "README.md": "# something\n" });
        await initIn(root);

        expect(await Bun.file(join(root, ".craftpath/config.toml")).text()).toBe(
            stampBlock(pkg.version) + BLANK_CONFIG,
        );
        expect((await loadConfig(root)).git.base_branch).toBe("master");
    });

    test("leaves an unrecognised project blank", async () => {
        const root = await project({ "README.md": "# something\n" });
        await initIn(root);

        expect(await Bun.file(join(root, ".craftpath/config.toml")).text()).toBe(
            stampBlock(pkg.version) + BLANK_CONFIG,
        );
    });

    test("never rewrites an existing config", async () => {
        const mine = '[modules.app]\npath = "./"\ntest = "make check"\n';
        const root = await project({ "package.json": PACKAGE, ".craftpath/config.toml": mine });
        const output = await initIn(root);

        expect(await Bun.file(join(root, ".craftpath/config.toml")).text()).toBe(mine);
        expect(output).not.toContain("detected");
    });
});
