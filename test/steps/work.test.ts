/**
 * Step 3: `/craftpath:work <work id> wave <n> | all`.
 *
 * Tasks in one wave run in parallel, so no two of them may touch the same
 * module: `check.py plan` (and so the work guard) refuses a plan where they do.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { ID, planned, script, TREE, worktree } from "./kit";

afterAll(cleanScratch);

const MODULES = `[git]
base_branch = "main"

[modules.api]
path = "api/"
test = "true"

[modules.web]
path = "./web"
test = "true"
`;

/** A plan with the given tasks, in a project with modules `api` and `web`. */
async function withModules(tasks: [number, string | null, string?][]): Promise<string> {
    const root = await planned(tasks);
    await Bun.write(join(worktree(root, TREE), ".craftpath/config.toml"), MODULES);
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
