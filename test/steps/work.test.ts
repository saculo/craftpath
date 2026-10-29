/**
 * Step 3: `/craftpath-work <work id> wave <n> | all`.
 *
 * Tasks in one wave run in parallel, so no two of them may touch the same
 * module: `check.py plan` (and so the work guard) refuses a plan where they do.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import {
    commitsSince,
    git,
    guard,
    ID,
    planned,
    project,
    script,
    TREE,
    work,
    worktree,
    HARNESSES,
    words,
} from "./kit";

afterAll(cleanScratch);

const MODULES = `[git]
base_branch = "main"

[modules.api]
path = "api/"
test = "echo api-tests"

[modules.web]
path = "./web"
test = "echo web-tests"
`;

/** A plan with the given tasks, in a project with modules `api` and `web`. */
async function withModules(
    tasks: [number, string | null, string?][],
    modules = MODULES,
): Promise<string> {
    const root = await planned(tasks);
    await Bun.write(join(worktree(root, TREE), ".craftpath/config.toml"), modules);
    return root;
}

const checkPlan = (root: string) => script(root, "check", "plan", ID);

describe("check.py plan -- one module per task in a wave", () => {
    test("tasks in one wave touching different modules pass", async () => {
        const root = await withModules([
            [1, null, "api/src/health.ts"],
            [1, null, "web/src/page.ts"],
        ]);

        expect(await checkPlan(root)).toMatchObject({ exit: 0 });
    });

    test("two tasks in one wave touching the same module are named, with the module", async () => {
        const root = await withModules([
            [1, null, "api/src/health.ts"],
            [1, null, "web/src/page.ts, api/src/routes.ts"],
        ]);

        const { exit, out } = await checkPlan(root);

        expect(exit).toBe(1);
        expect(out).toContain("T-0001");
        expect(out).toContain("T-0002");
        expect(out).toContain("module api");
        expect(out).toContain("wave 1");
    });

    test("a module named directly in Touches counts as touching it", async () => {
        const root = await withModules([
            [1, null, "api"],
            [1, null, "`api/src/routes.ts`"],
        ]);

        const { exit, out } = await checkPlan(root);

        expect(exit).toBe(1);
        expect(out).toContain("module api");
    });

    test("the same module in different waves passes", async () => {
        const root = await withModules([
            [1, null, "api/src/health.ts"],
            [2, null, "api/src/routes.ts"],
        ]);

        expect(await checkPlan(root)).toMatchObject({ exit: 0 });
    });

    test("a Touches entry in no module is named", async () => {
        const root = await withModules([[1, null, "lib/util.ts"]]);

        const { exit, out } = await checkPlan(root);

        expect(exit).toBe(1);
        expect(out).toContain("T-0001");
        expect(out).toContain("lib/util.ts");
        expect(out).toContain("no module");
    });
});

/** Marks tasks done in PLAN.md, as complete.py does. */
async function tick(root: string, ...tasks: string[]): Promise<void> {
    const path = join(work(root), "PLAN.md");
    let plan = await Bun.file(path).text();
    for (const task of tasks) plan = plan.replace(`- [ ] ${task} `, `- [x] ${task} `);
    await Bun.write(path, plan);
}

