/**
 * `bun run eval:llm` -- real agents, driven by craftpath, in fixture repos.
 *
 * Guard rails, in order: the worst-case cost is printed and nothing spends
 * until it is confirmed (a terminal answers yes, or --yes); every run is
 * capped on turns, dollars and minutes, and hitting a cap is a failure, never
 * a retry; every trial appends one record.
 *
 *   --scenario <id>  --harness <claude-code|pi>  --trials <n>  --model <m>  --yes
 */
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { CLAUDE_CODE } from "../../src/harness/claude-code";
import { PI as PI_HARNESS } from "../../src/harness/pi";
import { fixture } from "../kit/repo";
import { GRADERS, type Verdict } from "./graders";
import { CLAUDE, type Launcher, PI, craftpathShim } from "./launch";
import { type Scenario, fixtureFiles, loadScenarios } from "./scenario";

export type { Launcher } from "./launch";

export interface Deps {
    launchers: Record<string, Launcher>;
    tty: boolean;
    ask(question: string): Promise<boolean>;
    log(line: string): void;
    scenariosDir: string;
    fixturesDir: string;
    results: string;
}

interface Options {
    scenario?: string;
    harness?: string;
    trials?: number;
    model?: string;
    yes: boolean;
}

function options(args: string[]): Options {
    const value = (flag: string) => {
        const i = args.indexOf(flag);
        return i === -1 ? undefined : args[i + 1];
    };
    const trials = value("--trials");
    return {
        scenario: value("--scenario"),
        harness: value("--harness"),
        trials: trials === undefined ? undefined : Number(trials),
        model: value("--model"),
        yes: args.includes("--yes"),
    };
}

const DEFAULT_MODEL: Record<string, string | undefined> = {
    "claude-code": "sonnet",
    pi: undefined,
};
const INVOCATION = {
    "claude-code": CLAUDE_CODE.invocation("work"),
    pi: PI_HARNESS.invocation("work"),
};
const usd = (n: number) => `$${n.toFixed(2)}`;

async function sha(): Promise<string> {
    const root = new URL("../..", import.meta.url).pathname;
    const head = (await Bun.$`git -C ${root} rev-parse --short HEAD`.quiet().text()).trim();
    const dirty = (await Bun.$`git -C ${root} status --porcelain`.quiet().text()).trim() !== "";
    return dirty ? `${head}-dirty` : head;
}

export async function main(args: string[], deps: Deps): Promise<number> {
    const opts = options(args);
    const scenarios = (await loadScenarios(deps.scenariosDir)).filter(
        (s) => opts.scenario === undefined || s.id === opts.scenario,
    );
    if (scenarios.length === 0) {
        deps.log("No scenario matches.");
        return 2;
    }

    // Everything that can be refused is refused before anything spends.
    const unknown = scenarios.flatMap((s) =>
        s.graders.filter((g) => !(g in GRADERS)).map((g) => `${s.id}: ${g}`),
    );
    if (unknown.length > 0) {
        deps.log(`Unknown graders, nothing run: ${unknown.join(", ")}`);
        return 2;
    }

    const plan = scenarios.map((s) => {
        const harnesses = s.harnesses.filter(
            (h) => opts.harness === undefined || h === opts.harness,
        );
        const trials = opts.trials ?? s.trials;
        return { scenario: s, harnesses, trials, runs: harnesses.length * trials };
    });
    const runs = plan.reduce((n, p) => n + p.runs, 0);
    const worst = plan.reduce((n, p) => n + p.runs * p.scenario.budget.usd, 0);
    for (const p of plan) {
        deps.log(
            `${p.scenario.id}: ${p.harnesses.join(", ")} x ${p.trials} trial(s), ` +
                `up to ${usd(p.scenario.budget.usd)} / ${p.scenario.budget.minutes} min / ${p.scenario.budget.turns} turns each`,
        );
    }
    deps.log(`Worst case: ${runs} run(s), ${usd(worst)}.`);

    if (!opts.yes) {
        if (!deps.tty) {
            deps.log("Nothing spent. Confirm at a terminal, or pass --yes.");
            return 2;
        }
        if (!(await deps.ask(`Spend up to ${usd(worst)}?`))) {
            deps.log("Nothing spent.");
            return 2;
        }
    }

    const shim = await craftpathShim();
    const env = { ...process.env, PATH: `${shim}:${process.env.PATH ?? ""}` } as Record<
        string,
        string
    >;
    const version = { craftpath: pkg.version, sha: await sha() };
    let failed = 0;

    for (const { scenario, harnesses, trials } of plan) {
        const files = await fixtureFiles(deps.fixturesDir, scenario.fixture);
        for (const harness of harnesses) {
            for (let trial = 1; trial <= trials; trial++) {
                const record = await runTrial(
                    scenario,
                    harness,
                    trial,
                    files,
                    env,
                    opts.model,
                    deps,
                );
                await append(deps.results, { ...record, ...version });
                deps.log(
                    `${record.pass ? "PASS" : "FAIL"}  ${scenario.id} ${harness} #${trial}  ${record.failures.join("; ")}`,
                );
                if (!record.pass) failed++;
            }
        }
    }
    return failed === 0 ? 0 : 1;
}

