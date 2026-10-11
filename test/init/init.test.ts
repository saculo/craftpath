/**
 * `craftpath init`: installs craftpath into a project, and is re-run to update.
 *
 * It writes config once (then it is yours), and on every run the scripts,
 * templates, harness commands, skills and the guard wiring -- replacing a file
 * you did not edit, and keeping one you did, with the new version beside it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { init } from "../../src/init";
import { cleanScratch, scratch } from "../scratch";

afterAll(cleanScratch);

const ASSETS = new URL("../../assets", import.meta.url).pathname;

async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
    const lines: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
        return { value: await fn(), out: lines.join("\n") };
    } finally {
        console.log = log;
        console.error = err;
    }
}

/** A git repository on `main` with a Bun project in it. */
async function project(): Promise<string> {
    const root = await scratch("craftpath-init-");
    await Bun.write(join(root, "package.json"), '{"name":"app","scripts":{"test":"bun test"}}\n');
    await Bun.$`git -C ${root} init -q -b main`.quiet();
    await Bun.$`git -C ${root} -c user.email=t@e.c -c user.name=T commit -q --allow-empty -m base`.quiet();
    return root;
}

const read = (root: string, path: string) => Bun.file(join(root, path)).text();
const exists = (root: string, path: string) => Bun.file(join(root, path)).exists();

const STEPS = ["spec", "design", "plan", "review", "pr", "learn", "learn-apply"];

describe("init for Claude Code", () => {
    test("installs each step as a user-only skill that runs in a forked subagent", async () => {
        const root = await project();

        const { value: exit } = await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(exit).toBe(0);
        for (const step of STEPS) {
            const skill = await read(root, `.claude/skills/craftpath-${step}/SKILL.md`);
            expect(skill).toContain(`name: craftpath-${step}`);
            expect(skill).toContain("disable-model-invocation: true");
            expect(skill).toContain("context: fork");
            expect(skill).toContain("background: false");
            // spec runs its script with a short title the agent derives, not the request.
            if (step !== "spec")
                expect(skill).toContain(`python3 .craftpath/scripts/${step}.py "$ARGUMENTS"`);
            expect(skill).not.toContain("{{");
        }
        expect(await exists(root, ".claude/commands")).toBe(false);
    });

    test("installs work in the main session, which starts a subagent per task", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = await read(root, ".claude/skills/craftpath-work/SKILL.md");
        expect(skill).toContain("name: craftpath-work");
        expect(skill).toContain("disable-model-invocation: true");
        expect(skill).not.toContain("context: fork");
        expect(skill).toContain('python3 .craftpath/scripts/work.py "$ARGUMENTS"');
        expect(skill).toContain("python3 .craftpath/scripts/complete.py");
        expect(skill).not.toContain("{{");
    });

    test("writes config, scripts, templates, the engineering skills and the rule", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const config = Bun.TOML.parse(await read(root, ".craftpath/config.toml")) as {
            git: { base_branch: string };
            modules: { app: { path: string; test: string } };
        };
        expect(config.git.base_branch).toBe("main");
        expect(config.modules.app).toEqual({ path: "./", test: "bun run test" });
        for (const path of [
            ".craftpath/scripts/guard.py",
            ".craftpath/scripts/spec.py",
            ".craftpath/templates/SPEC.md",
            ".craftpath/templates/KNOWLEDGE.md",
            ".craftpath/templates/ADR.md",
            ".craftpath/manifest.json",
            ".claude/skills/backend/SKILL.md",
            ".claude/rules/tdd.md",
        ]) {
            expect({ path, exists: await exists(root, path) }).toEqual({ path, exists: true });
        }
        // Planning guidance lives in the plan step now, not in a skill of its own.
        expect(await exists(root, ".claude/skills/planning")).toBe(false);
    });

    test("wires the guard as a PreToolUse hook on Bash and allows shell commands and edits", async () => {
        const root = await project();
        await Bun.write(
            join(root, ".claude/settings.json"),
            JSON.stringify({
                model: "sonnet",
                permissions: { allow: ["Bash(ls:*)"] },
                hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] },
            }),
        );

        await quietly(() => init(root, ["--harness", "claude-code"]));
        await quietly(() => init(root, ["--harness", "claude-code"]));

        const settings = JSON.parse(await read(root, ".claude/settings.json"));
        expect(settings.model).toBe("sonnet");
        expect(settings.hooks.Stop).toHaveLength(1);
        expect(settings.hooks.UserPromptExpansion).toBeUndefined();
        expect(settings.hooks.PreToolUse).toEqual([
            {
                matcher: "Bash",
                hooks: [
                    {
                        type: "command",
                        command: 'python3 "$CLAUDE_PROJECT_DIR/.craftpath/scripts/guard.py"',
                        timeout: 30,
                    },
                ],
            },
        ]);
        // Broad for now, so steps and their subagents are not stopped mid-run.
        expect(settings.permissions.allow).toEqual(["Bash(ls:*)", "Bash", "Edit", "Write"]);
    });

    test("leaves a malformed settings.json untouched and says so", async () => {
        const root = await project();
        await Bun.write(join(root, ".claude/settings.json"), "{ not json");

        const { value: exit, out } = await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(exit).toBe(1);
        expect(out).toContain(".claude/settings.json");
        expect(await read(root, ".claude/settings.json")).toBe("{ not json");
        expect(await exists(root, ".claude/skills/craftpath-spec/SKILL.md")).toBe(true);
    });
});