describe("/craftpath-work guard", () => {
    const twoWaves = () =>
        planned([
            [1, null],
            [2, "T-0001"],
        ]);

    test("is refused while PLAN.md is incomplete", async () => {
        const root = await planned([[1, null]]);
        const file = join(work(root), "tasks/T-0001.md");
        await Bun.write(
            file,
            (await Bun.file(file).text()).replace("**Type:** feat", "**Type:** <type>"),
        );

        const { blocked, reason } = await guard(root, "work", `${ID} all`);

        expect(blocked).toBe(true);
        expect(reason).toContain("PLAN.md");
        expect(reason).toContain("T-0001");
    });

    test("is refused without wave <n> or all, saying how to call it", async () => {
        const { blocked, reason } = await guard(await twoWaves(), "work", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("wave <n>");
        expect(reason).toContain("all");
    });

    test("is refused for a wave the plan does not have, listing the waves", async () => {
        const { blocked, reason } = await guard(await twoWaves(), "work", `${ID} wave 3`);

        expect(blocked).toBe(true);
        expect(reason).toContain("wave 3");
        expect(reason).toContain("1, 2");
    });

    test("is refused for a wave while an earlier wave has an open task, naming it", async () => {
        const { blocked, reason } = await guard(await twoWaves(), "work", `${ID} wave 2`);

        expect(blocked).toBe(true);
        expect(reason).toContain("T-0001");
    });

    test("lets a wave run once every earlier wave is done, and all at any time", async () => {
        const root = await twoWaves();
        expect((await guard(root, "work", `${ID} wave 1`)).blocked).toBe(false);
        expect((await guard(root, "work", `${ID} all`)).blocked).toBe(false);

        await tick(root, "T-0001");

        expect((await guard(root, "work", `${ID} wave 2`)).blocked).toBe(false);
    });
});

describe("work.py -- the tasks to run", () => {
    /** T-0001 api and T-0002 web in wave 1, T-0003 api in wave 2. */
    const threeTasks = () =>
        withModules([
            [1, null, "api/src/health.ts"],
            [1, null, "web/src/page.ts"],
            [2, "T-0001", "api/src/routes.ts"],
        ]);

    test("all lists only open tasks, by wave, with each task file and its modules' tests", async () => {
        const root = await threeTasks();
        await tick(root, "T-0001");

        const { exit, out } = await script(root, "work", ID, "all");

        expect(exit).toBe(0);
        expect(out).not.toContain("T-0001 —");
        expect(out).toContain(join(work(root), "tasks/T-0002.md"));
        expect(out).toContain("web: echo web-tests");
        const order = ["Wave 1", "T-0002", "Wave 2", "T-0003", "api: echo api-tests"];
        const at = order.map((s) => out.indexOf(s));
        expect(at.every((i) => i >= 0)).toBe(true);
        expect(at).toEqual([...at].sort((a, b) => a - b));
    });

    test("K3 commits PLAN.md and the task files as the plan before listing the tasks", async () => {
        const root = await threeTasks();
        const tree = worktree(root, TREE);
        const before = (await git(tree, "rev-parse", "HEAD")).text().trim();

        await script(root, "work", ID, "all");

        expect(await commitsSince(tree, before)).toEqual([
            {
                subject: "docs(C-00001): add plan",
                files: [
                    ".craftpath/work/C-00001/PLAN.md",
                    ".craftpath/work/C-00001/tasks/T-0001.md",
                    ".craftpath/work/C-00001/tasks/T-0002.md",
                    ".craftpath/work/C-00001/tasks/T-0003.md",
                ],
            },
        ]);
    });

    test("wave <n> lists only that wave's open tasks", async () => {
        const { out } = await script(await threeTasks(), "work", ID, "wave", "1");

        expect(out).toContain("T-0001");
        expect(out).toContain("T-0002");
        expect(out).not.toContain("T-0003");
    });

    test("says so when every selected task is done", async () => {
        const root = await threeTasks();
        await tick(root, "T-0001", "T-0002", "T-0003");

        const { exit, out } = await script(root, "work", ID, "all");

        expect(exit).toBe(0);
        expect(out).toContain("Nothing to do");
    });
});

describe("complete.py -- a task is done when its modules' tests pass", () => {
    // api's tests pass once api/src/health.ts says ok; web's always fail.
    const RED_WEB = MODULES.replace('"echo api-tests"', '"grep -q ok src/health.ts"').replace(
        '"echo web-tests"',
        '"echo web is broken; exit 3"',
    );

    /** T-0001 (api) and T-0002 (web) in wave 1, both implemented, nothing committed. */
    async function implemented(): Promise<{ root: string; tree: string }> {
        const root = await withModules(
            [
                [1, null, "api/src/health.ts"],
                [1, null, "web/src/page.ts"],
            ],
            RED_WEB,
        );
        const tree = worktree(root, TREE);
        await Bun.write(join(tree, "api/src/health.ts"), "export const health = 'ok';\n");
        await Bun.write(join(tree, "web/src/page.ts"), "export const page = 1;\n");
        return { root, tree };
    }

    const head = async (tree: string) => (await git(tree, "rev-parse", "HEAD")).text().trim();

    test("green: runs a module check after its test before ticking and committing", async () => {
        const root = await withModules(
            [[1, null, "src/app.ts"]],
            `[git]
base_branch = "main"

[modules.app]
path = "./"
test = "echo test ran"
check = "echo check ran"
`,
        );
        const tree = worktree(root, TREE);
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok';\n");

        const { exit, out } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(0);
        const testOutput = out.indexOf("app: echo test ran");
        const checkOutput = out.indexOf("app: echo check ran");
        expect(testOutput).toBeGreaterThanOrEqual(0);
        expect(checkOutput).toBeGreaterThan(testOutput);
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toContain("- [x] T-0001 — ");
        expect((await git(tree, "log", "-1", "--format=%s")).text().trim()).toBe(
            "feat(C-00001/T-0001): Add GET /health",
        );
    });

    test("red test: leaves the task open without running its check", async () => {
        const root = await withModules(
            [[1, null, "src/app.ts"]],
            `[git]
base_branch = "main"

[modules.app]
path = "./"
test = "echo test failed; exit 1"
check = "echo check ran"
`,
        );
        const tree = worktree(root, TREE);
        const plan = await Bun.file(join(work(root), "PLAN.md")).text();
        const before = await head(tree);

        const { exit, out, err } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(1);
        expect(out + err).toContain("test failed");
        expect(out + err).not.toContain("check ran");
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toBe(plan);
        expect(await head(tree)).toBe(before);
    });

    test("red check: leaves the task open without a commit", async () => {
        const root = await withModules(
            [[1, null, "src/app.ts"]],
            `[git]
base_branch = "main"

[modules.app]
path = "./"
test = "echo test ran"
check = "echo check failed; exit 1"
`,
        );
        const tree = worktree(root, TREE);
        const plan = await Bun.file(join(work(root), "PLAN.md")).text();
        const before = await head(tree);

        const { exit, out, err } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(1);
        expect(out + err).toContain("check failed");
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toBe(plan);
        expect(await head(tree)).toBe(before);
    });

    test("green without a check: completes the task after its test", async () => {
        const root = await withModules(
            [[1, null, "src/app.ts"]],
            `[git]
base_branch = "main"

[modules.app]
path = "./"
test = "echo test ran"
`,
        );
        const tree = worktree(root, TREE);
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok';\n");

        const { exit } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(0);
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toContain("- [x] T-0001 — ");
        expect((await git(tree, "log", "-1", "--format=%s")).text().trim()).toBe(
            "feat(C-00001/T-0001): Add GET /health",
        );
    });

    test("green: ticks the task and commits only its module's changes, its task file and PLAN.md", async () => {
        const { root, tree } = await implemented();

        const { exit } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(0);
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toContain("- [x] T-0001 — ");
        expect((await git(tree, "log", "-1", "--format=%s")).text().trim()).toBe(
            "feat(C-00001/T-0001): Add GET /health",
        );
        const committed = (await git(tree, "show", "--name-only", "--format=", "HEAD")).text();
        expect(committed.trim().split("\n").sort()).toEqual([
            ".craftpath/work/C-00001/PLAN.md",
            ".craftpath/work/C-00001/tasks/T-0001.md",
            "api/src/health.ts",
        ]);
        expect((await git(tree, "status", "--porcelain")).text()).toContain("web/");
    });

    test("red: exits 1 with the test output, and ticks and commits nothing", async () => {
        const { root, tree } = await implemented();
        const plan = await Bun.file(join(work(root), "PLAN.md")).text();
        const before = await head(tree);

        const { exit, out, err } = await script(tree, "complete", ID, "T-0002");

        expect(exit).toBe(1);
        expect(out + err).toContain("web is broken");
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toBe(plan);
        expect(await head(tree)).toBe(before);
    });

    test("a 72-character subject that passed the plan check is committed unchanged", async () => {
        const title = "Refuse an over-long commit subject in the plan run";
        const subject = `feat(C-00001/T-0001): ${title}`;
        expect(subject).toHaveLength(72);
        const { root, tree } = await implemented();
        const path = join(work(root), "PLAN.md");
        const plan = await Bun.file(path).text();
        await Bun.write(
            path,
            plan.replace("- [ ] T-0001 — Add GET /health", `- [ ] T-0001 — ${title}`),
        );
        expect(await script(tree, "check", "plan", ID)).toMatchObject({ exit: 0 });

        const { exit } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(0);
        expect((await git(tree, "log", "-1", "--format=%s")).text().trim()).toBe(subject);
    });

    test("a task that is already done is refused", async () => {
        const { tree } = await implemented();
        await script(tree, "complete", ID, "T-0001");

        const { exit, err } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(1);
        expect(err).toContain("already done");
    });
});

describe("work records decisions", () => {
    const ASSETS = new URL("../../assets", import.meta.url).pathname;

    /** The installed work brief on each harness, one entry of word-normalised paragraphs per harness. */
    async function briefs(): Promise<string[][]> {
        const root = await project({ harness: "claude-code,pi" });
        const all: string[][] = [];
        for (const dir of HARNESSES) {
            const skill = await Bun.file(join(root, dir, "skills/craftpath-work/SKILL.md")).text();
            const brief = skill.split("## The brief for each task's subagent")[1] ?? "";
            all.push(
                brief
                    .split(/\n>?[ \t]*\n/)
                    .map(words)
                    .filter((p) => p !== ""),
            );
        }
        return all;
    }

    test("work's brief asks each subagent to report its decisions before DONE or STUCK", async () => {
        for (const paragraphs of await briefs()) {
            const last = paragraphs.at(-1) ?? "";
            expect(last).toContain("`DONE`");
            expect(last).toContain("`STUCK: ");
            const report = paragraphs
                .slice(0, -1)
                .findIndex(
                    (p) => p.includes("decisions") && p.includes("reason") && p.includes("`none`"),
                );
            expect(report).toBeGreaterThanOrEqual(0);
        }
    });

    test("work's brief keeps decisions out of the task file's Notes", async () => {
        for (const paragraphs of await briefs()) {
            expect(
                paragraphs.filter((p) => p.includes("decisions") && p.includes("Notes")),
            ).toEqual([]);
            expect(paragraphs.some((p) => p.includes("Notes") && p.includes("reviewer"))).toBe(
                true,
            );
        }
    });

    test("work's brief forbids the subagent DECISIONS.md", async () => {
        for (const paragraphs of await briefs())
            expect(
                paragraphs.some(
                    (p) => p.includes("`DECISIONS.md`") && p.includes("not create or edit"),
                ),
            ).toBe(true);
    });

    /**
     * The step's own part of the installed work skill on each harness -- the
     * text before the brief -- as word-normalised numbered instructions, in order.
     */
    async function stepInstructions(): Promise<string[][]> {
        const root = await project({ harness: "claude-code,pi" });
        const all: string[][] = [];
        for (const dir of HARNESSES) {
            const skill = await Bun.file(join(root, dir, "skills/craftpath-work/SKILL.md")).text();
            const step = skill.split("## The brief for each task's subagent")[0] ?? "";
            all.push(step.split(/\n[ \t]*\d+\.[ \t]/).map(words));
        }
        return all;
    }

    const DECISIONS_PATH = "`.craftpath/work/<work id>/DECISIONS.md`";

    /** The step's instruction that writes DECISIONS.md, on each harness. */
    async function gathering(): Promise<{ at: number; text: string; instructions: string[] }[]> {
        return (await stepInstructions()).map((instructions) => {
            const at = instructions.findIndex((i) => i.includes(DECISIONS_PATH));
            return { at, text: instructions[at] ?? "", instructions };
        });
    }

    test("work writes a wave's decisions to DECISIONS.md once complete.py has run", async () => {
        for (const { at, text, instructions } of await gathering()) {
            expect(at).toBeGreaterThanOrEqual(0);
            expect(text).toContain("does not exist");
            const complete = instructions.findIndex((i) =>
                i.includes("`python3 .craftpath/scripts/complete.py <work id> <task id>`"),
            );
            expect(complete).toBeGreaterThanOrEqual(0);
            expect(at).toBeGreaterThan(complete);
        }
    });

    test("work gives every task of the wave a heading in DECISIONS.md, done or stuck", async () => {
        for (const { text } of await gathering())
            for (const phrase of ["task id", "`None`", "done", "stuck"])
                expect(text).toContain(phrase);
    });

    test("work appends to DECISIONS.md and never rewrites it", async () => {
        for (const { text } of await gathering()) {
            expect(text).toContain("append");
            expect(text).toContain("never rewrite or remove");
        }
    });

    test("only work, which writes DECISIONS.md, and learn, which reads it, name it", async () => {
        const naming: string[] = [];
        for (const step of new Bun.Glob("*.md").scanSync(join(ASSETS, "steps")))
            if ((await Bun.file(join(ASSETS, "steps", step)).text()).includes("DECISIONS.md"))
                naming.push(step);

        expect(naming.sort()).toEqual(["learn.md", "work.md"]);
    });
});
