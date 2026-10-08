/**
 * The real-model runner (T653), tested with a scripted launcher in place of
 * claude and pi -- so its own tests spend nothing.
 *
 * Its job is guard rails: nothing spends until the worst case is shown and
 * confirmed, every run is capped, and every trial leaves one record.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch, scratch } from "../../test/scratch";
import { type Deps, type Launcher, main } from "./run";

afterAll(cleanScratch);

const SCENARIO = `id: S1-tiny
fixture: tiny
harnesses: [claude-code, pi]
trials: 2
budget: { turns: 80, usd: 1, minutes: 20 }
gates: { requirement: auto, plan: auto, result: auto }
prompt: "Add a sum function with a test."
graders: [no_timeout]
`;

/** A scenarios dir with one scenario, a fixture, and a results file path. */
async function setup(scenario = SCENARIO) {
    const dir = await scratch("craftpath-llm-");
    await Bun.write(join(dir, "scenarios/S1-tiny/scenario.yaml"), scenario);
    await Bun.write(
        join(dir, "fixtures/tiny/package.json"),
        '{"name":"tiny","scripts":{"test":"true"}}\n',
    );
    return { dir, results: join(dir, "results.jsonl") };
}

type Script = Partial<{
    exit: number;
    costUsd: number;
    turns: number;
    hang: boolean;
    /** Called with the fixture root when the run starts. */
    seen: (root: string, env: Record<string, string>) => Promise<void>;
}>;

/** A launcher that plays back `script` and counts its runs. */
function scripted(harness: "claude-code" | "pi", script: Script = {}) {
    const calls: string[] = [];
    const launcher: Launcher = {
        harness,
        async run({ root, signal, env }) {
            calls.push(root);
            await script.seen?.(root, env);
            if (script.hang)
                await new Promise((resolve) => signal.addEventListener("abort", resolve));
            return {
                exit: script.exit ?? 0,
                events: [],
                costUsd: script.costUsd ?? 0.1,
                turns: script.turns ?? 3,
            };
        },
    };
    return { launcher, calls };
}

async function runner(
    args: string[],
    options: { tty?: boolean; answer?: boolean; script?: Script; scenario?: string } = {},
) {
    const { dir, results } = await setup(options.scenario);
    const claude = scripted("claude-code", options.script);
    const pi = scripted("pi", options.script);
    const out: string[] = [];
    const deps: Deps = {
        launchers: { "claude-code": claude.launcher, pi: pi.launcher },
        tty: options.tty ?? false,
        ask: async () => options.answer ?? false,
        log: (line) => void out.push(line),
        scenariosDir: join(dir, "scenarios"),
        fixturesDir: join(dir, "fixtures"),
        results,
    };
    const exit = await main(args, deps);
    const file = Bun.file(results);
    const records = (await file.exists())
        ? (await file.text())
              .trim()
              .split("\n")
              .map((l) => JSON.parse(l))
        : [];
    return { exit, out: out.join("\n"), runs: claude.calls.length + pi.calls.length, records };
}

describe("nothing spends until the worst case is confirmed", () => {
    test("without a terminal and without --yes, it prints the worst case and spends nothing", async () => {
        const { exit, out, runs, records } = await runner([]);

        expect(exit).not.toBe(0);
        expect(out).toContain("$4.00"); // 1 scenario x 2 harnesses x 2 trials x $1
        expect(runs).toBe(0);
        expect(records).toEqual([]);
    });

    test("at a terminal it asks, and a no spends nothing", async () => {
        const { exit, runs } = await runner([], { tty: true, answer: false });

        expect(exit).not.toBe(0);
        expect(runs).toBe(0);
    });

    test("--yes runs every trial on every harness", async () => {
        const { exit, runs } = await runner(["--yes"]);

        expect(exit).toBe(0);
        expect(runs).toBe(4);
    });

    test("--harness and --trials select a cheaper slice, and the estimate follows", async () => {
        const { out, runs } = await runner(["--yes", "--harness", "pi", "--trials", "1"]);

        expect(out).toContain("$1.00");
        expect(runs).toBe(1);
    });

    test("an unknown grader is refused before anything runs", async () => {
        const { exit, out, runs } = await runner(["--yes"], {
            scenario: SCENARIO.replace("[no_timeout]", "[no_timeout, mind_reading]"),
        });

        expect(exit).not.toBe(0);
        expect(out).toContain("mind_reading");
        expect(runs).toBe(0);
    });
});

