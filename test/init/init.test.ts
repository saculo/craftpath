/**
 * `craftpath init`: installs craftpath into a project, and is re-run to update.
 *
 * It writes config once (then it is yours), and on every run the scripts,
 * templates, harness commands, skills and the guard wiring -- replacing a file
 * you did not edit, and keeping one you did, with the new version beside it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { init } from "../../src/init";
import { cleanScratch, scratch } from "../scratch";
import { barePath, SEARCH_TOOLS } from "../search-tools";
import { planned } from "../steps/kit";

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
/** A directory, which `Bun.file().exists()` does not report. */
const dirExists = (root: string, path: string) =>
    stat(join(root, path)).then(
        () => true,
        () => false,
    );

const STEPS = ["spec", "design", "plan", "pr", "learn", "learn-apply"];

test("installs the behaviour-testing principle on both harnesses", async () => {
    const root = await project();

    await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    for (const path of [
        ".claude/skills/test-behaviour-not-implementation/SKILL.md",
        ".pi/skills/test-behaviour-not-implementation/SKILL.md",
    ]) {
        const skill = await read(root, path);
        expect(skill).toContain("real owned boundaries");
        expect(skill).toContain("Mock only systems the project does not own");
        expect(skill).toContain("one observable behaviour claim per test");
        expect(skill).toContain("name the test after that behaviour");
        expect(skill).toContain("independent of test order");
        expect(skill).not.toContain("{{");
    }
});

test("spec instructions load the behaviour-testing principle", async () => {
    const root = await project();

    await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    for (const path of [
        ".claude/skills/craftpath-spec/SKILL.md",
        ".pi/skills/craftpath-spec/SKILL.md",
    ]) {
        const skill = await read(root, path);
        expect(skill).toContain(
            "Load the `test-behaviour-not-implementation` skill before writing scenarios",
        );
        expect(skill).toContain(
            "Scenarios must describe observable behaviour, not implementation details",
        );
    }
});

test("work instructions load the behaviour-testing and test-first principles", async () => {
    const root = await project();

    await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    for (const path of [
        ".claude/skills/craftpath-work/SKILL.md",
        ".pi/skills/craftpath-work/SKILL.md",
    ]) {
        const skill = await read(root, path);
        expect(skill).toContain(
            "load the `test-first` skill and the `test-behaviour-not-implementation` skill",
        );
        expect(skill).toContain("Follow the `test-first` skill");
    }
});

test("verify's finder loads the behaviour-testing principle", async () => {
    const root = await project();

    await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    for (const path of [
        ".claude/skills/craftpath-verify/SKILL.md",
        ".pi/skills/craftpath-verify/SKILL.md",
    ]) {
        const finder = (await read(root, path)).split("## The finder's brief")[1] ?? "";
        expect(finder).toContain("the `test-behaviour-not-implementation` skill");
        expect(finder).toContain("every acceptance");
    }
});

test("reinitializing retires the managed testing skill", async () => {
    const earlier = await scratch("craftpath-assets-");
    await cp(ASSETS, earlier, { recursive: true });
    await mkdir(join(earlier, "skills/testing"), { recursive: true });
    await Bun.write(join(earlier, "skills/testing/SKILL.md"), "# retired testing skill\n");
    const root = await project();

    await quietly(() => init(root, ["--harness", "claude-code,pi"], { assets: earlier }));
    await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    for (const harness of [".claude", ".pi"]) {
        expect(await exists(root, `${harness}/skills/testing/SKILL.md`)).toBe(false);
        expect(await read(root, `${harness}/skills/craftpath-plan/SKILL.md`)).not.toContain(
            "testing",
        );
    }

    const edited = await project();
    await quietly(() => init(edited, ["--harness", "claude-code,pi"], { assets: earlier }));
    await Bun.write(join(edited, ".claude/skills/testing/SKILL.md"), "# my edited skill\n");
    await quietly(() => init(edited, ["--harness", "claude-code,pi"]));
    expect(await read(edited, ".claude/skills/testing/SKILL.md")).toBe("# my edited skill\n");
});

const DISCIPLINES = ["backend", "frontend", "infrastructure"];
const DISCIPLINE_SKILLS = [".claude", ".pi"].flatMap((dir) =>
    DISCIPLINES.map((name) => `${dir}/skills/${name}/SKILL.md`),
);

/** An asset set from before C-00010: the current one plus the three discipline skills. */
async function earlierAssetsWithDisciplines(): Promise<string> {
    const earlier = await scratch("craftpath-assets-");
    await cp(ASSETS, earlier, { recursive: true });
    for (const name of DISCIPLINES) {
        await mkdir(join(earlier, `skills/${name}`), { recursive: true });
        await Bun.write(join(earlier, `skills/${name}/SKILL.md`), `# retired ${name} skill\n`);
    }
    return earlier;
}

test("a fresh install ships no discipline skills but keeps ux and architecture", async () => {
    const root = await project();

    await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    for (const dir of [".claude", ".pi"]) {
        for (const name of DISCIPLINES)
            expect({
                dir,
                name,
                dir_exists: await dirExists(root, `${dir}/skills/${name}`),
            }).toEqual({ dir, name, dir_exists: false });
        for (const name of ["ux", "architecture"])
            expect({
                dir,
                name,
                exists: await exists(root, `${dir}/skills/${name}/SKILL.md`),
            }).toEqual({ dir, name, exists: true });
    }
});

test("re-running init retires the unedited discipline skills", async () => {
    const earlier = await earlierAssetsWithDisciplines();
    const root = await project();
    await quietly(() => init(root, ["--harness", "claude-code,pi"], { assets: earlier }));

    const { out } = await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    const manifest = (await Bun.file(join(root, ".craftpath/manifest.json")).json()) as {
        files: Record<string, string>;
    };
    const lines = out.split("\n");
    for (const path of DISCIPLINE_SKILLS) {
        expect({ path, exists: await exists(root, path) }).toEqual({ path, exists: false });
        expect({ path, reported: lines.includes(`removed   ${path}`) }).toEqual({
            path,
            reported: true,
        });
        expect({ path, listed: path in manifest.files }).toEqual({ path, listed: false });
    }
});