describe("brainstorm, outside the flow", () => {
    test("is installed on both harnesses as a user-only skill that talks in the session", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const path of [
            ".claude/skills/craftpath-brainstorm/SKILL.md",
            ".pi/skills/craftpath-brainstorm/SKILL.md",
        ]) {
            const skill = await read(root, path);
            expect(skill).toContain("name: craftpath-brainstorm");
            expect(skill).toContain("disable-model-invocation: true");
            expect(skill).not.toContain("context: fork");
            expect(skill).not.toContain("Run this whole step in a fresh subagent");
            expect(skill).not.toContain(".craftpath/scripts/");
            expect(skill).not.toContain("{{");
        }
    });

    test("ends by handing over a request for the spec step, named for its harness", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        expect(await read(root, ".claude/skills/craftpath-brainstorm/SKILL.md")).toContain(
            "/craftpath-spec",
        );
        expect(await read(root, ".pi/skills/craftpath-brainstorm/SKILL.md")).toContain(
            "/skill:craftpath-spec",
        );
    });
});

describe("init on any harness", () => {
    test("git-ignores the work items' worktrees, which live inside the project", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, ".gitignore")).toContain(".craftpath/worktrees/\n");
    });
});

describe("init for pi", () => {
    test("installs each step as a user-only skill that hands itself to a subagent", async () => {
        const root = await project();

        const { value: exit } = await quietly(() => init(root, ["--harness", "pi"]));

        expect(exit).toBe(0);
        for (const step of STEPS) {
            const skill = await read(root, `.pi/skills/craftpath-${step}/SKILL.md`);
            expect(skill).toContain(`name: craftpath-${step}`);
            expect(skill).toContain("disable-model-invocation: true");
            expect(skill).toContain("`Agent` tool");
            expect(skill).toContain("general-purpose");
            if (step !== "spec")
                expect(skill).toContain(
                    `python3 .craftpath/scripts/${step}.py "<the user's request>"`,
                );
            expect(skill).not.toContain("$ARGUMENTS"); // pi appends the request; it substitutes nothing
            expect(skill).not.toContain("context: fork");
            expect(skill).not.toContain("{{");
        }
        expect(await exists(root, ".pi/skills/backend/SKILL.md")).toBe(true);
        expect(await exists(root, ".pi/skills/tdd/SKILL.md")).toBe(true);
        expect(await exists(root, ".pi/prompts")).toBe(false);
        expect(await exists(root, ".claude")).toBe(false);
    });

    test("installs work in the main session, which starts a subagent per task", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "pi"]));

        const skill = await read(root, ".pi/skills/craftpath-work/SKILL.md");
        expect(skill).toContain("name: craftpath-work");
        expect(skill).not.toContain("Run this whole step in a fresh subagent");
        expect(skill).toContain(`python3 .craftpath/scripts/work.py "<the user's request>"`);
        expect(skill).not.toContain("{{");
    });

    test("installs the Claude-compatible hooks extension and the same guard hook as Claude Code", async () => {
        const root = await project();
        await Bun.write(
            join(root, ".pi/settings.json"),
            JSON.stringify({ packages: ["npm:pi-subagents-lite"] }),
        );

        await quietly(() => init(root, ["--harness", "pi"]));
        await quietly(() => init(root, ["--harness", "pi"]));

        expect(await exists(root, ".pi/extensions/claude-hooks.ts")).toBe(true);
        expect(await exists(root, ".pi/extensions/craftpath.ts")).toBe(false);
        const settings = JSON.parse(await read(root, ".pi/settings.json"));
        expect(settings.packages).toEqual(["npm:pi-subagents-lite"]);
        expect(settings.hooks.PreToolUse).toEqual([
            {
                matcher: "Bash",
                hooks: [
                    {
                        type: "command",
                        command: 'python3 "$CLAUDE_PROJECT_DIR/.craftpath/scripts/guard.py"',
                        timeout: 30,
                    },
                ],
            },
        ]);
    });

    test("git-ignores the packages pi installs into the project, once", async () => {
        const root = await project();
        await Bun.write(join(root, ".gitignore"), "node_modules\n");

        await quietly(() => init(root, ["--harness", "pi"]));
        await quietly(() => init(root, ["--harness", "pi"]));

        expect(await read(root, ".gitignore")).toBe(
            "node_modules\n.craftpath/worktrees/\n.pi/npm/\n.pi/git/\n",
        );
    });

    test("leaves a malformed .pi/settings.json untouched and says so", async () => {
        const root = await project();
        await Bun.write(join(root, ".pi/settings.json"), "{ not json");

        const { value: exit, out } = await quietly(() => init(root, ["--harness", "pi"]));

        expect(exit).toBe(1);
        expect(out).toContain(".pi/settings.json");
        expect(await read(root, ".pi/settings.json")).toBe("{ not json");
    });
});