describe("every run is capped, and hitting a cap is a failure", () => {
    test("a run over its dollar budget is recorded as failed", async () => {
        const { records } = await runner(["--yes", "--harness", "claude-code", "--trials", "1"], {
            script: { costUsd: 5 },
        });

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ pass: false });
        expect(records[0].failures).toContain("budget: spent $5.00 of $1.00");
    });

    test("a run over its turn budget is recorded as failed", async () => {
        const { records } = await runner(["--yes", "--harness", "claude-code", "--trials", "1"], {
            script: { turns: 81 },
        });

        expect(records[0].failures).toContain("budget: 81 turns of 80");
    });

    test("a run past its minute budget is stopped and recorded as failed", async () => {
        const { records } = await runner(["--yes", "--harness", "claude-code", "--trials", "1"], {
            script: { hang: true },
            scenario: SCENARIO.replace("minutes: 20", "minutes: 0.001"),
        });

        expect(records[0]).toMatchObject({ pass: false, timedOut: true });
        expect(records[0].graders).toEqual([{ name: "no_timeout", pass: false }]);
    });
});

describe("every trial leaves one record", () => {
    test("keyed by scenario, harness, model, craftpath version and sha, with graders and cost", async () => {
        const { records } = await runner(["--yes", "--model", "cheap-model"]);

        expect(records).toHaveLength(4);
        for (const record of records) {
            expect(record).toMatchObject({
                scenario: "S1-tiny",
                model: "cheap-model",
                pass: true,
                costUsd: 0.1,
                turns: 3,
                graders: [{ name: "no_timeout", pass: true }],
            });
            expect(["claude-code", "pi"]).toContain(record.harness);
            expect(record.craftpath).toMatch(/^\d+\.\d+\.\d+$/);
            expect(record.sha).toMatch(/^[0-9a-f]{7,40}(-dirty)?$/);
            expect(typeof record.trial).toBe("number");
        }
    });
});

describe("an empty selection", () => {
    test("with no scenarios directory it says so and spends nothing", async () => {
        const dir = await scratch("craftpath-llm-");
        const out: string[] = [];
        const exit = await main(["--yes"], {
            launchers: {},
            tty: false,
            ask: async () => false,
            log: (line) => void out.push(line),
            scenariosDir: join(dir, "missing"),
            fixturesDir: join(dir, "fixtures"),
            results: join(dir, "results.jsonl"),
        });

        expect(exit).toBe(2);
        expect(out.join("\n")).toContain("No scenario matches");
        expect(await Bun.file(join(dir, "results.jsonl")).exists()).toBe(false);
    });
});

describe("a scenario can start mid-flow", () => {
    test("its setup steps run in the fixture, with this checkout's craftpath, before the agent starts", async () => {
        let seen = "";
        const { exit } = await runner(["--yes", "--harness", "claude-code", "--trials", "1"], {
            scenario: SCENARIO.replace(
                "graders: [no_timeout]",
                'graders: [no_timeout]\nsetup:\n  - craftpath work new "Sum"\n  - echo started > marker.txt',
            ),
            script: {
                seen: async (root, env) => {
                    // sh -c: Bun.$ resolves a command with this process's PATH, not env's.
                    seen = (
                        await Bun.$`sh -c ${"craftpath status --brief"}`
                            .cwd(root)
                            .env(env)
                            .nothrow()
                            .quiet()
                            .text()
                    ).trim();
                    seen += ` | ${(await Bun.file(join(root, "marker.txt")).text()).trim()}`;
                },
            },
        });

        expect(exit).toBe(0);
        expect(seen).toContain("W-0001-sum");
        expect(seen).toContain("started");
    });

    test("a failing setup step stops the trial before the agent runs, recorded as a setup failure", async () => {
        const { runs, records } = await runner(
            ["--yes", "--harness", "claude-code", "--trials", "1"],
            {
                scenario: SCENARIO.replace(
                    "graders: [no_timeout]",
                    "graders: [no_timeout]\nsetup:\n  - exit 7",
                ),
            },
        );

        expect(runs).toBe(0);
        expect(records[0]).toMatchObject({ pass: false });
        expect(records[0].failures[0]).toContain("setup: exit 7");
    });
});