test("retiring the discipline skills removes nothing else", async () => {
    const earlier = await earlierAssetsWithDisciplines();
    const root = await project();
    await quietly(() => init(root, ["--harness", "claude-code,pi"], { assets: earlier }));

    const { out } = await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    const removed = out
        .split("\n")
        .filter((line) => line.startsWith("removed   "))
        .map((line) => line.slice("removed   ".length));
    expect(removed.filter((path) => !DISCIPLINE_SKILLS.includes(path))).toEqual([]);
    const shipped = new Set<string>();
    for await (const path of new Bun.Glob("skills/*/SKILL.md").scan({ cwd: ASSETS }))
        shipped.add(path.split("/")[1]!);
    for (const dir of [".claude", ".pi"])
        for (const name of shipped)
            expect({
                dir,
                name,
                exists: await exists(root, `${dir}/skills/${name}/SKILL.md`),
            }).toEqual({ dir, name, exists: true });
});

test("re-running init keeps an edited discipline skill", async () => {
    const earlier = await earlierAssetsWithDisciplines();
    const root = await project();
    await quietly(() => init(root, ["--harness", "claude-code,pi"], { assets: earlier }));
    await Bun.write(join(root, ".claude/skills/backend/SKILL.md"), "# my backend notes\n");

    const { out } = await quietly(() => init(root, ["--harness", "claude-code,pi"]));

    expect(await read(root, ".claude/skills/backend/SKILL.md")).toBe("# my backend notes\n");
    expect(out).toContain("kept      .claude/skills/backend/SKILL.md (edited)");
    for (const path of DISCIPLINE_SKILLS.filter((p) => p !== ".claude/skills/backend/SKILL.md"))
        expect({ path, exists: await exists(root, path) }).toEqual({ path, exists: false });
});

test("re-running init leaves a user's own skill under a retired name alone, unreported", async () => {
    const root = await project();
    await quietly(() => init(root, ["--harness", "claude-code"]));
    await Bun.write(join(root, ".claude/skills/frontend/SKILL.md"), "# my own frontend skill\n");

    const { out } = await quietly(() => init(root, ["--harness", "claude-code"]));

    expect(await read(root, ".claude/skills/frontend/SKILL.md")).toBe("# my own frontend skill\n");
    expect(out).not.toContain("skills/frontend/SKILL.md");
});

/** The files an earlier release shipped for the review and review-fix steps, which this one retires. */
const REVIEW_ASSETS = [
    "steps/review.md",
    "scripts/review.py",
    "scripts/guards/review.py",
    "templates/REVIEW.md",
    "steps/review-fix.md",
    "scripts/review-fix.py",
    "scripts/guards/review-fix.py",
];
const REVIEW_STEPS = [".claude", ".pi"].flatMap((dir) => [
    `${dir}/skills/craftpath-review/SKILL.md`,
    `${dir}/skills/craftpath-review-fix/SKILL.md`,
]);
const REVIEW_SHARED = [
    ".craftpath/scripts/review.py",
    ".craftpath/scripts/guards/review.py",
    ".craftpath/templates/REVIEW.md",
    ".craftpath/scripts/review-fix.py",
    ".craftpath/scripts/guards/review-fix.py",
];

/** An asset set from before C-00015: the current one with the review steps' files instead of verify's. */
async function earlierAssetsWithReview(): Promise<string> {
    const earlier = await scratch("craftpath-assets-");
    await cp(ASSETS, earlier, { recursive: true });
    await rm(join(earlier, "steps/verify.md"));
    await rm(join(earlier, "steps/verify-fix.md"));
    for (const path of REVIEW_ASSETS)
        await Bun.write(join(earlier, path), `# the retired review step's ${path}\n`);
    return earlier;
}

/** A project with both harnesses installed by a release that shipped the review step. */
async function installedWithReview(): Promise<string> {
    const root = await project();
    const earlier = await earlierAssetsWithReview();
    await quietly(() => init(root, ["--harness", "claude-code,pi"], { assets: earlier }));
    for (const path of [...REVIEW_STEPS, ...REVIEW_SHARED])
        expect({ path, installed: await exists(root, path) }).toEqual({ path, installed: true });
    return root;
}

