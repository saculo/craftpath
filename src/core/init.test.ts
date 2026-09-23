import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BLANK_CONFIG, init } from "./init";
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

async function commands(root: string): Promise<{ test: string; lint: string }> {
    const config = Bun.TOML.parse(await Bun.file(join(root, ".craftpath/config.toml")).text()) as {
        commands: { test: { run: string }; lint: { run: string } };
    };
    return { test: config.commands.test.run, lint: config.commands.lint.run };
}

const PACKAGE = JSON.stringify({ scripts: { test: "bun test", lint: "biome check" } });

describe("init detection", () => {
    test("fills both commands from package.json scripts", async () => {
        const root = await project({ "package.json": PACKAGE });
        const output = await initIn(root);

        expect(await commands(root)).toEqual({ test: "bun run test", lint: "bun run lint" });
        expect(output).toMatch(/detected.*commands\.test/);
        expect(output).toMatch(/detected.*commands\.lint/);
    });

    test("fills only what the evidence supports", async () => {
        const root = await project({ gradlew: "#!/bin/sh\n" });
        const output = await initIn(root);

        expect(await commands(root)).toEqual({ test: "./gradlew test", lint: "" });
        expect(output).toMatch(/detected.*commands\.test/);
        expect(output).not.toMatch(/detected.*commands\.lint/);
    });

    test("refuses to choose between two ecosystems", async () => {
        // Two declarations are not evidence for either: which one the project's
        // tests live in is exactly the guess D21 exists to prevent.
        const root = await project({ "package.json": PACKAGE, gradlew: "#!/bin/sh\n" });
        const output = await initIn(root);

        expect(await commands(root)).toEqual({ test: "", lint: "" });
        expect(output).not.toContain("detected");
    });

    test("leaves an unrecognised project blank", async () => {
        const root = await project({ "README.md": "# something\n" });
        await initIn(root);

        expect(await Bun.file(join(root, ".craftpath/config.toml")).text()).toBe(BLANK_CONFIG);
    });

    test("never rewrites an existing config", async () => {
        const mine = '[commands.test]\nrun = "make check"\n';
        const root = await project({ "package.json": PACKAGE, ".craftpath/config.toml": mine });
        const output = await initIn(root);

        expect(await Bun.file(join(root, ".craftpath/config.toml")).text()).toBe(mine);
        expect(output).not.toContain("detected");
    });
});
