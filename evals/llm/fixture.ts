/**
 * The toy project each eval scenario starts from, brought to the scenario's
 * starting point by craftpath's own scripts -- no model, no cost.
 *
 * `app` is a Bun project; `clamp(value, min, max)` is the feature, with three
 * scenarios: S1 keeps a value inside the range, S2 moves one outside it to the
 * nearest bound, S3 refuses an empty range (min > max) with a RangeError.
 * `origin` is a bare repository next to it, and `gh` a stub that records its
 * calls, so nothing reaches GitHub.
 */
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type HarnessName = "claude-code" | "pi";

export type Start =
    | "fresh" // craftpath installed, nothing else
    | "planned-two" // C-00001 planned: clamp in module math, greet in module greet, one wave
    | "done-gap" // clamp done and committed, S3 left out
    | "gap-fixed" // done-gap, reviewed with R1 open on S3, and S3 then fixed
    | "done-notes" // clamp done with S3, its Notes holding a decision and a trap; review closed
    | "ticked"; // done-notes with both knowledge candidates proposed and ticked

export interface Fixture {
    dir: string;
    root: string;
    /** The work item's worktree; the main checkout until a work item exists. */
    tree: string;
    stub: string;
    harness: HarnessName;
    /** The commit that fixed R1, for gap-fixed. */
    fixSha?: string;
}

const CRAFTPATH = new URL("../../bin/craftpath.ts", import.meta.url).pathname;
export const ID = "C-00001";
export const WORK = `.craftpath/work/${ID}`;

const git = (cwd: string, ...args: string[]) =>
    Bun.$`git -C ${cwd} -c user.email=eval@craftpath -c user.name=eval ${args}`.quiet();

async function py(cwd: string, ...args: string[]): Promise<string> {
    const p = await Bun.$`python3 ${args}`.cwd(cwd).quiet().nothrow();
    if (p.exitCode !== 0) throw new Error(`python3 ${args.join(" ")}: ${p.stderr}${p.stdout}`);
    return p.stdout.toString();
}

export const SPEC = `# C-00001 — Clamp a number

## Problem

Callers need to keep a number inside a range, and each writes its own clamp.

## Scenarios

### S1 — A value inside the range is kept

- **Given** min 0 and max 10
- **When** clamp(5, 0, 10) is called
- **Then** it returns 5

### S2 — A value outside the range is moved to the nearest bound

- **Given** min 0 and max 10
- **When** clamp(-3, 0, 10) or clamp(42, 0, 10) is called
- **Then** it returns 0, or 10

### S3 — An empty range is refused

- **Given** min 10 and max 0
- **When** clamp(5, 10, 0) is called
- **Then** it throws a RangeError

## Out of scope

Non-numeric input.

## Open questions

None
`;

const NOTES = `- clamp(5, 10, 0) throws instead of swapping the bounds: we first swapped them,
  but that silently hid callers that passed the arguments in the wrong order
  (two call sites in the billing code did). Throwing surfaces them.
- \`bun test\` must be run from the repository root: running it inside \`src/\`
  finds no tests and exits 0, which looks like a pass.
`;

const task = (
    id: string,
    title: string,
    touches: string,
    scenarios: string,
    criteria: string,
    notes = "",
) =>
    `# ${id} — ${title}

- **Work:** ${ID}
- **Type:** feat
- **Wave:** 1
- **Depends on:** none
- **Touches:** ${touches}
- **Scenarios:** ${scenarios}

## Acceptance criteria

${criteria}

## Notes
${notes ? `\n${notes}` : ""}`;

const CLAMP_CRITERIA = [
    "- **A1** clamp(5, 0, 10) returns 5 — proven by integration test `keeps a value inside the range`",
    "- **A2** clamp(-3, 0, 10) returns 0 and clamp(42, 0, 10) returns 10 — proven by integration test `moves a value to the nearest bound`",
    "- **A3** clamp(5, 10, 0) throws a RangeError — proven by integration test `refuses an empty range`",
].join("\n");

const S3_GUARD = '    if (min > max) throw new RangeError("empty range: min > max");\n';

const CLAMP = (
    withS3: boolean,
) => `export function clamp(value: number, min: number, max: number): number {
${withS3 ? S3_GUARD : ""}    return Math.min(Math.max(value, min), max);
}
`;

const CLAMP_TEST = (withS3: boolean) => `import { expect, test } from "bun:test";
import { clamp } from "../src/clamp";

test("keeps a value inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
});

test("moves a value to the nearest bound", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
});
${
    withS3
        ? `