describe("S1 verify replaces review", () => {
    test("S1 re-running init replaces the review step with verify on both harnesses", async () => {
        const root = await installedWithReview();

        const { out } = await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const lines = out.split("\n");
        for (const dir of [".claude", ".pi"])
            expect(await exists(root, `${dir}/skills/craftpath-verify/SKILL.md`)).toBe(true);
        for (const path of REVIEW_STEPS) {
            expect({ path, exists: await exists(root, path) }).toEqual({ path, exists: false });
            expect({ path, reported: lines.includes(`removed   ${path}`) }).toEqual({
                path,
                reported: true,
            });
        }
    });

    test("S1 re-running init removes review's and review-fix's scripts, guards and template", async () => {
        const root = await installedWithReview();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const manifest = (await Bun.file(join(root, ".craftpath/manifest.json")).json()) as {
            files: Record<string, string>;
        };
        for (const path of REVIEW_SHARED) {
            expect({ path, exists: await exists(root, path) }).toEqual({ path, exists: false });
            expect({ path, listed: path in manifest.files }).toEqual({ path, listed: false });
        }
    });

    test("S1 init on one harness updates every installed harness to verify", async () => {
        const root = await installedWithReview();

        const { out } = await quietly(() => init(root, ["--harness", "claude-code"]));

        for (const dir of [".claude", ".pi"])
            expect(await exists(root, `${dir}/skills/craftpath-verify/SKILL.md`)).toBe(true);
        for (const path of [...REVIEW_STEPS, ...REVIEW_SHARED]) {
            expect({ path, exists: await exists(root, path) }).toEqual({ path, exists: false });
            expect({ path, reported: out.split("\n").includes(`removed   ${path}`) }).toEqual({
                path,
                reported: true,
            });
        }
    });

    test("S1 init on one harness leaves a harness the user removed removed", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code,pi"]));
        await rm(join(root, ".pi"), { recursive: true });

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await exists(root, ".pi/skills/craftpath-work/SKILL.md")).toBe(false);
    });

    test("S1 re-running init keeps an edited review step", async () => {
        const root = await installedWithReview();
        const edited = ".claude/skills/craftpath-review/SKILL.md";
        await Bun.write(join(root, edited), "# my own review notes\n");

        const { out } = await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        expect(await read(root, edited)).toBe("# my own review notes\n");
        expect(out.split("\n")).toContain(`kept      ${edited} (edited)`);
    });

    test("S1 no installed step, script or template names the review step", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const found = (
            await Bun.$`grep -rlE '/(skill:)?craftpath-review' .claude .pi .craftpath/scripts .craftpath/templates`
                .cwd(root)
                .quiet()
                .nothrow()
        ).text();
        expect(found).toBe("");
    });

    test("S1 the fresh config.toml shows verify's settings", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const lines = (await read(root, ".craftpath/config.toml")).split("\n");
        expect(lines).toContain("# [steps.verify.claude-code]");
        expect(lines).toContain("# [steps.verify.pi]");
        expect(lines.filter((line) => line.includes("steps.review"))).toEqual([]);
    });
});

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

    test("writes config, scripts, templates and the engineering skills", async () => {
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
            ".claude/skills/test-first/SKILL.md",
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

test("the spec step separates assumptions from product questions", async () => {
    const root = await project();
    await quietly(() => init(root, ["--harness", "claude-code"]));

    const skill = await read(root, ".claude/skills/craftpath-spec/SKILL.md");
    const [creation, revision] = skill.split("## Revising a spec");

    expect(creation).toMatch(
        /\*\*Assumptions:\*\*[\s\S]*?decision supported by the request and concerned code\s+that does not change scope, intent, or user-visible behavior\.[\s\S]*?decision and its reason under `## Assumptions`; do not ask the user to\s+decide it/,
    );
    expect(creation).toMatch(
        /\*\*Open questions:\*\*[\s\S]*?only an uncertainty that would change scope, intent,\s+or user-visible behavior\. Put it under `## Open questions`; do not\s+invent answers -- the user resolves these/,
    );
    expect(revision).toMatch(
        /decide from the request and concerned code without changing scope,\s+intent, or user-visible behavior, record the decision and its reason under\s+`## Assumptions` instead of asking the user\. Put only an uncertainty that\s+would change one of those product concerns under `## Open questions` for\s+the user/,
    );
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
        expect(await exists(root, ".pi/skills/test-first/SKILL.md")).toBe(true);
        expect(await dirExists(root, ".pi/skills/tdd")).toBe(false);
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
        const claude = await installed("claude-code", ".claude/skills/craftpath-verify/SKILL.md");
        const pi = await installed("pi", ".pi/skills/craftpath-verify/SKILL.md");

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

describe("module check detection", () => {
    test("fresh init combines JavaScript lint and typecheck scripts into a module check", async () => {
        const root = await project();
        await Bun.write(
            join(root, "package.json"),
            '{"name":"app","scripts":{"test":"bun test","lint":"biome check .","typecheck":"tsc --noEmit"}}\n',
        );

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const config = Bun.TOML.parse(await read(root, ".craftpath/config.toml")) as {
            modules: { app: { path: string; test: string; check?: string } };
        };
        expect(config.modules.app).toEqual({
            path: "./",
            test: "bun run test",
            check: "bun run lint && bun run typecheck",
        });
    });

    test("fresh init prefers a JavaScript check script", async () => {
        const root = await project();
        await Bun.write(
            join(root, "package.json"),
            '{"name":"app","scripts":{"test":"bun test","check":"bun run all","lint":"biome check .","typecheck":"tsc --noEmit"}}\n',
        );

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const config = Bun.TOML.parse(await read(root, ".craftpath/config.toml")) as {
            modules: { app: { path: string; test: string; check?: string } };
        };
        expect(config.modules.app).toEqual({
            path: "./",
            test: "bun run test",
            check: "bun run check",
        });
    });

    test("fresh init omits an undetected module check", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const config = Bun.TOML.parse(await read(root, ".craftpath/config.toml")) as {
            modules: { app: { path: string; test: string; check?: string } };
        };
        expect(config.modules.app).toEqual({ path: "./", test: "bun run test" });
    });

    test("init never replaces an existing module check configuration", async () => {
        const root = await project();
        await Bun.write(
            join(root, "package.json"),
            '{"name":"app","scripts":{"test":"bun test","lint":"biome check .","typecheck":"tsc --noEmit"}}\n',
        );
        const configuration = [
            "[git]",
            'base_branch = "main"',
            "",
            "[modules.app]",
            'path = "./"',
            'test = "bun run test"',
            'check = "custom-check"',
            "",
        ].join("\n");
        await Bun.write(join(root, ".craftpath/config.toml"), configuration);

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, ".craftpath/config.toml")).toBe(configuration);
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

    test("re-running init brings the decisions record without overwriting your edits", async () => {
        // An earlier release: work gathers no decisions and verify commits none.
        const earlier = await scratch("craftpath-assets-");
        await cp(ASSETS, earlier, { recursive: true });
        for (const path of ["steps/work.md", "scripts/verify.py"]) {
            const file = join(earlier, path);
            const text = (await Bun.file(file).text())
                .split("\n")
                .filter((line) => !line.includes("DECISIONS"))
                .join("\n");
            expect(text).not.toContain("DECISIONS");
            await Bun.write(file, text);
        }
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code"], { assets: earlier }));
        await Bun.write(join(root, ".craftpath/templates/SPEC.md"), "# my own spec template\n");

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, ".claude/skills/craftpath-work/SKILL.md")).toContain(
            "DECISIONS.md",
        );
        expect(await read(root, ".craftpath/scripts/verify.py")).toContain("DECISIONS.md");
        expect(await read(root, ".craftpath/templates/SPEC.md")).toBe("# my own spec template\n");
    });
});

const ALL_STEPS = [...STEPS, "work", "verify", "brainstorm"];

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
            '\n[steps.plan.claude-code]\nmodel = "opus"\neffort = "high"\n',
        );
        const baseline = await configured("");

        await quietly(() => init(root, ["--harness", "claude-code"]));
        await quietly(() => init(baseline, ["--harness", "claude-code"]));

        const plan = frontmatter(await read(root, ".claude/skills/craftpath-plan/SKILL.md"));
        expect(plan).toContain("model: opus");
        expect(plan).toContain("effort: high");
        for (const step of ALL_STEPS.filter((s) => s !== "plan")) {
            const path = `.claude/skills/craftpath-${step}/SKILL.md`;
            expect({ path, text: await read(root, path) }).toEqual({
                path,
                text: await read(baseline, path),
            });
        }
    });

    test("only the model is set when only the model is configured", async () => {
        const root = await configured('\n[steps.plan.claude-code]\nmodel = "opus"\n');

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const plan = frontmatter(await read(root, ".claude/skills/craftpath-plan/SKILL.md"));
        expect(plan).toContain("model: opus");
        expect(plan.filter((l) => l.startsWith("effort:"))).toEqual([]);
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
        const mine = `${await Bun.file(config).text()}\n[steps.plan.claude-code]\nmodel   =   "opus"  # mine\n`;
        await Bun.write(config, mine);

        const { out } = await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(out).toContain("updated   .claude/skills/craftpath-plan/SKILL.md");
        expect(frontmatter(await read(root, ".claude/skills/craftpath-plan/SKILL.md"))).toContain(
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
        const root = await configured('\n[steps.plan.claude-code]\nmodel = "opus"\n');
        const baseline = await configured("");

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));
        await quietly(() => init(baseline, ["--harness", "claude-code,pi"]));

        expect(frontmatter(await read(root, ".claude/skills/craftpath-plan/SKILL.md"))).toContain(
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
            "# [steps.verify.claude-code]",
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

describe("the never-block-on-the-human principle", () => {
    const PRINCIPLE = "never-block-on-the-human";
    const frontMatter = (text: string, key: string) =>
        text.match(new RegExp(`^${key}:(.*)$`, "m"))?.[1]?.trim();

    test("installs the never-block-on-the-human principle on Claude Code", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = await read(root, `.claude/skills/${PRINCIPLE}/SKILL.md`);
        expect(skill).toContain(`name: ${PRINCIPLE}`);
        expect(frontMatter(skill, "description")).toBeTruthy();
        expect(skill).not.toContain("{{");
    });

    test("the principle is a skill the model loads, not a step the user runs", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = await read(root, `.claude/skills/${PRINCIPLE}/SKILL.md`);
        expect(skill).not.toContain("disable-model-invocation: true");
        expect(skill).not.toContain("context: fork");
        expect(await exists(root, `.claude/skills/craftpath-${PRINCIPLE}`)).toBe(false);
        expect(await exists(root, ".claude/commands")).toBe(false);
    });

    test("installs the same principle on pi", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const claude = await read(root, `.claude/skills/${PRINCIPLE}/SKILL.md`);
        const pi = await read(root, `.pi/skills/${PRINCIPLE}/SKILL.md`);
        expect(pi).not.toContain("{{");
        expect(frontMatter(pi, "name")).toBe(PRINCIPLE);
        expect(frontMatter(pi, "name")).toBe(frontMatter(claude, "name"));
        expect(frontMatter(pi, "description")).toBeTruthy();
        expect(frontMatter(pi, "description")).toBe(frontMatter(claude, "description"));
    });

    test("every installed skill's front matter is valid YAML", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const invalid: string[] = [];
        for await (const path of new Bun.Glob("{.claude,.pi}/skills/*/SKILL.md").scan({
            cwd: root,
            dot: true,
        })) {
            const yaml = (await read(root, path)).match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
            try {
                Bun.YAML.parse(yaml);
            } catch {
                invalid.push(path);
            }
        }
        expect(invalid).toEqual([]);
    });

    test("every skill an installed skill points to is installed", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        // A skill is named in backticks, followed by "skill", "covers", a dash
        // or a slash, as in "the `test-first` skill" or "- `backend` / ...".
        const named = /`([a-z]+(?:-[a-z]+)*)`(?= (?:skill|covers|—|\/ `))/g;
        const dangling: string[] = [];
        for await (const path of new Bun.Glob("{.claude,.pi}/skills/*/SKILL.md").scan({
            cwd: root,
            dot: true,
        })) {
            const skills = path.split("/").slice(0, 2).join("/");
            for (const [, name] of (await read(root, path)).matchAll(named)) {
                if (!(await Bun.file(join(root, skills, name as string, "SKILL.md")).exists())) {
                    dangling.push(`${path}: ${name}`);
                }
            }
        }
        expect(dangling).toEqual([]);
    });

    test("the principle says when to stop and when to decide", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = await read(root, `.claude/skills/${PRINCIPLE}/SKILL.md`);
        for (const term of ["scope", "intent", "user-visible behaviour", "*how*", "reason"])
            expect(skill).toContain(term);
    });

    test("the principle does not say where a step writes its decisions", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = await read(root, `.claude/skills/${PRINCIPLE}/SKILL.md`);
        for (const term of [
            "SPEC.md",
            "PLAN.md",
            "DESIGN.md",
            "REVIEW.md",
            "Notes",
            "Open questions",
        ])
            expect(skill).not.toContain(term);
    });

    // A step's text wraps, and the work brief is a blockquote: compare words, not lines.
    const words = (text: string) => text.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim();
    const HARNESSES = { "claude-code": ".claude", pi: ".pi" };
    const LOADS = `Load the \`${PRINCIPLE}\` skill`;

    test("spec, plan and verify load the principle before their work", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of Object.values(HARNESSES))
            for (const step of ["spec", "plan", "verify"]) {
                const skill = await read(root, `${dir}/skills/craftpath-${step}/SKILL.md`);
                const firstInstruction = skill.search(/^1\. /m);
                expect(firstInstruction).toBeGreaterThan(0);
                expect(words(skill.slice(0, firstInstruction))).toContain(LOADS);
            }
    });

    test("work's brief tells each task's subagent to load the principle", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of Object.values(HARNESSES)) {
            const skill = await read(root, `${dir}/skills/craftpath-work/SKILL.md`);
            const brief = skill.split("## The brief for each task's subagent")[1] ?? "";
            const paragraphs = brief.split(/\n>?[ \t]*\n/).map(words);
            const loading = paragraphs.filter((p) =>
                new RegExp(`[Ll]oad the \`${PRINCIPLE}\` skill`).test(p),
            );
            expect(loading.length).toBeGreaterThan(0);
        }
    });

    test("steps outside the four do not load the principle", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of Object.values(HARNESSES))
            for (const step of ["brainstorm", "design", "pr", "learn", "learn-apply"]) {
                const skill = await read(root, `${dir}/skills/craftpath-${step}/SKILL.md`);
                expect(skill).not.toContain(PRINCIPLE);
            }
    });

    test("every principle a step loads ships as a skill", async () => {
        const named = new Set<string>();
        for (const step of new Bun.Glob("*.md").scanSync(join(ASSETS, "steps"))) {
            const text = words(await Bun.file(join(ASSETS, "steps", step)).text());
            for (const m of text.matchAll(/[Ll]oad the `([^`]+)` skill/g)) named.add(m[1]!);
        }

        expect([...named]).toContain(PRINCIPLE);
        for (const name of named)
            expect(await Bun.file(join(ASSETS, "skills", name, "SKILL.md")).exists()).toBe(true);
    });

    test("re-running init adds the principle without overwriting your edits", async () => {
        // An earlier release: no principle skill, and no step that loads it.
        const earlier = await scratch("craftpath-assets-");
        await cp(ASSETS, earlier, { recursive: true });
        await Bun.$`rm -r ${join(earlier, "skills", PRINCIPLE)}`.quiet();
        for (const step of ["spec", "plan", "verify", "work"]) {
            const file = join(earlier, "steps", `${step}.md`);
            const text = (await Bun.file(file).text()).replace(
                new RegExp(`[Ll]oad the\\s+(>\\s*)?\`${PRINCIPLE}\`[^.]*\\.\\s*`, "g"),
                "",
            );
            expect(text).not.toContain(PRINCIPLE);
            await Bun.write(file, text);
        }
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code"], { assets: earlier }));
        expect(await exists(root, `.claude/skills/${PRINCIPLE}/SKILL.md`)).toBe(false);
        await Bun.write(join(root, ".craftpath/templates/SPEC.md"), "# my own spec template\n");

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await exists(root, `.claude/skills/${PRINCIPLE}/SKILL.md`)).toBe(true);
        for (const step of ["spec", "plan", "verify", "work"])
            expect(await read(root, `.claude/skills/craftpath-${step}/SKILL.md`)).toContain(
                PRINCIPLE,
            );
        expect(await read(root, ".craftpath/templates/SPEC.md")).toBe("# my own spec template\n");
        const fresh = await project();
        await quietly(() => init(fresh, ["--harness", "claude-code"]));
        expect(await read(root, ".craftpath/templates/SPEC.md.new")).toBe(
            await read(fresh, ".craftpath/templates/SPEC.md"),
        );
    });
});

