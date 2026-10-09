/**
 * Coverage gate: no src/ file may lose line coverage against the
 * committed baseline.
 *
 *   bun run coverage            run the suite with coverage, then this gate
 *   bun evals/coverage/gate.ts --update
 *                               re-record the baseline -- deliberately, in its
 *                               own commit, when coverage legitimately moves
 *
 * In-process coverage only: code reached through a spawned `craftpath`
 * subprocess is not counted. That is the same on every run, so comparisons
 * against the baseline stay fair; it is why new files are not gated.
 */
import { join } from "node:path";

export type Coverage = Record<string, { found: number; hit: number }>;

/** Percentage points a file may drop before the gate fails: line numbers shift as code changes. */
const TOLERANCE = 1;

const ROOT = join(import.meta.dir, "../..");
const BASELINE = join(ROOT, "evals/coverage-baseline.json");
const LCOV = join(ROOT, "coverage/lcov.info");

/** Line totals per src/ source file; tests, helpers and scratch copies are not the product. */
export function parseLcov(text: string): Coverage {
    const coverage: Coverage = {};
    let file: string | null = null;
    for (const line of text.split("\n")) {
        if (line.startsWith("SF:")) {
            const path = line.slice(3);
            file = path.startsWith("src/") && !path.endsWith(".test.ts") ? path : null;
            if (file !== null) coverage[file] = { found: 0, hit: 0 };
        } else if (file !== null && line.startsWith("LF:")) {
            coverage[file]!.found = Number(line.slice(3));
        } else if (file !== null && line.startsWith("LH:")) {
            coverage[file]!.hit = Number(line.slice(3));
        }
    }
    return coverage;
}

const percent = ({ found, hit }: { found: number; hit: number }) =>
    found === 0 ? 100 : (hit / found) * 100;

/** Every file still present whose coverage fell more than the tolerance below its baseline. */
export function compare(baseline: Coverage, current: Coverage): string[] {
    const problems: string[] = [];
    for (const [file, before] of Object.entries(baseline)) {
        const now = current[file];
        if (now === undefined) continue;
        if (percent(now) < percent(before) - TOLERANCE) {
            problems.push(
                `${file}: ${percent(now).toFixed(1)}% of lines covered, ` +
                    `baseline ${percent(before).toFixed(1)}%`,
            );
        }
    }
    return problems.sort();
}

if (import.meta.main) {
    const lcov = Bun.file(LCOV);
    if (!(await lcov.exists())) {
        console.error(`${LCOV} not found; run \`bun run coverage\`.`);
        process.exit(1);
    }
    const current = parseLcov(await lcov.text());

    if (process.argv.includes("--update")) {
        const sorted = Object.fromEntries(
            Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
        );
        await Bun.write(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
        console.log(`recorded  ${Object.keys(sorted).length} files in ${BASELINE}`);
        process.exit(0);
    }

    const problems = compare((await Bun.file(BASELINE).json()) as Coverage, current);
    if (problems.length > 0) {
        console.error(
            [
                "Coverage dropped below the baseline:",
                ...problems.map((p) => `  - ${p}`),
                "",
                "A test that covered these was removed or broken. Restore it, or cover the lines",
                "another way; re-record with `bun evals/coverage/gate.ts --update` only when the",
                "drop is deliberate.",
            ].join("\n"),
        );
        process.exit(1);
    }
    console.log(`coverage  no src/ file below its baseline`);
}