test("refuses an empty range", () => {
    expect(() => clamp(5, 10, 0)).toThrow(RangeError);
});
`
        : ""
}`;

const PLAN = (approach: string) => `# C-00001 — Clamp a number: plan

## Goal

One clamp(value, min, max) that every caller uses.

## Approach

${approach}

## Tasks
`;

const GH = (stub: string) => `#!/bin/sh
echo "$*" >> "${stub}/calls"
case "$1 $2" in
  "pr view") [ -f "${stub}/existing" ] && { echo https://github.example/o/app/pull/1; exit 0; }; exit 1 ;;
  "pr create")
    while [ $# -gt 0 ]; do [ "$1" = "--body-file" ] && cp "$2" "${stub}/body.md"; shift; done
    touch "${stub}/existing"; echo https://github.example/o/app/pull/1 ;;
esac
`;

/** A fresh scratch directory with `app` (craftpath installed and committed), `origin` and the gh stub. */
async function base(harness: HarnessName, modules: "one" | "two"): Promise<Fixture> {
    const dir = await mkdtemp(join(tmpdir(), "craftpath-eval-"));
    const root = join(dir, "app");
    const stub = join(dir, "stub");
    await mkdir(stub, { recursive: true });
    await Bun.write(join(stub, "gh"), GH(stub));
    await Bun.$`chmod +x ${join(stub, "gh")}`;

    await Bun.write(join(root, "package.json"), '{"name":"app","scripts":{"test":"bun test"}}\n');
    await Bun.write(join(root, ".gitignore"), "node_modules\n");
    if (modules === "two") {
        for (const m of ["math", "greet"]) {
            await Bun.write(
                join(root, m, "package.json"),
                `{"name":"${m}","scripts":{"test":"bun test"}}\n`,
            );
            await Bun.write(join(root, m, "src/index.ts"), "export {};\n");
        }
    } else {
        await Bun.write(join(root, "src/index.ts"), "export {};\n");
    }
    await git(root, "init", "-q", "-b", "main");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "chore: base");
    await Bun.$`bun ${CRAFTPATH} init --harness ${harness}`.cwd(root).quiet();
    if (modules === "two") {
        await Bun.write(
            join(root, ".craftpath/config.toml"),
            '[git]\nbase_branch = "main"\n\n[modules.math]\npath = "math/"\ntest = "bun test"\n\n[modules.greet]\npath = "greet/"\ntest = "bun test"\n',
        );
    }
    if (harness === "pi") {
        const path = join(root, ".pi/settings.json");
        const settings = JSON.parse(await Bun.file(path).text());
        await Bun.write(
            path,
            `${JSON.stringify({ ...settings, packages: ["npm:pi-subagents-lite"] }, null, 2)}\n`,
        );
    }
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "chore: install craftpath");
    await git(root, "init", "-q", "--bare", join(dir, "origin.git"));
    await git(root, "remote", "add", "origin", join(dir, "origin.git"));
    return { dir, root, tree: root, stub, harness };
}

/** spec.py, then SPEC.md written: the work item's worktree. */
async function specified(fx: Fixture, spec: string): Promise<Fixture> {
    await py(fx.root, ".craftpath/scripts/spec.py", "Clamp a number");
    const tree = join(fx.root, ".craftpath/worktrees", "C-00001-clamp-a-number");
    await Bun.write(join(tree, WORK, "SPEC.md"), spec);
    return { ...fx, tree };
}

/** plan.py and task.py, then the plan and task files written. */
async function planned(fx: Fixture, approach: string, tasks: [string, string][]): Promise<void> {
    await py(fx.tree, ".craftpath/scripts/plan.py", ID);
    await Bun.write(join(fx.tree, WORK, "PLAN.md"), PLAN(approach));
    for (const [i, [title, body]] of tasks.entries()) {
        await py(fx.tree, ".craftpath/scripts/task.py", ID, "--wave", "1", title);
        await Bun.write(join(fx.tree, WORK, `tasks/T-000${i + 1}.md`), body);
    }
    await py(fx.tree, ".craftpath/scripts/check.py", "plan", ID);
}