describe("how a step is named, per harness", () => {
    // Claude Code runs a skill as /craftpath-pr, pi as /skill:craftpath-pr.
    const installed = async (harness: string, path: string) => {
        const root = await project();
        await quietly(() => init(root, ["--harness", harness]));
        return read(root, path);
    };

    test("a step file names other steps the way its harness runs them", async () => {
        const claude = await installed("claude-code", ".claude/skills/craftpath-review/SKILL.md");
        const pi = await installed("pi", ".pi/skills/craftpath-review/SKILL.md");

        expect(claude).toContain("`/craftpath-pr <work id>`");
        expect(pi).toContain("`/skill:craftpath-pr <work id>`");
        expect(pi).not.toContain("`/craftpath-pr");
    });

    test("templates and scripts, shared by every harness, name a step for each one installed", async () => {
        const plan = ".craftpath/templates/PLAN.md";
        const checks = ".craftpath/scripts/craftpath.py";

        expect(await installed("claude-code", plan)).toContain("/craftpath-work refuses");
        expect(await installed("pi", plan)).toContain("/skill:craftpath-work refuses");
        expect(await installed("claude-code,pi", plan)).toContain(
            "/craftpath-work or /skill:craftpath-work refuses",
        );
        expect(await installed("pi", checks)).toContain('"/skill:craftpath-{step}"');
    });

    test("C1 nothing installed describes the old workflow", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const old =
            "verified_by|task verify|craftpath (task|approve|amend)|criteria that were approved|approved acceptance criteria";
        const found = (
            await Bun.$`grep -rnE ${old} .claude .pi .craftpath`.cwd(root).quiet().nothrow()
        ).text();
        expect(found).toBe("");
    });

    test("nothing installed keeps a step-name token or the old /craftpath: spelling", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const found = (
            await Bun.$`grep -rlE '[{][{](CMD|COMMANDS)|/craftpath:' .claude .pi .craftpath`
                .cwd(root)
                .quiet()
                .nothrow()
        ).text();
        expect(found).toBe("");
    });
});

