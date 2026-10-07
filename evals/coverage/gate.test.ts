/**
 * The coverage gate: what makes deleting tests safe (T640).
 *
 * The suite is about to shrink -- flows replace single-command tests. A test
 * removed while it still covered something nothing else does is a hole that
 * reads as a tidy-up. The gate compares each src/ file's line coverage with a
 * committed baseline and names every file that dropped.
 */
import { describe, expect, test } from "bun:test";
import { type Coverage, compare, parseLcov } from "./gate";

const LCOV = [
    "TN:",
    "SF:src/core/task.ts",
    "LF:100",
    "LH:80",
    "end_of_record",
    "SF:src/core/work.ts",
    "LF:50",
    "LH:50",
    "end_of_record",
    "SF:test/scratch.ts",
    "LF:10",
    "LH:1",
    "end_of_record",
    "SF:src/core/task.test.ts",
    "LF:10",
    "LH:1",
    "end_of_record",
    "SF:../../../../tmp/craftpath-pi-ext-x/craftpath.ts",
    "LF:10",
    "LH:1",
    "end_of_record",
].join("\n");

const baseline: Coverage = {
    "src/core/task.ts": { found: 100, hit: 80 },
    "src/core/work.ts": { found: 50, hit: 50 },
};

describe("coverage gate", () => {
    test("reads src/ files only, leaving tests, helpers and scratch copies out", () => {
        expect(parseLcov(LCOV)).toEqual(baseline);
    });

    test("an unchanged suite passes", () => {
        expect(compare(baseline, baseline)).toEqual([]);
    });

    test("a file whose coverage drops below its baseline fails, naming it", () => {
        const current = { ...baseline, "src/core/task.ts": { found: 100, hit: 60 } };

        expect(compare(baseline, current)).toEqual([
            "src/core/task.ts: 60.0% of lines covered, baseline 80.0%",
        ]);
    });

    test("a drop within the tolerance passes, and a rise passes", () => {
        const current = {
            "src/core/task.ts": { found: 101, hit: 80 }, // 79.2%, within 1 point
            "src/core/work.ts": { found: 60, hit: 60 },
        };

        expect(compare(baseline, current)).toEqual([]);
    });

    test("a deleted file is not a drop", () => {
        const current = { "src/core/task.ts": baseline["src/core/task.ts"]! };

        expect(compare(baseline, current)).toEqual([]);
    });

    test("a new file is not held to anything yet", () => {
        // Coverage here is in-process only, and CLI handlers are tested through
        // a subprocess -- a well-tested new command would read as uncovered.
        // The gate guards against loss, which is what deleting tests risks.
        const current = { ...baseline, "src/core/new.ts": { found: 40, hit: 4 } };

        expect(compare(baseline, current)).toEqual([]);
    });
});
