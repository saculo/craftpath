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
        expect(config.modules.app).toMatchObject({ path: "./", test: "bun run test" });
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
            expect(skill).toContain(`python3 .craftpath/scripts/${step}.py "<the user's request>"`);
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