describe("the test-first principle", () => {
    const PRINCIPLE = "test-first";
    const frontMatter = (text: string, key: string) =>
        text.match(new RegExp(`^${key}:(.*)$`, "m"))?.[1]?.trim();
    // The skill's text wraps: compare words, not lines.
    const words = (text: string) => text.replace(/\s+/g, " ").trim();

    test("installs the test-first principle on both harnesses", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of [".claude", ".pi"]) {
            const skill = await read(root, `${dir}/skills/${PRINCIPLE}/SKILL.md`);
            expect(frontMatter(skill, "name")).toBe(PRINCIPLE);
            expect(frontMatter(skill, "description")).toBeTruthy();
            expect(skill).not.toContain("{{");
        }
    });

    test("the test-first principle is a skill the model loads, not a step the user runs", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of [".claude", ".pi"]) {
            expect(await exists(root, `${dir}/skills/craftpath-${PRINCIPLE}`)).toBe(false);
            const skill = await read(root, `${dir}/skills/${PRINCIPLE}/SKILL.md`);
            expect(skill).not.toContain("disable-model-invocation: true");
            expect(skill).not.toContain("context: fork");
        }
    });

    test("the test-first principle states what the tdd rule states", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = words(await read(root, `.claude/skills/${PRINCIPLE}/SKILL.md`));
        for (const term of [
            "before any code exists",
            "RED",
            "GREEN",
            "REFACTOR",
            "reproducing test",
            "spike",
            "Stop signals",
            "complete.py",
            "Only the green half is enforced",
        ])
            expect(skill).toContain(term);
    });

    test("the test-first principle states the prove-it-works check", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = words(await read(root, `.claude/skills/${PRINCIPLE}/SKILL.md`));
        expect(skill).toContain("seen to fail because the behaviour is missing");
        expect(skill).toContain("then seen to pass");
    });

    // A step's text wraps, and the work brief is a blockquote: compare words, not lines.
    const stepWords = (text: string) => text.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim();
    const HARNESS_DIRS = [".claude", ".pi"];

    test("plan loads the test-first principle before its work", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of HARNESS_DIRS) {
            const skill = await read(root, `${dir}/skills/craftpath-plan/SKILL.md`);
            const firstInstruction = skill.search(/^1\. /m);
            expect(firstInstruction).toBeGreaterThan(0);
            expect(stepWords(skill.slice(0, firstInstruction))).toContain(
                `Load the \`${PRINCIPLE}\` skill`,
            );
        }
    });

    test("verify's finder brief loads the test-first principle", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of HARNESS_DIRS) {
            const skill = await read(root, `${dir}/skills/craftpath-verify/SKILL.md`);
            const finder = skill.split("## The finder's brief")[1] ?? "";
            expect(stepWords(finder)).toContain(`Load the \`${PRINCIPLE}\` skill`);
        }
    });

    test("work's brief tells each task's subagent to load the test-first principle", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of HARNESS_DIRS) {
            const skill = await read(root, `${dir}/skills/craftpath-work/SKILL.md`);
            const brief = skill.split("## The brief for each task's subagent")[1] ?? "";
            const paragraphs = brief.split(/\n>?[ \t]*\n/).map(stepWords);
            expect(
                paragraphs.some((p) => new RegExp(`[Ll]oad the \`${PRINCIPLE}\` skill`).test(p)),
            ).toBe(true);
        }
    });

    test("steps outside plan, verify and work do not load the test-first principle", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of HARNESS_DIRS)
            for (const step of ["brainstorm", "spec", "design", "pr", "learn", "learn-apply"]) {
                const skill = await read(root, `${dir}/skills/craftpath-${step}/SKILL.md`);
                expect({ dir, step, loads: skill.includes(PRINCIPLE) }).toEqual({
                    dir,
                    step,
                    loads: false,
                });
            }
    });

    test("plan and work name the test-first principle instead of the rule", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        for (const dir of HARNESS_DIRS) {
            const plan = stepWords(await read(root, `${dir}/skills/craftpath-plan/SKILL.md`));
            const work = stepWords(await read(root, `${dir}/skills/craftpath-work/SKILL.md`));
            for (const text of [plan, work]) {
                expect(text).not.toContain(".claude/rules/");
                expect(text).not.toContain(".pi/skills/tdd/");
            }
            expect(plan).toContain(`watches fail -- see the \`${PRINCIPLE}\` skill`);
            expect(work).toContain(
                `Follow the \`${PRINCIPLE}\` skill for every acceptance criterion`,
            );
        }
    });

    const RULE_POINTERS = ["{{RULE:", ".claude/rules/", ".pi/skills/tdd/"];

    test("nothing installed points at a rule", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const found: string[] = [];
        for (const dir of HARNESS_DIRS)
            for (const path of new Bun.Glob(`${dir}/skills/*/**`).scanSync({
                cwd: root,
                dot: true,
            })) {
                const text = await read(root, path);
                for (const pointer of RULE_POINTERS)
                    if (text.includes(pointer)) found.push(`${path}: ${pointer}`);
            }
        expect(found).toEqual([]);
    });

    test("init installs no rules", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        expect(await exists(root, ".craftpath/manifest.json")).toBe(true);
        for (const path of [".claude/rules", ".pi/skills/tdd"])
            expect({ path, exists: await dirExists(root, path) }).toEqual({ path, exists: false });
    });

    test("the manifest lists no rule", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const manifest = Object.keys(
            JSON.parse(await read(root, ".craftpath/manifest.json")).files,
        );
        expect(manifest).toContain(".claude/skills/test-first/SKILL.md");
        expect(manifest).not.toContain(".claude/rules/tdd.md");
        expect(manifest).not.toContain(".pi/skills/tdd/SKILL.md");
    });

    test("no shipped asset carries a rule token", async () => {
        const found: string[] = [];
        for (const path of new Bun.Glob("**").scanSync({ cwd: ASSETS, dot: true }))
            if ((await Bun.file(join(ASSETS, path)).text()).includes("{{RULE:")) found.push(path);
        expect(found).toEqual([]);
    });
});