describe("re-running init updates", () => {
    test("config.toml is written once and then left alone", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code"]));
        await Bun.write(join(root, ".craftpath/config.toml"), "# mine\n");

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, ".craftpath/config.toml")).toBe("# mine\n");
    });

    test("a file you did not edit takes the new version; one you edited is kept, the new one beside it", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code"]));
        await Bun.write(join(root, ".craftpath/templates/SPEC.md"), "# my own spec template\n");

        // A newer release: every asset changed.
        const release = await scratch("craftpath-assets-");
        await cp(ASSETS, release, { recursive: true });
        for (const path of ["templates/SPEC.md", "scripts/guard.py"]) {
            const file = join(release, path);
            await Bun.write(file, `${await Bun.file(file).text()}\n# release 2\n`);
        }

        const { out } = await quietly(() =>
            init(root, ["--harness", "claude-code"], { assets: release }),
        );

        expect(await read(root, ".craftpath/scripts/guard.py")).toContain("# release 2");
        expect(await read(root, ".craftpath/templates/SPEC.md")).toBe("# my own spec template\n");
        expect(await read(root, ".craftpath/templates/SPEC.md.new")).toContain("# release 2");
        expect(out).toContain(".craftpath/templates/SPEC.md.new");
    });
});

const ALL_STEPS = [...STEPS, "work", "brainstorm"];

/** A project whose config.toml, written before init, ends with `steps`. */
async function configured(steps: string): Promise<string> {
    const root = await project();
    await Bun.write(
        join(root, ".craftpath/config.toml"),
        `[git]\nbase_branch = "main"\n\n[modules.app]\npath = "./"\ntest = "bun run test"\n${steps}`,
    );
    return root;
}

const frontmatter = (skill: string) => skill.split("---\n")[1]!.split("\n");

