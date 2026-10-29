/**
 * Step 4a: `/craftpath-verify <work id>`.
 *
 * The guard checks every task is done and committed and the code is
 * committed, before the verify script runs.
 *
 * `check.py verify` is VERIFY.md's completeness check: every point names a
 * `file:line` and a failure scenario, `given <input or state>, <what goes
 * wrong>`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { done, git, guard, head, ID, plannedOne, script, work } from "./kit";

afterAll(cleanScratch);

/** The work item's VERIFY.md, in its worktree. */
const verify = (tree: string) => join(tree, ".craftpath/work", ID, "VERIFY.md");

describe("/craftpath-verify guard", () => {
    test("S2 is refused while a task is not done, naming it", async () => {
        const { tree } = await plannedOne();
        await script(tree, "work", ID, "all");

        const { blocked, reason } = await guard(tree, "verify", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("T-0001");
        expect(reason).toContain(`/craftpath-work ${ID} all`);
        expect(await Bun.file(verify(tree)).exists()).toBe(false);
    });

    test("S2 is refused when a done task has no commit carrying its id", async () => {
        const { root, tree } = await plannedOne();
        await script(tree, "work", ID, "all");
        const plan = join(work(root), "PLAN.md");
        await Bun.write(
            plan,
            (await Bun.file(plan).text()).replace("- [ ] T-0001", "- [x] T-0001"),
        );
        await git(tree, "commit", "-q", "-am", "chore: tick by hand");

        const { blocked, reason } = await guard(tree, "verify", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("T-0001");
        expect(reason).toContain(`(${ID}/T-0001)`);
    });

    test("S2 is refused with uncommitted changes outside the work item, listing them", async () => {
        const { tree } = await done();
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok!';\n");

        const { blocked, reason } = await guard(tree, "verify", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("src/app.ts");
    });

    test("S2 lets uncommitted changes inside the work item through", async () => {
        const { tree } = await done();
        await Bun.write(join(tree, ".craftpath/work", ID, "notes.md"), "# notes\n");

        expect((await guard(tree, "verify", ID)).blocked).toBe(false);
    });
});

describe("check.py verify -- what 'complete' means for VERIFY.md", () => {
    /** C-00001 with every task done and a VERIFY.md verified at HEAD holding `points`. */
    async function withVerify(points: string): Promise<string> {
        const { tree } = await done();
        const sha = await head(tree);
        await Bun.write(
            join(tree, ".craftpath/work", ID, "VERIFY.md"),
            `# C-00001 — Health endpoint: verify\n\n- **Verified at:** ${sha}\n\n## Points\n\n${points}\n`,
        );
        return tree;
    }

    test("S6 a point with a location and a failure scenario passes", async () => {
        const tree = await withVerify(
            "- [ ] F1 [major] src/a.ts:12 -- given an empty list, total() returns NaN instead of 0",
        );

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(exit).toBe(0);
        expect(out).toContain("VERIFY.md is complete.");
    });

    test("S6 None under Points passes", async () => {
        const tree = await withVerify("None");

        expect(await script(tree, "check", "verify", ID)).toMatchObject({ exit: 0 });
    });

    test("S6 names a point without a failure scenario by id", async () => {
        const tree = await withVerify("- [ ] F1 [major] src/a.ts:12 -- total() is wrong");

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(exit).toBe(1);
        expect(out).toContain("F1 has no failure scenario");
        expect(out).not.toContain("F1 has no file:line");
    });

    test("S6 names a point without a file:line by id", async () => {
        const tree = await withVerify(
            "- [ ] F2 [minor] src/a.ts -- given an empty list, total() returns NaN",
        );

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(exit).toBe(1);
        expect(out).toContain("F2 has no file:line");
        expect(out).not.toContain("F2 has no failure scenario");
    });

    test("names a review-style id, a duplicate, an unsolved [x] and a reasonless [-]", async () => {
        const scenario = "given an empty list, total() returns NaN";
        const tree = await withVerify(
            [
                `- [ ] R1 [major] src/a.ts:1 -- ${scenario}`,
                `- [ ] F3 [major] src/a.ts:2 -- ${scenario}`,
                `- [ ] F3 [minor] src/a.ts:3 -- ${scenario}`,
                `- [x] F4 [minor] src/a.ts:4 -- ${scenario}`,
                `- [-] F5 [minor] src/a.ts:5 -- ${scenario}`,
            ].join("\n"),
        );

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(exit).toBe(1);
        expect(out).toContain(`not a point: - [ ] R1 [major] src/a.ts:1 -- ${scenario}`);
        expect(out).toContain("F3 is used twice");
        expect(out).toContain("F4 is marked solved without its commit");
        expect(out).toContain("F5 is marked won't fix without a reason");
    });
});
