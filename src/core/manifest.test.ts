import { afterAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { CLAUDE_CODE } from "../harness/claude-code";
import type { Harness } from "../harness/index";
import { PI } from "../harness/pi";
import { doctor } from "./doctor";
import { init, managedFiles } from "./init";
import { stampedVersion } from "./stamp";
import { update } from "./update";
import { cleanScratch, scratch } from "../../test/scratch";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

const MANIFEST = ".craftpath/manifest.json";

type Entry = { sha256: string; version: string; declined?: string };

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

function sha256(bytes: string | Uint8Array): string {
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function sha256Of(root: string, rel: string): Promise<string> {
    return sha256(await Bun.file(join(root, rel)).bytes());
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
    ask: ((question: string) => Promise<string>) | null = null,
): Promise<{ output: string; error: (Error & { exitCode?: number }) | null }> {
    const lines: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        await update(root, [CLAUDE_CODE], version, [], release, ask);
        return { output: lines.join("\n"), error: null };
    } catch (error) {
        return { output: lines.join("\n"), error: error as Error & { exitCode?: number } };
    } finally {
        console.log = log;
        console.error = err;
    }
}

/** Runs doctor for claude-code at 0.3.0, returning what it printed. */
async function doctorIn(root: string): Promise<string> {
    const lines: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        // Resolving rather than throwing is doctor's exit 0 (§8).
        await doctor(root, 1000, [CLAUDE_CODE], "0.3.0");
        return lines.join("\n");
    } finally {
        console.log = log;
        console.error = err;
    }
}

const BACKEND = ".claude/skills/backend/SKILL.md";
const UX = ".claude/skills/ux/SKILL.md";

/**
 * Update at a terminal that answers from a script, one answer per question.
 * Running out of answers fails the test rather than hanging it.
 */