describe("model and effort per step, on pi", () => {
    test("a configured pi step runs its subagent with model and thinking level", async () => {
        const root = await configured(
            '\n[steps.plan.pi]\nmodel = "anthropic/claude-opus-5-5"\neffort = "high"\n',
        );

        await quietly(() => init(root, ["--harness", "pi"]));

        const plan = await read(root, ".pi/skills/craftpath-plan/SKILL.md");
        expect(plan).toContain(
            "with agent `general-purpose`, model `anthropic/claude-opus-5-5`, thinking level `high`, `run_in_background: false`",
        );
    });

    test("an Anthropic pi model is invoked through the Agent tool only", async () => {
        const root = await configured('\n[steps.plan.pi]\nmodel = "anthropic/claude-opus-5-5"\n');

        await quietly(() => init(root, ["--harness", "pi"]));

        const plan = await read(root, ".pi/skills/craftpath-plan/SKILL.md");
        expect(plan).toContain("`Agent` tool");
        expect(plan).toContain("model `anthropic/claude-opus-5-5`");
        expect(plan).not.toContain("claude -p");
        expect(plan).not.toContain("`claude`");
        expect(plan).not.toContain("shell CLI");
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

        await quietly(() => init(root, ["--harness", "pi"]));

        const delegated = ALL_STEPS.filter(
            (step) => !["work", "verify", "brainstorm"].includes(step),
        );
        for (const step of delegated) {
            const path = `.pi/skills/craftpath-${step}/SKILL.md`;
            const skill = await read(root, path);
            expect({ path, handoff: skill }).toEqual({
                path,
                handoff: expect.stringContaining(
                    "pi-subagents-lite) with agent `general-purpose`, `run_in_background: false`,",
                ),
            });
            expect(skill).not.toContain("model `");
            expect(skill).not.toContain("thinking level `");
            expect(frontmatter(skill).filter((l) => /^(model|effort):/.test(l))).toEqual([]);
        }

        const brainstormPath = ".pi/skills/craftpath-brainstorm/SKILL.md";
        const brainstorm = await read(root, brainstormPath);
        expect(brainstorm).not.toContain("model `");
        expect(brainstorm).not.toContain("thinking level `");
        expect(frontmatter(brainstorm).filter((l) => /^(model|effort):/.test(l))).toEqual([]);

        const workPath = ".pi/skills/craftpath-work/SKILL.md";
        const work = await read(root, workPath);
        expect({ path: workPath, taskSubagent: work }).toEqual({
            path: workPath,
            taskSubagent: expect.stringContaining(
                "with the `Agent` tool (agent `general-purpose`).",
            ),
        });
        expect(work).not.toContain("model `");
        expect(work).not.toContain("thinking level `");
        expect(frontmatter(work).filter((l) => /^(model|effort):/.test(l))).toEqual([]);
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
            "# [steps.verify.pi]",
            '# model = "anthropic/claude-opus-5-5"',
            '# effort = "high"',
        ];
        const at: number[] = [];
        for (const line of wanted) at.push(lines.indexOf(line, (at.at(-1) ?? -1) + 1));
        expect(at.every((i) => i >= 0)).toBe(true);
        expect(Bun.TOML.parse(config)).not.toHaveProperty("steps");
    });
});

