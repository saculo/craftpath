import { afterAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_CODE } from "../harness/claude-code";
import type { Harness } from "../harness/index";
import { PI } from "../harness/pi";
import { init } from "./init";
import { stampedVersion } from "./stamp";
import { update } from "./update";
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

/**
 * What this build would ship, read back from a project init just wrote: the
 * release an update test starts from before changing one file in it (M8).
 */
async function shipped(root: string): Promise<Record<string, string>> {
    const files = await manifestOf(root);
    const release: Record<string, string> = {};
    for (const rel of Object.keys(files)) release[rel] = await Bun.file(join(root, rel)).text();
    return release;
}

/** Runs update with the given release, returning what it printed and threw. */
async function updateIn(
    root: string,
    version: string,
    release: Record<string, string>,
): Promise<{ output: string; error: (Error & { exitCode?: number }) | null }> {
    const lines: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        await update(root, [CLAUDE_CODE], version, [], release);
        return { output: lines.join("\n"), error: null };
    } catch (error) {
        return { output: lines.join("\n"), error: error as Error & { exitCode?: number } };
    } finally {
        console.log = log;
        console.error = err;
    }
}

const BACKEND = ".claude/skills/backend/SKILL.md";
const UX = ".claude/skills/ux/SKILL.md";

const textOf = (root: string, rel: string) => Bun.file(join(root, rel)).text();
const exists = (root: string, rel: string) => Bun.file(join(root, rel)).exists();

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

    test("update refreshes an unedited file", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const release = { ...(await shipped(root)), [BACKEND]: "# backend, improved\n" };

        const { error } = await updateIn(root, "0.4.0", release);

        expect(error).toBeNull();
        expect(await textOf(root, BACKEND)).toBe("# backend, improved\n");
        expect((await manifestOf(root))[BACKEND]).toEqual({
            sha256: await sha256Of(root, BACKEND),
            version: "0.4.0",
        });
    });

    test("update keeps an edit the release does not touch", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const release = await shipped(root);
        await Bun.write(join(root, BACKEND), "# our backend conventions\n");

        const { error } = await updateIn(root, "0.4.0", release);

        expect(error).toBeNull();
        expect(await textOf(root, BACKEND)).toBe("# our backend conventions\n");
        expect(await exists(root, `${BACKEND}.new`)).toBe(false);
    });

    test("update sets a conflict aside without a terminal", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const release = {
            ...(await shipped(root)),
            [BACKEND]: "# backend, improved\n",
            [UX]: "# ux, improved\n",
        };
        await Bun.write(join(root, BACKEND), "# our backend conventions\n");

        const { output, error } = await updateIn(root, "0.4.0", release);

        expect(await textOf(root, BACKEND)).toBe("# our backend conventions\n");
        expect(await textOf(root, `${BACKEND}.new`)).toBe("# backend, improved\n");
        expect(output + (error?.message ?? "")).toContain(BACKEND);
        expect(error?.exitCode).toBe(2);
        // Everything else still happened before the exit.
        expect(await textOf(root, UX)).toBe("# ux, improved\n");
        expect(stampedVersion(await textOf(root, ".craftpath/config.toml"))).toBe("0.4.0");
    });

    test("update adds a template the project lacks", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const template = ".craftpath/templates/runbook.md";
        const release = { ...(await shipped(root)), [template]: "# Runbook\n" };

        const { error } = await updateIn(root, "0.4.0", release);

        expect(error).toBeNull();
        expect(await textOf(root, template)).toBe("# Runbook\n");
        expect((await manifestOf(root))[template]).toEqual({
            sha256: await sha256Of(root, template),
            version: "0.4.0",
        });
    });

    test("update adopts a file with no manifest entry", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const release = await shipped(root);
        await Bun.$`rm ${join(root, MANIFEST)}`.quiet();
        await Bun.write(join(root, BACKEND), "# our backend conventions\n");

        const { error } = await updateIn(root, "0.4.0", release);

        // Equal to the release: recorded, untouched.
        expect(await textOf(root, UX)).toBe(release[UX]!);
        expect((await manifestOf(root))[UX]).toEqual({
            sha256: await sha256Of(root, UX),
            version: "0.4.0",
        });
        // Different from it: a conflict, as when the release changes an edit.
        expect(await textOf(root, BACKEND)).toBe("# our backend conventions\n");
        expect(await textOf(root, `${BACKEND}.new`)).toBe(release[BACKEND]!);
        expect(error?.exitCode).toBe(2);
    });
});