async function updateAsking(
    root: string,
    version: string,
    release: Record<string, string>,
    answers: string[],
) {
    const questions: string[] = [];
    const ask = async (question: string) => {
        questions.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`unexpected question: ${question}`);
        return answer;
    };
    return { ...(await updateIn(root, version, release, ask)), questions };
}

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

    /** A project whose backend skill was edited, and a release that changes it. */
    async function conflicted(): Promise<{ root: string; release: Record<string, string> }> {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const release = { ...(await shipped(root)), [BACKEND]: "# backend, improved\n" };
        await Bun.write(join(root, BACKEND), "# our backend conventions\n");
        return { root, release };
    }

    test("taking the new version replaces the file", async () => {
        const { root, release } = await conflicted();

        const { error, questions } = await updateAsking(root, "0.4.0", release, ["t"]);

        expect(questions).toHaveLength(1);
        expect(error).toBeNull();
        expect(await textOf(root, BACKEND)).toBe("# backend, improved\n");
        expect((await manifestOf(root))[BACKEND]).toEqual({
            sha256: await sha256Of(root, BACKEND),
            version: "0.4.0",
        });
        expect(await exists(root, `${BACKEND}.new`)).toBe(false);
    });

    test("keeping mine is remembered", async () => {
        const { root, release } = await conflicted();

        const first = await updateAsking(root, "0.4.0", release, ["k"]);

        expect(first.error).toBeNull();
        expect(await textOf(root, BACKEND)).toBe("# our backend conventions\n");
        expect((await manifestOf(root))[BACKEND]!.declined).toBe(sha256(release[BACKEND]!));

        const second = await updateAsking(root, "0.4.0", release, []);

        expect(second.questions).toHaveLength(0);
        expect(second.error).toBeNull();
        expect(await exists(root, `${BACKEND}.new`)).toBe(false);
    });

    test("a newer change asks again", async () => {
        const { root, release } = await conflicted();
        await updateAsking(root, "0.4.0", release, ["k"]);

        const { questions } = await updateAsking(
            root,
            "0.5.0",
            { ...release, [BACKEND]: "# backend, improved again\n" },
            ["k"],
        );

        expect(questions).toHaveLength(1);
        expect(questions[0]).toContain(BACKEND);
    });

    test("the diff answer shows before deciding", async () => {
        const { root, release } = await conflicted();
        const seen: { text: string; pending: boolean }[] = [];
        const answers = ["d", "k"];
        const ask = async () => {
            seen.push({
                text: await textOf(root, BACKEND),
                pending: await exists(root, `${BACKEND}.new`),
            });
            return answers.shift()!;
        };

        const { output } = await updateIn(root, "0.4.0", release, ask);

        expect(output).toContain("-# our backend conventions");
        expect(output).toContain("+# backend, improved");
        expect(seen).toEqual([
            { text: "# our backend conventions\n", pending: false },
            { text: "# our backend conventions\n", pending: false },
        ]);
    });

    /** Three edited skills, all changed by the release. */
    async function threeConflicts(): Promise<{
        root: string;
        release: Record<string, string>;
        skills: string[];
    }> {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        const skills = [BACKEND, UX, ".claude/skills/frontend/SKILL.md"];
        const release = await shipped(root);
        for (const rel of skills) {
            release[rel] = `${rel}, improved\n`;
            await Bun.write(join(root, rel), `${rel}, ours\n`);
        }
        return { root, release, skills };
    }

    test("take all settles the remaining conflicts", async () => {
        const { root, release, skills } = await threeConflicts();

        const { error, questions } = await updateAsking(root, "0.4.0", release, ["T"]);

        expect(questions).toHaveLength(1);
        expect(error).toBeNull();
        for (const rel of skills) expect(await textOf(root, rel)).toBe(`${rel}, improved\n`);
    });

    test("keep all settles the remaining conflicts", async () => {
        const { root, release, skills } = await threeConflicts();

        const { error, questions } = await updateAsking(root, "0.4.0", release, ["K"]);

        expect(questions).toHaveLength(1);
        expect(error).toBeNull();
        const files = await manifestOf(root);
        for (const rel of skills) {
            expect(await textOf(root, rel)).toBe(`${rel}, ours\n`);
            expect(files[rel]!.declined).toBe(sha256(release[rel]!));
        }
    });

    test("settling a conflict removes the .new an earlier update left", async () => {
        const { root, release } = await conflicted();
        await updateIn(root, "0.4.0", release);
        expect(await exists(root, `${BACKEND}.new`)).toBe(true);

        await updateAsking(root, "0.4.0", release, ["t"]);

        expect(await exists(root, `${BACKEND}.new`)).toBe(false);
    });

    const CLI = join(import.meta.dir, "../../bin/craftpath.ts");

    /** The real CLI, without a terminal, as an agent's shell runs it. */
    async function cli(root: string, ...args: string[]): Promise<number> {
        const p = Bun.spawn([process.execPath, CLI, ...args], {
            cwd: root,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
        });
        return await p.exited;
    }

    /**
     * A project at this build's version whose backend skill was edited after
     * an older release wrote it, so this build's version of it is a conflict.
     */
    async function conflictedForCli(): Promise<string> {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], pkg.version);
        const manifest = (await Bun.file(join(root, MANIFEST)).json()) as {
            files: Record<string, Entry>;
        };
        manifest.files[BACKEND]!.sha256 = "0".repeat(64);
        await Bun.write(join(root, MANIFEST), JSON.stringify(manifest, null, 2));
        await Bun.write(join(root, BACKEND), "# our backend conventions\n");
        return root;
    }

    test("--take settles conflicts without asking", async () => {
        const root = await conflictedForCli();
        const release = managedFiles([CLAUDE_CODE]);

        expect(await cli(root, "update", "--take")).toBe(0);

        expect(await textOf(root, BACKEND)).toBe(release[BACKEND]!);
        expect(await exists(root, `${BACKEND}.new`)).toBe(false);
    });

    test("--keep settles conflicts without asking", async () => {
        const root = await conflictedForCli();
        const release = managedFiles([CLAUDE_CODE]);

        expect(await cli(root, "update", "--keep")).toBe(0);

        expect(await textOf(root, BACKEND)).toBe("# our backend conventions\n");
        expect((await manifestOf(root))[BACKEND]!.declined).toBe(sha256(release[BACKEND]!));
        expect(await exists(root, `${BACKEND}.new`)).toBe(false);
    });

    test("--keep and --take refuse each other", async () => {
        const root = await conflictedForCli();
        const snapshot = async () => {
            const all = await readdir(root, { recursive: true, withFileTypes: true });
            const files: Record<string, string> = {};
            for (const d of all.filter((d) => d.isFile())) {
                const path = join(d.parentPath, d.name);
                files[path] = await Bun.file(path).text();
            }
            return files;
        };
        const before = await snapshot();

        expect(await cli(root, "update", "--keep", "--take")).toBe(4);

        expect(await snapshot()).toEqual(before);
    });

    test("doctor names an edited file", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        await Bun.write(join(root, BACKEND), "# our backend conventions\n");

        const out = await doctorIn(root);

        expect(out).toMatch(new RegExp(`edited.*\\n.*${BACKEND.replaceAll(".", "\\.")}`));
    });

    test("doctor names a waiting conflict", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        await Bun.write(join(root, `${BACKEND}.new`), "# backend, improved\n");

        const out = await doctorIn(root);

        expect(out).toContain(`${BACKEND}.new`);
        expect(out).toContain("craftpath update");
        expect(out).toContain("--keep");
        expect(out).toContain("--take");
    });

    test("doctor is quiet when nothing is edited", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");

        const out = await doctorIn(root);

        expect(out).not.toMatch(/edited|manifest|\.new\b|\.claude\/skills|\.craftpath\/templates/);
    });

    test("doctor notices a missing manifest", async () => {
        const root = await scratch("craftpath-manifest-");
        await initIn(root, [CLAUDE_CODE], "0.3.0");
        await Bun.$`rm ${join(root, MANIFEST)}`.quiet();

        const out = await doctorIn(root);

        expect(out).toContain(MANIFEST);
        expect(out).toMatch(/`craftpath update` will record/);
    });
});