describe("the engineering principles", () => {
    /** Each principle, with the statements its text must make. */
    const PRINCIPLES: Record<string, string[]> = {
        "fix-root-causes": ["the cause, not the symptom"],
        "boundary-discipline": ["inside the boundary its task owns"],
        "laziness-protocol": [
            "the smallest change that meets the criteria",
            "prefer deletion to addition",
        ],
        "foundational-thinking": [
            "settle the data shapes first",
            "build the scaffold before the detail",
        ],
        "sequence-verifiable-units": ["verifiable on its own"],
    };
    const NAMES = Object.keys(PRINCIPLES);
    const DIRS = [".claude", ".pi"];
    const frontMatter = (text: string, key: string) =>
        text.match(new RegExp(`^${key}:(.*)$`, "m"))?.[1]?.trim();
    // The skill's text wraps: compare words, not lines.
    const words = (text: string) => text.replace(/\s+/g, " ").trim();

    async function installed(): Promise<string> {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code,pi"]));
        return root;
    }

    test("each principle calls itself an engineering principle", async () => {
        const root = await installed();

        for (const dir of DIRS)
            for (const name of NAMES) {
                const skill = await read(root, `${dir}/skills/${name}/SKILL.md`);
                const description = frontMatter(skill, "description") ?? "";
                expect({ name, opening: description.split(" — ")[0] }).toEqual({
                    name,
                    opening: "An engineering principle",
                });
            }
    });

    test("no installed skill contrasts itself with the retired discipline skills", async () => {
        const root = await installed();

        const contrasting: string[] = [];
        for await (const path of new Bun.Glob("{.claude,.pi}/skills/*/SKILL.md").scan({
            cwd: root,
            dot: true,
        }))
            if ((await read(root, path)).includes("not an engineering discipline"))
                contrasting.push(path);
        expect(contrasting).toEqual([]);
    });

    test("installs the five engineering principles on both harnesses", async () => {
        const root = await installed();

        for (const dir of DIRS)
            for (const name of NAMES) {
                const path = `${dir}/skills/${name}/SKILL.md`;
                expect(await exists(root, path), path).toBe(true);
                const skill = await read(root, path);
                expect(frontMatter(skill, "name"), path).toBe(name);
                expect(frontMatter(skill, "description"), path).toBeTruthy();
            }
    });

    test("each engineering principle states its principle", async () => {
        const root = await installed();

        for (const dir of DIRS)
            for (const [name, statements] of Object.entries(PRINCIPLES)) {
                const skill = words(await read(root, `${dir}/skills/${name}/SKILL.md`));
                for (const statement of statements)
                    expect(skill, `${dir} ${name}`).toContain(statement);
            }
    });

    test("no engineering principle keeps a placeholder", async () => {
        const root = await installed();

        for (const dir of DIRS)
            for (const name of NAMES)
                expect(
                    await read(root, `${dir}/skills/${name}/SKILL.md`),
                    `${dir} ${name}`,
                ).not.toContain("{{");
    });

    test("the engineering principles are skills the model loads", async () => {
        const root = await installed();

        for (const dir of DIRS)
            for (const name of NAMES) {
                const skill = await read(root, `${dir}/skills/${name}/SKILL.md`);
                expect(skill, `${dir} ${name}`).not.toContain("disable-model-invocation: true");
                expect(skill, `${dir} ${name}`).not.toContain("context: fork");
                expect(
                    await dirExists(root, `${dir}/skills/craftpath-${name}`),
                    `${dir} ${name}`,
                ).toBe(false);
            }
    });

    /** The principles each task's subagent loads: all but the plan step's sequencing one. */
    const IMPLEMENTER = [
        "fix-root-causes",
        "boundary-discipline",
        "laziness-protocol",
        "foundational-thinking",
    ];
    const WORK_DIRS = { "claude-code": ".claude", pi: ".pi" };

    async function workStep(root: string, dir: string): Promise<string> {
        return read(root, `${dir}/skills/craftpath-work/SKILL.md`);
    }

    test("work's brief tells each task's subagent to load the engineering principles", async () => {
        const root = await installed();

        for (const [harness, dir] of Object.entries(WORK_DIRS)) {
            const skill = await workStep(root, dir);
            const brief = words(
                (skill.split("## The brief for each task's subagent")[1] ?? "").replace(
                    /^>\s?/gm,
                    "",
                ),
            );
            for (const name of IMPLEMENTER)
                expect({
                    harness,
                    name,
                    loads: new RegExp(`[Ll]oad the \`${name}\` skill`).test(brief),
                }).toEqual({
                    harness,
                    name,
                    loads: true,
                });
        }
    });

    test("work's brief no longer loads skills from a task's Notes", async () => {
        const root = await installed();

        for (const dir of Object.values(WORK_DIRS))
            expect(words((await workStep(root, dir)).replace(/^>\s?/gm, "")), dir).not.toContain(
                "engineering skills its Notes name",
            );
    });

    test("work's brief does not load the sequencing principle", async () => {
        const root = await installed();

        for (const dir of Object.values(WORK_DIRS))
            expect(await workStep(root, dir), dir).not.toContain("sequence-verifiable-units");
    });

    async function verifyStep(root: string, dir: string): Promise<string> {
        return read(root, `${dir}/skills/craftpath-verify/SKILL.md`);
    }

    test("verify's finder loads the root-cause and smallest-change principles", async () => {
        const root = await installed();

        for (const dir of DIRS) {
            const finder = words(
                (await verifyStep(root, dir)).split("## The finder's brief")[1] ?? "",
            );
            for (const name of ["fix-root-causes", "laziness-protocol"])
                expect(finder, `${dir} ${name}`).toContain(`the \`${name}\` skill`);
        }
    });

    test("verify loads no other engineering principle", async () => {
        const root = await installed();

        for (const dir of DIRS) {
            const skill = await verifyStep(root, dir);
            for (const name of [
                "boundary-discipline",
                "foundational-thinking",
                "sequence-verifiable-units",
            ])
                expect(skill, `${dir} ${name}`).not.toContain(name);
        }
    });

    async function planStep(root: string, dir: string): Promise<string> {
        return read(root, `${dir}/skills/craftpath-plan/SKILL.md`);
    }

    test("plan loads the foundational and sequencing principles before its work", async () => {
        const root = await installed();

        for (const dir of DIRS) {
            const preamble = words((await planStep(root, dir)).split(/^1\. /m)[0] ?? "");
            for (const name of ["foundational-thinking", "sequence-verifiable-units"])
                expect(preamble, `${dir} ${name}`).toContain(`Load the \`${name}\` skill`);
        }
    });

    test("plan no longer tells the planner to name skills in Notes", async () => {
        const root = await installed();

        for (const dir of DIRS) {
            const skill = words(await planStep(root, dir));
            for (const phrase of [
                "Skills for the implementer",
                "Name what the implementer needs in the task's Notes",
                "`backend`",
                "`frontend`",
                "`infrastructure`",
            ])
                expect(skill, `${dir} ${phrase}`).not.toContain(phrase);
        }
    });

    test("nothing installed points at a discipline skill", async () => {
        const root = await installed();

        const found: string[] = [];
        for await (const path of new Bun.Glob("{.claude,.pi}/skills/*/SKILL.md").scan({
            cwd: root,
            dot: true,
        })) {
            const skill = await read(root, path);
            for (const name of ["`backend`", "`frontend`", "`infrastructure`"])
                if (skill.includes(name)) found.push(`${path}: ${name}`);
        }
        expect(found).toEqual([]);
    });

    test("test-first does not send the reader to skills named in Notes", async () => {
        const root = await installed();

        for (const dir of DIRS)
            expect(words(await read(root, `${dir}/skills/test-first/SKILL.md`)), dir).not.toContain(
                "a task's Notes name",
            );
    });

    test("plan loads no implementer-only principle", async () => {
        const root = await installed();

        for (const dir of DIRS) {
            const skill = await planStep(root, dir);
            for (const name of ["fix-root-causes", "boundary-discipline", "laziness-protocol"])
                expect(skill, `${dir} ${name}`).not.toContain(name);
        }
    });
});

