import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config";
import { SLOW_MS, doctor } from "./doctor";
import { BLANK_CONFIG, init } from "./init";
import { configHash } from "./task";
import { update } from "./update";
import { DEFAULT_HARNESS } from "../harness/index";
import { cleanScratch, scratch } from "../../test/scratch";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

/** Silences a command that writes to stdout, or warns about PATH. */
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

const STAMP = (version: string) => `[craftpath]\nversion = "${version}"\n\n`;

/** A root holding only a config.toml with the given text. */
async function withConfig(text: string): Promise<string> {
    const root = await scratch("craftpath-stamp-");
    await Bun.write(join(root, ".craftpath/config.toml"), text);
    return root;
}

async function hashOf(text: string): Promise<string> {
    return await configHash(await withConfig(text));
}

describe("version stamp", () => {
    test("init writes the running version first", async () => {
        const root = await scratch("craftpath-stamp-");
        await quietly(() => init(root, undefined, "0.3.0"));

        const text = await Bun.file(join(root, ".craftpath/config.toml")).text();
        expect(text).toBe(STAMP("0.3.0") + BLANK_CONFIG);
    });

    test("config loads with the stamp", async () => {
        const config = await loadConfig(await withConfig(STAMP("0.3.0") + BLANK_CONFIG));
        expect(config.craftpath?.version).toBe("0.3.0");
    });

    test("the stamp is not part of the config hash", async () => {
        // update rewrites the stamp on every upgrade. If the hash covered it,
        // every piece of evidence in an open work item would go stale with it.
        const bare = await hashOf(BLANK_CONFIG);
        expect(await hashOf(STAMP("0.1.1") + BLANK_CONFIG)).toBe(bare);
        expect(await hashOf(STAMP("0.3.0") + BLANK_CONFIG)).toBe(bare);
    });

    test("the rest of the file still is", async () => {
        // The guard on the test above: a hash that ignored everything would
        // pass it too, and never make anything stale again.
        const edited = BLANK_CONFIG.replace('run = ""', 'run = "bun test"');
        expect(await hashOf(STAMP("0.3.0") + edited)).not.toBe(
            await hashOf(STAMP("0.3.0") + BLANK_CONFIG),
        );
    });

    /** An initialised project whose config.toml is replaced with the given text. */
    async function initialised(config: string): Promise<string> {
        const root = await scratch("craftpath-stamp-");
        await quietly(() => init(root));
        await Bun.write(join(root, ".craftpath/config.toml"), config);
        return root;
    }

    const configOf = (root: string) => Bun.file(join(root, ".craftpath/config.toml")).text();

    /** Runs update, returning what it printed and the error it threw, if any. */
    async function updateIn(
        root: string,
        version: string,
    ): Promise<{ output: string; error: (Error & { exitCode?: number }) | null }> {
        const lines: string[] = [];
        const log = console.log;
        const err = console.error;
        console.log = (...args: unknown[]) => void lines.push(args.join(" "));
        console.error = (...args: unknown[]) => void lines.push(args.join(" "));
        try {
            await update(root, [DEFAULT_HARNESS], version);
            return { output: lines.join("\n"), error: null };
        } catch (error) {
            return { output: lines.join("\n"), error: error as Error & { exitCode?: number } };
        } finally {
            console.log = log;
            console.error = err;
        }
    }

    const MINE = "# my note about this project\n" + BLANK_CONFIG;

    test("update stamps a project that has none", async () => {
        const root = await initialised(MINE);
        expect((await updateIn(root, "0.3.0")).error).toBeNull();
        expect(await configOf(root)).toBe(STAMP("0.3.0") + MINE);
    });

    test("update moves the stamp forward", async () => {
        const root = await initialised(STAMP("0.1.1") + MINE);
        expect((await updateIn(root, "0.3.0")).error).toBeNull();
        expect(await configOf(root)).toBe(STAMP("0.3.0") + MINE);
    });

    test("update refuses a newer stamp", async () => {
        // An older CLI would write its older templates over a project a newer
        // one set up. The stale command file is how "nothing was rewritten"
        // becomes observable: a rewrite would replace it.
        const root = await initialised(STAMP("0.4.0") + MINE);
        const command = join(
            root,
            DEFAULT_HARNESS.commandsDir,
            DEFAULT_HARNESS.commandFile("work"),
        );
        await Bun.write(command, "stale\n");

        const { output, error } = await updateIn(root, "0.3.0");
        expect(error?.exitCode).toBe(2);
        expect(`${output}\n${error?.message}`).toContain("0.4.0");
        expect(`${output}\n${error?.message}`).toContain("0.3.0");
        expect(await configOf(root)).toBe(STAMP("0.4.0") + MINE);
        expect(await Bun.file(command).text()).toBe("stale\n");
    });

    test("update leaves a missing config missing", async () => {
        const root = await scratch("craftpath-stamp-");
        await quietly(() => init(root));
        await rm(join(root, ".craftpath/config.toml"));

        const { output, error } = await updateIn(root, "0.3.0");
        expect(error).toBeNull();
        expect(output).toContain("rewrote");
        expect(await Bun.file(join(root, ".craftpath/config.toml")).exists()).toBe(false);
    });

    test("update leaves a hand-edited stamp alone", async () => {
        // Not the exact block, so not recognised -- and prepending a second
        // [craftpath] table would make the file invalid TOML, which every
        // command then refuses.
        const edited =
            '[craftpath]\n# pinned for the monorepo\nversion = "0.1.1"\n\n' + BLANK_CONFIG;
        const root = await initialised(edited);

        const { output, error } = await updateIn(root, "0.3.0");
        expect(error).toBeNull();
        expect(await configOf(root)).toBe(edited);
        expect(await loadConfig(root)).toBeDefined();
        expect(output).toMatch(/stamp.*not/i);
    });

    /** Runs doctor with the given running version, returning what it printed. */
    async function doctorIn(root: string, version: string): Promise<string> {
        const lines: string[] = [];
        const log = console.log;
        console.log = (...args: unknown[]) => void lines.push(args.join(" "));
        try {
            await doctor(root, SLOW_MS, [DEFAULT_HARNESS], version);
        } finally {
            console.log = log;
        }
        return lines.join("\n");
    }

    test("doctor names an older project", async () => {
        // Returning at all is the exit 0: doctor reports, it never refuses.
        const out = await doctorIn(await initialised(STAMP("0.1.1") + BLANK_CONFIG), "0.3.0");
        expect(out).toContain("0.1.1");
        expect(out).toContain("0.3.0");
        expect(out).toContain("craftpath update");
    });

    test("doctor names a project with no stamp", async () => {
        const out = await doctorIn(await initialised(BLANK_CONFIG), "0.3.0");
        expect(out).toMatch(/no version stamp/i);
        expect(out).toContain("craftpath update");
    });

    test("doctor names a newer project", async () => {
        const out = await doctorIn(await initialised(STAMP("0.4.0") + BLANK_CONFIG), "0.3.0");
        expect(out).toContain("0.4.0");
        expect(out).toMatch(/upgrade craftpath/i);
        expect(out).not.toContain("craftpath update");
    });

    test("doctor is quiet when versions match", async () => {
        // The guard on the three above: a doctor that always talked about
        // versions would pass them, and teach people to skip the line.
        const out = await doctorIn(await initialised(STAMP("0.3.0") + BLANK_CONFIG), "0.3.0");
        expect(out).not.toContain("0.3.0");
        expect(out).not.toMatch(/stamp|scaffolded|set up by/i);
    });
});
