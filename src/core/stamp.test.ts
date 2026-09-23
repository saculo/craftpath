import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig } from "./config";
import { BLANK_CONFIG, init } from "./init";
import { configHash } from "./task";
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
});