describe("the modern-cli-tools skill", () => {
    const SKILL = "skills/modern-cli-tools/SKILL.md";

    /** A project initialised from an earlier packaged version of the skill. */
    async function earlierProject(): Promise<string> {
        const earlier = await scratch("craftpath-assets-");
        await cp(ASSETS, earlier, { recursive: true });
        await Bun.write(join(earlier, SKILL), "# an earlier modern-cli-tools\n");
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code"], { assets: earlier }));
        return root;
    }

    test("init installs the modern-cli-tools skill with its fallbacks", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        const skill = await read(root, `.claude/${SKILL}`);
        expect(skill).toMatch(/^---\nname: modern-cli-tools\ndescription: .+\n---\n/);
        for (const tool of ["rg", "fd", "zoxide", "ast-grep", "sg"])
            expect(skill).toContain(`\`${tool}\``);
        for (const fallback of ["grep", "find", "cd"]) expect(skill).toContain(`\`${fallback}\``);
        expect(skill).toMatch(/not installed/i);
    });

    test("init installs the same modern-cli-tools skill on pi", async () => {
        const root = await project();

        await quietly(() => init(root, ["--harness", "claude-code,pi"]));

        const claude = await read(root, `.claude/${SKILL}`);
        expect(await read(root, `.pi/${SKILL}`)).toBe(claude);
        expect(await exists(root, `.craftpath/${SKILL}`)).toBe(false);
        expect(await exists(root, `.craftpath/skills/modern-cli-tools/SKILL.md`)).toBe(false);
    });

    test("re-running init replaces an unedited older modern-cli-tools skill", async () => {
        const root = await earlierProject();

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, `.claude/${SKILL}`)).toBe(
            await Bun.file(join(ASSETS, SKILL)).text(),
        );
    });

    test("re-running init keeps a hand-edited modern-cli-tools skill and writes SKILL.md.new", async () => {
        const root = await earlierProject();
        await Bun.write(join(root, `.claude/${SKILL}`), "# my notes\n");

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, `.claude/${SKILL}`)).toBe("# my notes\n");
        expect(await read(root, `.claude/${SKILL}.new`)).toBe(
            await Bun.file(join(ASSETS, SKILL)).text(),
        );
    });
});