/** clamp planned as one task, implemented (with or without S3) and completed. */
async function clampDone(harness: HarnessName, withS3: boolean, notes = ""): Promise<Fixture> {
    const fx = await specified(await base(harness, "one"), SPEC);
    await planned(fx, "One task: a single small function and its tests.", [
        [
            "Add clamp",
            task(
                "T-0001",
                "Add clamp",
                "src/clamp.ts, test/clamp.test.ts",
                "S1, S2, S3",
                CLAMP_CRITERIA,
                notes,
            ),
        ],
    ]);
    await py(fx.tree, ".craftpath/scripts/work.py", ID, "all");
    await Bun.write(join(fx.tree, "src/clamp.ts"), CLAMP(withS3));
    await Bun.write(join(fx.tree, "test/clamp.test.ts"), CLAMP_TEST(withS3));
    await py(fx.tree, ".craftpath/scripts/complete.py", ID, "T-0001");
    return fx;
}

async function reviewWith(fx: Fixture, points: string): Promise<void> {
    await py(fx.tree, ".craftpath/scripts/review.py", ID);
    const head = (await git(fx.tree, "rev-parse", "HEAD")).text().trim();
    await Bun.write(
        join(fx.tree, WORK, "REVIEW.md"),
        `# C-00001 — Clamp a number: review\n\n- **Reviewed at:** ${head}\n\n## Points\n\n${points}\n`,
    );
}

export const R1 =
    "- [ ] R1 [major] src/clamp.ts:1 -- S3 is not implemented: clamp(5, 10, 0) returns 5 instead of throwing a RangeError, and no test covers it";

export async function fixture(start: Start, harness: HarnessName): Promise<Fixture> {
    switch (start) {
        case "fresh":
            return base(harness, "one");
        case "planned-two": {
            const fx = await specified(
                await base(harness, "two"),
                SPEC.replace("### S3 — An empty range is refused", "### S3 — A name is greeted")
                    .replace("- **Given** min 10 and max 0", "- **Given** the name Ada")
                    .replace(
                        "- **When** clamp(5, 10, 0) is called",
                        '- **When** greet("Ada") is called',
                    )
                    .replace(
                        "- **Then** it throws a RangeError",
                        '- **Then** it returns "Hello, Ada!"',
                    ),
            );
            await planned(fx, "Two tasks in two modules, so they run in parallel in one wave.", [
                [
                    "Add clamp",
                    task(
                        "T-0001",
                        "Add clamp",
                        "math/src/clamp.ts, math/test/clamp.test.ts",
                        "S1, S2",
                        CLAMP_CRITERIA.split("\n").slice(0, 2).join("\n"),
                    ),
                ],
                [
                    "Add greet",
                    task(
                        "T-0002",
                        "Add greet",
                        "greet/src/greet.ts, greet/test/greet.test.ts",
                        "S3",
                        '- **A1** greet("Ada") returns "Hello, Ada!" — proven by integration test `greets a name`',
                    ),
                ],
            ]);
            return fx;
        }
        case "done-gap":
            return clampDone(harness, false);
        case "gap-fixed": {
            const fx = await clampDone(harness, false);
            await reviewWith(fx, R1);
            await Bun.write(join(fx.tree, "src/clamp.ts"), CLAMP(true));
            await Bun.write(join(fx.tree, "test/clamp.test.ts"), CLAMP_TEST(true));
            await git(fx.tree, "add", "src", "test");
            await git(fx.tree, "commit", "-q", "-m", "fix(C-00001): refuse an empty range");
            return { ...fx, fixSha: (await git(fx.tree, "rev-parse", "HEAD")).text().trim() };
        }
        case "done-notes": {
            const fx = await clampDone(harness, true, NOTES);
            await reviewWith(fx, "None");
            return fx;
        }
        case "ticked": {
            const fx = await clampDone(harness, true, NOTES);
            await reviewWith(fx, "None");
            await py(fx.tree, ".craftpath/scripts/learn.py", ID);
            await Bun.write(join(fx.tree, WORK, "KNOWLEDGE.md"), TICKED);
            return fx;
        }
    }
}

const TICKED = `# C-00001 — Clamp a number: knowledge

## Candidates

- [x] K1 [ADR] Refuse an empty clamp range
  - **Context:** callers sometimes pass the bounds in the wrong order, and swapping them silently hid two such call sites.
  - **Decision:** clamp throws a RangeError when min > max; the bounds are never swapped.
  - **Consequences:** wrong-order calls fail loudly; callers must pass min before max.
  - **Source:** T-0001 Notes

- [x] K2 [CLAUDE.md] Run \`bun test\` from the repository root; inside \`src/\` it finds no tests and exits 0.
  - **Source:** T-0001 Notes
`;
