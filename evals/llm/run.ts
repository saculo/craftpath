/**
 * Run eval scenarios against a real model, headless, and record the grades.
 *
 *   bun evals/llm/run.ts <E1..E6 | all> [--harness claude-code|pi|both]
 *                        [--model <model>] [--thinking <level>] [--keep]
 *
 * Each scenario builds its fixture with the scripts alone, runs its steps the
 * way a user would (`/craftpath-review C-00001`, `/skill:craftpath-review
 * C-00001` on pi), grades what they left behind, and appends one line per run
 * to `evals/llm/results/<date>.jsonl`. A failed run's directory is kept, with
 * the transcripts, for reading; a passed one is removed unless `--keep`.
 *
 * Costs money and needs a logged-in harness, so it never runs in CI. The
 * graders are tested in CI by `graders.test.ts`.
 */
import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type Fixture, fixture, type HarnessName, ID, type Start } from "./fixture";
import { collect, GRADERS } from "./graders";

interface Scenario {
    start: Start;
    /** Each step as `<step> <args>`, run in order. */
    steps: string[];
    /** A stronger model, for the whole flow. */
    strong?: boolean;
}

const REQUEST =
    "Add clamp(value, min, max) in src/clamp.ts, tested in test/clamp.test.ts: a value inside [min, max] is " +
    "returned as it is, one outside is moved to the nearest bound, and min > max throws a RangeError. " +
    "Non-numeric input is out of scope. Decide anything else yourself; there are no open questions.";

const SCENARIOS: Record<string, Scenario> = {
    E1: { start: "planned-two", steps: [`work ${ID} all`] },
    E2: { start: "done-gap", steps: [`review ${ID}`] },
    E3: { start: "gap-fixed", steps: [`review ${ID}`] },
    E4: { start: "done-notes", steps: [`learn ${ID}`] },
    E5: { start: "ticked", steps: [`learn-apply ${ID}`, `pr ${ID}`] },
    E6: {
        start: "fresh",
        steps: [`spec ${REQUEST}`, `plan ${ID}`, `work ${ID} all`, `review ${ID}`],
        strong: true,
    },
};

const MODELS: Record<HarnessName, { cheap: string; strong: string }> = {
    "claude-code": { cheap: "haiku", strong: "sonnet" },
    pi: { cheap: "gpt-5.5", strong: "gpt-5.5" },
};

const STEP_TIMEOUT_MS = 20 * 60 * 1000;

function command(harness: HarnessName, step: string, model: string, thinking: string): string[] {
    const [name, ...rest] = step.split(" ");
    const args = rest.join(" ");
    if (harness === "claude-code") {
        const prompt = `/craftpath-${name} ${args}`;
        return [
            "claude",
            "-p",
            prompt,
            "--model",
            model,
            "--settings",
            ".claude/settings.json",
            "--output-format",
            "stream-json",
            "--verbose",
        ];
    }
    const prompt = `/skill:craftpath-${name} ${args}`;
    return [
        "pi",
        "-p",
        prompt,
        "--model",
        model,
        "--thinking",
        thinking,
        "--approve",
        "--mode",
        "json",
    ];
}

/** Run one step; pi's headless mode sometimes stalls before any output, so a timed-out pi step is tried once more. */
async function runStep(fx: Fixture, argv: string[], transcript: string): Promise<number> {
    for (let attempt = 1; attempt <= (fx.harness === "pi" ? 2 : 1); attempt++) {
        const p = Bun.spawn(argv, {
            cwd: fx.tree,
            env: { ...process.env, PATH: `${fx.stub}:${process.env.PATH}` },
            stdin: "ignore",
            stdout: Bun.file(`${transcript}.${attempt}.jsonl`),
            stderr: "pipe",
            timeout: STEP_TIMEOUT_MS,
        });
        const code = await p.exited;
        if (!p.signalCode) return code;
        console.error(`  timed out (attempt ${attempt})`);
    }
    return 124;
}

