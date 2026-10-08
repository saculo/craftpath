/**
 * Step 3: `/craftpath:work <work id> wave <n> | all`.
 *
 * Tasks in one wave run in parallel, so no two of them may touch the same
 * module: `check.py plan` (and so the work guard) refuses a plan where they do.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { git, guard, ID, planned, script, TREE, work, worktree } from "./kit";

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

describe("/craftpath:work guard", () => {
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

    test("a task that is already done is refused", async () => {
        const { root, tree } = await implemented();
        await script(tree, "complete", ID, "T-0001");

        const { exit, err } = await script(tree, "complete", ID, "T-0001");

        expect(exit).toBe(1);
        expect(err).toContain("already done");
    });
});
