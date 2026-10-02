import { afterAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_CODE } from "../harness/claude-code";
import type { Harness } from "../harness/index";
import { PI } from "../harness/pi";
import { init } from "./init";
import { cleanScratch, scratch } from "../../test/scratch";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

const MANIFEST = ".craftpath/manifest.json";

type Entry = { sha256: string; version: string };

async function quietly(fn: () => Promise<void>): Promise<void> {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        await fn();
    } finally {
        console.log = log;
        console.error = err;
    }
}

async function initIn(root: string, harnesses: Harness[], version: string): Promise<void> {
    await quietly(() => init(root, harnesses, version));
}

async function manifestOf(root: string): Promise<Record<string, Entry>> {
    const parsed = (await Bun.file(join(root, MANIFEST)).json()) as {
        files: Record<string, Entry>;
    };
    return parsed.files;
}

async function sha256Of(root: string, rel: string): Promise<string> {
    const bytes = await Bun.file(join(root, rel)).bytes();
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Every file under `dir`, project-relative, leaving out the .gitkeep markers. */
async function filesUnder(root: string, dir: string): Promise<string[]> {
    const names = await readdir(join(root, dir), { recursive: true, withFileTypes: true });
    return names
        .filter((d) => d.isFile() && d.name !== ".gitkeep")
        .map((d) => join(d.parentPath, d.name).slice(root.length + 1));
}

describe("managed files", () => {
    test("init records every file it writes", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");

        const written = [
            ...(await filesUnder(root, ".claude/skills")),
            ...(await filesUnder(root, ".claude/rules")),
            ...(await filesUnder(root, ".craftpath/templates")),
        ].sort();
        const files = await manifestOf(root);

        expect(Object.keys(files).sort()).toEqual(written);
        for (const rel of written) {
            expect(files[rel]).toEqual({ sha256: await sha256Of(root, rel), version: "0.3.0" });
        }
    });

    test("init does not claim a file it kept", async () => {
        const root = await scratch("craftpath-manifest-");
        await Bun.write(join(root, ".craftpath/templates/plan.md"), "our own plan template\n");
        await initIn(root, [CLAUDE_CODE], "0.3.0");

        expect(await Bun.file(join(root, ".craftpath/templates/plan.md")).text()).toBe(
            "our own plan template\n",
        );
        expect(await manifestOf(root)).not.toHaveProperty([".craftpath/templates/plan.md"]);
    });

    test("a second init leaves the manifest alone", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const first = await Bun.file(join(root, MANIFEST)).text();

        await initIn(root, [CLAUDE_CODE], "0.3.1");

        expect(await Bun.file(join(root, MANIFEST)).text()).toBe(first);
    });

    test("each harness's copy is recorded separately", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE, PI], "0.3.0");
        const files = await manifestOf(root);

        for (const rel of [".claude/rules/tdd.md", ".pi/skills/tdd/SKILL.md"]) {
            expect(files[rel]).toEqual({ sha256: await sha256Of(root, rel), version: "0.3.0" });
        }
        expect(files[".claude/rules/tdd.md"]!.sha256).not.toBe(
            files[".pi/skills/tdd/SKILL.md"]!.sha256,
        );
    });
});
