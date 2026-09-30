import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { init } from "./init";
import { STATE, workNew } from "./work";
import { cleanScratch, scratch } from "../../test/scratch";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

const CLI = join(import.meta.dir, "../../bin/craftpath.ts");

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

/** What an interrupted `work new` leaves: the work directory, and no state. */
async function stateless(): Promise<string> {
    const root = await scratch("craftpath-work-");
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await rm(join(root, STATE, "0001-avatar-upload"), { recursive: true });
    return root;
}

async function status(root: string): Promise<{ exit: number; output: string }> {
    const p = Bun.spawn(["bun", CLI, "status"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const output = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { exit: await p.exited, output };
}

describe("status", () => {
    test("a work directory with no state says how to recover", async () => {
        const { exit, output } = await status(await stateless());
        expect(exit).toBe(3);
        expect(output).toMatch(/interrupted `?(craftpath )?work new`?/);
        expect(output).toMatch(/remove/i);
        expect(output).toMatch(/work new.*again/);
    });

    test("a work directory with no state does not promise a repair", async () => {
        // reconcile --fix deliberately leaves this alone (T602-A3): nothing
        // records what the work item was meant to be. Sending people there
        // sends them straight back.
        const { output } = await status(await stateless());
        expect(output).not.toContain("once it exists");
        expect(output).not.toMatch(/run `?craftpath reconcile/i);
    });
});
