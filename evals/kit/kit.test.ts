/**
 * The eval kit (T641): fixture repos, craftpath as a subprocess, and a world
 * snapshot two runs can be diffed on. Every tier above unit builds on these,
 * so each is proven against the real CLI before anything trusts it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cleanScratch } from "../../test/scratch";
import { cli } from "./cli";
import { fixture, restore, snapshot } from "./repo";
import { diff, world } from "./world";

afterAll(cleanScratch);

describe("eval kit", () => {
    test("a fresh claude-code fixture with one root module has no open work item", async () => {
        const root = await fixture({
            harness: ["claude-code"],
            modules: { app: { path: "./", test: "true" } },
        });

        const status = await cli(root, "status");

        expect(status.exit).toBe(0);
        expect((await world(root)).work).toEqual({});
    });

    test("a fixture restored from a mid-flow snapshot equals it, and status names the started task", async () => {
        const root = await fixture({
            harness: ["claude-code"],
            modules: { app: { path: "./", test: "true" } },
            gates: { plan: "auto" },
        });
        await cli(root, 'work new "Avatar upload"');
        await cli(root, 'task add T001 --title "Add the endpoint" --skills backend');
        await cli(root, "approve requirement");
        await cli(root, "approve plan");
        await cli(root, "task start T001");
        const saved = await snapshot(root);

        const restored = await restore(saved);

        expect((await world(restored)).files).toEqual((await world(root)).files);
        expect((await world(restored)).work["W-0001-avatar-upload"]?.tasks).toEqual({
            T001: "in_progress",
        });
        expect((await cli(restored, "status")).stdout).toMatch(/T001\s+in_progress/);
    });

    test("diffing the worlds around a command lists exactly what it created, changed or removed", async () => {
        const root = await fixture({
            harness: ["claude-code"],
            modules: { app: { path: "./", test: "true" } },
        });
        await cli(root, 'work new "Avatar upload"');
        const before = await world(root);

        await cli(root, 'task add T001 --title "Add the endpoint" --skills backend');

        expect(diff(before, await world(root))).toEqual({
            created: [
                ".craftpath/state/W-0001-avatar-upload/T001.json",
                ".craftpath/work/W-0001-avatar-upload/tasks/T001-backend.md",
            ],
            changed: [],
            removed: [],
        });
    });
});