const BIN = new URL("../../bin/craftpath.ts", import.meta.url).pathname;

async function initWith(root: string, path: string) {
    const p = Bun.spawn([process.execPath, BIN, "init", "--harness", "claude-code,pi"], {
        cwd: root,
        env: { ...process.env, PATH: path },
        stdout: "pipe",
        stderr: "pipe",
    });
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { exit: await p.exited, out };
}

const files = async (root: string) =>
    (await readdir(root, { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile() && !e.parentPath.includes("/.git"))
        .map((e) => join(e.parentPath, e.name).slice(root.length))
        .sort();

describe("without the modern search tools installed", () => {
    test("init on a machine without the search tools installs nothing about them", async () => {
        const bare = await project();
        const normal = await project();

        const { exit, out } = await initWith(bare, await barePath());
        await initWith(normal, process.env.PATH ?? "");

        expect(exit).toBe(0);
        expect(out).not.toMatch(SEARCH_TOOLS);
        expect(await files(bare)).toEqual(await files(normal));
    });

    test("a step guard does not refuse because a search tool is absent", async () => {
        const root = await planned([[1, null]]);
        const command = "python3 .craftpath/scripts/work.py C-00001 all";
        const p = Bun.spawn(["python3", ".craftpath/scripts/guard.py"], {
            cwd: root,
            env: { ...process.env, PATH: await barePath() },
            stdin: new Blob([
                JSON.stringify({
                    hook_event_name: "PreToolUse",
                    tool_name: "Bash",
                    tool_input: { command },
                    cwd: root,
                }),
            ]),
            stdout: "pipe",
            stderr: "pipe",
        });
        const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());

        expect(await p.exited).toBe(0);
        expect(out).not.toContain("deny");
        expect(out).not.toMatch(SEARCH_TOOLS);
    });
});