describe("model and effort per step, on Claude Code", () => {

    test("a configured step runs with its model and effort", async () => {
        const root = await configured(
            '\n[steps.review.claude-code]\nmodel = "opus"\neffort = "high"\n',
        );
        const baseline = await configured("");

        await quietly(() => init(root, ["--harness", "claude-code"]));
        await quietly(() => init(baseline, ["--harness", "claude-code"]));

        const review = frontmatter(await read(root, ".claude/skills/craftpath-review/SKILL.md"));
        expect(review).toContain("model: opus");
        expect(review).toContain("effort: high");
        for (const step of ALL_STEPS.filter((s) => s !== "review")) {
            const path = `.claude/skills/craftpath-${step}/SKILL.md`;
            expect({ path, text: await read(root, path) }).toEqual({
                path,
                text: await read(baseline, path),
            });
        }
    });

    test("only the model is set when only the model is configured", async () => {
        const root = await configured('\n[steps.review.claude-code]\nmodel = "opus"\n');

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const review = frontmatter(await read(root, ".claude/skills/craftpath-review/SKILL.md"));
        expect(review).toContain("model: opus");
        expect(review.filter((l) => l.startsWith("effort:"))).toEqual([]);
    });

    test("a config without step settings installs the steps as before", async () => {
        const root = await configured("");
        await quietly(() => init(root, ["--harness", "claude-code"]));

        const { out } = await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(out).not.toContain(".claude/skills/craftpath-");
        for (const step of ALL_STEPS) {
            const lines = frontmatter(
                await read(root, `.claude/skills/craftpath-${step}/SKILL.md`),
            );
            expect({ step, set: lines.filter((l) => /^(model|effort):/.test(l)) }).toEqual({
                step,
                set: [],
            });
        }
    });

    test("a setting added later takes effect on the next init and leaves config.toml alone", async () => {
        const root = await configured("");
        await quietly(() => init(root, ["--harness", "claude-code"]));
        const config = join(root, ".craftpath/config.toml");
        const mine = `${await Bun.file(config).text()}\n[steps.review.claude-code]\nmodel   =   "opus"  # mine\n`;
        await Bun.write(config, mine);

        const { out } = await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(out).toContain("updated   .claude/skills/craftpath-review/SKILL.md");
        expect(frontmatter(await read(root, ".claude/skills/craftpath-review/SKILL.md"))).toContain(
            "model: opus",
        );
        expect(await Bun.file(config).text()).toBe(mine);
    });

    const WORK = ".claude/skills/craftpath-work/SKILL.md";

    test("work starts its task subagents with work's model and effort", async () => {
        const root = await configured(
            '\n[steps.work.claude-code]\nmodel = "sonnet"\neffort = "medium"\n',
        );

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, WORK)).toContain(
            "with the `Agent` tool (agent `general-purpose`, model `sonnet`, effort `medium`)",
        );
    });

    test("work itself keeps the session's model when work is configured", async () => {
        const root = await configured(
            '\n[steps.work.claude-code]\nmodel = "sonnet"\neffort = "medium"\n',
        );

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const lines = frontmatter(await read(root, WORK));
        expect(lines.filter((l) => /^(model|effort):/.test(l))).toEqual([]);
    });

    test("work passes only the model when only the model is configured", async () => {
        const root = await configured('\n[steps.work.claude-code]\nmodel = "sonnet"\n');

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const work = await read(root, WORK);
        expect(work).toContain("with the `Agent` tool (agent `general-purpose`, model `sonnet`)");
        expect(work).not.toContain("effort");
    });

    test("work without a setting starts its subagents as before", async () => {
        const root = await configured("");

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const line = "with the `Agent` tool (agent `general-purpose`)";
        for (const path of [WORK, ".pi/skills/craftpath-work/SKILL.md"])
            expect({ path, has: (await read(root, path)).includes(line) }).toEqual({
                path,
                has: true,
            });
    });

    test("a Claude Code work setting leaves pi's work step untouched", async () => {
        const root = await configured('\n[steps.work.claude-code]\nmodel = "sonnet"\n');
        const baseline = await configured("");

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));
        await quietly(() => init(baseline, ["--harness", "claude-code,pi"]));

        const path = ".pi/skills/craftpath-work/SKILL.md";
        expect(await read(root, path)).toBe(await read(baseline, path));
    });

    test("a Claude Code step setting leaves every pi step untouched", async () => {
        const root = await configured('\n[steps.review.claude-code]\nmodel = "opus"\n');
        const baseline = await configured("");

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));
        await quietly(() => init(baseline, ["--harness", "claude-code,pi"]));

        expect(frontmatter(await read(root, ".claude/skills/craftpath-review/SKILL.md"))).toContain(
            "model: opus",
        );
        for (const step of ALL_STEPS) {
            const path = `.pi/skills/craftpath-${step}/SKILL.md`;
            expect({ path, text: await read(root, path) }).toEqual({
                path,
                text: await read(baseline, path),
            });
        }
    });

    test("a fresh config shows the step settings commented out", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const config = await read(root, ".craftpath/config.toml");
        const lines = config.split("\n");
        const wanted = [
            "# [steps.work.claude-code]",
            '# model = "sonnet"',
            "# [steps.review.claude-code]",
            '# model = "opus"',
        ];
        const at = wanted.map((line) => lines.indexOf(line));
        expect(at.every((i) => i >= 0)).toBe(true);
        expect(at).toEqual([...at].sort((a, b) => a - b));
        expect(Bun.TOML.parse(config)).not.toHaveProperty("steps");
    });

    test("a fresh config says work's model takes an alias only", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const config = await read(root, ".craftpath/config.toml");
        expect(config).toContain("work's `model` must be an alias");
    });

    test("the commented example applies nothing", async () => {
        const root = await project();
        const baseline = await configured("");

        await quietly(() => init(root, ["--harness", "claude-code"]));
        await quietly(() => init(baseline, ["--harness", "claude-code"]));

        for (const step of ALL_STEPS) {
            const path = `.claude/skills/craftpath-${step}/SKILL.md`;
            expect({ path, text: await read(root, path) }).toEqual({
                path,
                text: await read(baseline, path),
            });
        }
    });

    test("an existing config is not given the example", async () => {
        const root = await configured("");
        const before = await read(root, ".craftpath/config.toml");

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const after = await read(root, ".craftpath/config.toml");
        expect(after).toBe(before);
        expect(after).not.toContain("steps.");
    });
});

