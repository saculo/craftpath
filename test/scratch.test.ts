import { describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { cleanScratch, scratch } from "./scratch";

const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );

describe("scratch directories", () => {
    test("are removed by cleanScratch", async () => {
        const a = await scratch("craftpath-scratch-");
        const b = await scratch("craftpath-scratch-");
        // Non-empty on purpose: the leak is directories full of scaffolded
        // files, and a cleanup that only handles empty ones fixes nothing.
        await Bun.write(join(a, "nested/file.txt"), "x");

        await cleanScratch();

        expect(await exists(a)).toBe(false);
        expect(await exists(b)).toBe(false);
    });

    test("survive a second cleanScratch", async () => {
        // Every test file registers cleanScratch on afterAll, and a file may
        // also call it directly. The second call must not fail on directories
        // the first one already removed.
        const a = await scratch("craftpath-scratch-");
        await cleanScratch();
        await cleanScratch();

        expect(await exists(a)).toBe(false);
    });
});