/** After `spec`, the work item's worktree. */
async function worktreeOf(fx: Fixture): Promise<string> {
    const parent = join(fx.dir, "app.craftpath");
    const found = (await readdir(parent).catch(() => [] as string[])).find((n) =>
        n.startsWith(`${ID}-`),
    );
    if (!found) throw new Error("spec created no worktree");
    return join(parent, found);
}

async function run(id: string, harness: HarnessName, flags: Flags): Promise<boolean> {
    const scenario = SCENARIOS[id]!;
    const model = flags.model ?? (scenario.strong ? MODELS[harness].strong : MODELS[harness].cheap);
    const started = Date.now();
    let fx = await fixture(scenario.start, harness);
    await mkdir(join(fx.dir, "transcripts"), { recursive: true });
    console.log(`${id} on ${harness} (${model}) in ${fx.dir}`);
    for (const [i, step] of scenario.steps.entries()) {
        const name = step.split(" ")[0]!;
        const code = await runStep(
            fx,
            command(harness, step, model, flags.thinking),
            join(fx.dir, "transcripts", `${i + 1}-${name}`),
        );
        console.log(`  ${name}: exit ${code}`);
        if (name === "spec") fx = { ...fx, tree: await worktreeOf(fx) };
    }
    const grade = GRADERS[id]!(await collect(fx));
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(
        `  ${grade.pass ? "PASS" : "FAIL"} in ${seconds}s${grade.reasons.map((r) => `\n    - ${r}`).join("")}`,
    );

    const results = new URL("./results/", import.meta.url).pathname;
    await mkdir(results, { recursive: true });
    const line = {
        date: new Date().toISOString(),
        scenario: id,
        harness,
        model,
        thinking: harness === "pi" ? flags.thinking : undefined,
        ...grade,
        seconds,
        dir: grade.pass && !flags.keep ? undefined : fx.dir,
    };
    await appendFile(join(results, `${line.date.slice(0, 10)}.jsonl`), `${JSON.stringify(line)}\n`);
    if (grade.pass && !flags.keep) await rm(fx.dir, { recursive: true, force: true });
    return grade.pass;
}

interface Flags {
    harnesses: HarnessName[];
    model?: string;
    thinking: string;
    keep: boolean;
}

function parse(argv: string[]): { ids: string[]; flags: Flags } | null {
    const value = (name: string) => {
        const i = argv.indexOf(name);
        return i === -1 ? undefined : argv[i + 1];
    };
    const which = argv[0];
    const ids =
        which === "all" ? Object.keys(SCENARIOS) : which && which in SCENARIOS ? [which] : null;
    const harness = value("--harness") ?? "claude-code";
    const harnesses: HarnessName[] =
        harness === "both"
            ? ["claude-code", "pi"]
            : harness === "pi"
              ? ["pi"]
              : harness === "claude-code"
                ? ["claude-code"]
                : [];
    if (!ids || harnesses.length === 0) return null;
    return {
        ids,
        flags: {
            harnesses,
            model: value("--model"),
            thinking: value("--thinking") ?? "low",
            keep: argv.includes("--keep"),
        },
    };
}

if (import.meta.main) {
    const parsed = parse(Bun.argv.slice(2));
    if (!parsed) {
        console.error(
            `usage: bun evals/llm/run.ts <${Object.keys(SCENARIOS).join("|")}|all> [--harness claude-code|pi|both] [--model <model>] [--thinking <level>] [--keep]`,
        );
        process.exit(2);
    }
    let failed = 0;
    for (const harness of parsed.flags.harnesses) {
        for (const id of parsed.ids) {
            try {
                if (!(await run(id, harness, parsed.flags))) failed++;
            } catch (error) {
                failed++;
                console.error(
                    `${id} on ${harness}: ${error instanceof Error ? error.message : error}`,
                );
            }
        }
    }
    process.exit(failed > 0 ? 1 : 0);
}