describe("model and effort per step, on pi", () => {
    test("a configured pi step runs its subagent with model and thinking level", async () => {
        const root = await configured(
            '\n[steps.review.pi]\nmodel = "anthropic/claude-opus-5-5"\neffort = "high"\n',
        );

        await quietly(() => init(root, ["--harness", "pi"]));

        const review = await read(root, ".pi/skills/craftpath-review/SKILL.md");
        expect(review).toContain(
            "with agent `general-purpose`, model `anthropic/claude-opus-5-5`, thinking level `high`, `run_in_background: false`",
        );
    });

    test("an Anthropic pi model is invoked through the Agent tool only", async () => {
        const root = await configured(
            '\n[steps.review.pi]\nmodel = "anthropic/claude-opus-5-5"\n',
        );

        await quietly(() => init(root, ["--harness", "pi"]));

        const review = await read(root, ".pi/skills/craftpath-review/SKILL.md");
        expect(review).toContain("`Agent` tool");
        expect(review).toContain("model `anthropic/claude-opus-5-5`");
        expect(review).not.toContain("claude -p");
        expect(review).not.toContain("`claude`");
        expect(review).not.toContain("shell CLI");
    });

    test("pi work starts task subagents with work model and thinking level", async () => {
        const root = await configured(
            '\n[steps.work.pi]\nmodel = "openai-codex/gpt-5.6-terra"\neffort = "medium"\n',
        );

        await quietly(() => init(root, ["--harness", "pi"]));

        const work = await read(root, ".pi/skills/craftpath-work/SKILL.md");
        expect(frontmatter(work).filter((l) => /^(model|effort):/.test(l))).toEqual([]);
        expect(work).toContain(
            "with the `Agent` tool (agent `general-purpose`, model `openai-codex/gpt-5.6-terra`, thinking level `medium`)",
        );
    });

    test("a pi step without settings installs as before", async () => {
        const root = await configured("");
        const baseline = await configured("");

        await quietly(() => init(root, ["--harness", "pi"]));
        await quietly(() => init(baseline, ["--harness", "pi"]));

        for (const step of ALL_STEPS) {
            const path = `.pi/skills/craftpath-${step}/SKILL.md`;
            const skill = await read(root, path);
            expect({ path, text: skill }).toEqual({ path, text: await read(baseline, path) });
            expect(skill).not.toContain("thinking level `");
            expect(frontmatter(skill).filter((l) => /^(model|effort):/.test(l))).toEqual([]);
        }
    });

    test("a fresh config shows commented pi model examples", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "pi"]));

        const config = await read(root, ".craftpath/config.toml");
        const lines = config.split("\n");
        const wanted = [
            "# [steps.work.pi]",
            '# model = "openai-codex/gpt-5.6-terra"',
            '# effort = "medium"',
            "# [steps.review.pi]",
            '# model = "anthropic/claude-opus-5-5"',
            '# effort = "high"',
        ];
        const at: number[] = [];
        for (const line of wanted) at.push(lines.indexOf(line, (at.at(-1) ?? -1) + 1));
        expect(at.every((i) => i >= 0)).toBe(true);
        expect(Bun.TOML.parse(config)).not.toHaveProperty("steps");
    });
});