async function runTrial(
    scenario: Scenario,
    harness: "claude-code" | "pi",
    trial: number,
    files: Record<string, string>,
    env: Record<string, string>,
    modelOverride: string | undefined,
    deps: Deps,
) {
    const launcher = deps.launchers[harness]!;
    const model = modelOverride ?? DEFAULT_MODEL[harness];
    const root = await fixture({
        harness: [harness],
        files,
        gates: scenario.gates,
        modules: scenario.modules ?? { app: { path: "./", test: "bun run test" } },
    });
    await launcher.prepare?.(root, env);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), scenario.budget.minutes * 60_000);
    const started = Date.now();
    const output = await launcher.run({
        root,
        prompt: `${INVOCATION[harness]} ${scenario.prompt}`,
        model,
        budget: scenario.budget,
        env,
        signal: controller.signal,
    });
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;

    const failures: string[] = [];
    if (timedOut) failures.push(`budget: stopped after ${scenario.budget.minutes} minutes`);
    if (output.costUsd !== null && output.costUsd > scenario.budget.usd) {
        failures.push(`budget: spent ${usd(output.costUsd)} of ${usd(scenario.budget.usd)}`);
    }
    if (output.turns > scenario.budget.turns)
        failures.push(`budget: ${output.turns} turns of ${scenario.budget.turns}`);

    const graders: ({ name: string } & Verdict)[] = [];
    for (const name of scenario.graders) {
        const verdict = await GRADERS[name]!({
            root,
            scenario,
            harness,
            events: output.events,
            timedOut,
        });
        graders.push({ name, ...verdict });
        if (!verdict.pass) failures.push(`grader: ${name}`);
    }

    return {
        scenario: scenario.id,
        harness,
        model: model ?? "default",
        trial,
        pass: failures.length === 0,
        failures,
        timedOut,
        costUsd: output.costUsd,
        turns: output.turns,
        durationMs: Date.now() - started,
        graders,
        root,
        at: new Date().toISOString(),
    };
}

async function append(path: string, record: unknown): Promise<void> {
    const file = Bun.file(path);
    const before = (await file.exists()) ? await file.text() : "";
    await Bun.write(path, `${before}${JSON.stringify(record)}\n`);
}

if (import.meta.main) {
    const here = new URL(".", import.meta.url).pathname;
    const day = new Date().toISOString().slice(0, 10);
    const code = await main(process.argv.slice(2), {
        launchers: { "claude-code": CLAUDE, pi: PI },
        tty: Boolean(process.stdin.isTTY),
        ask: async (question) => (prompt(`${question} [y/N]`) ?? "").trim().toLowerCase() === "y",
        log: (line) => console.log(line),
        scenariosDir: join(here, "scenarios"),
        fixturesDir: join(here, "fixtures"),
        results: join(here, "results", `${day}.jsonl`),
    });
    process.exit(code);
}
