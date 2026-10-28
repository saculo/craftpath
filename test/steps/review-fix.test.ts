/**
 * `/craftpath-review-fix <work id>`.
 *
 * The guard lets the step start only when there is a review, every task is
 * done, and at least one review point is still open.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { done, git, guard, head, ID, planned, review, TREE, work, worktree } from "./kit";

afterAll(cleanScratch);

const reviewWith = (sha: string, points: string) => `# C-00001 — Health endpoint: review

- **Reviewed at:** ${sha}

## Points

${points}
`;

const OPEN = "- [ ] R1 [major] src/app.ts:1 -- wrong exit code";

describe("/craftpath-review-fix guard", () => {
    test("review-fix is refused without a review, naming the review step", async () => {
        const { tree } = await done();
        const before = (await git(tree, "status", "--porcelain")).text();

        const { blocked, reason } = await guard(tree, "review-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("no REVIEW.md");
        expect(reason).toContain(`/craftpath-review ${ID}`);
        expect((await git(tree, "status", "--porcelain")).text()).toBe(before);
    });

    test("review-fix is refused while a task is open, naming it", async () => {
        const root = await planned([
            [1, null],
            [2, "T-0001"],
        ]);
        const tree = worktree(root, TREE);
        const plan = join(work(root), "PLAN.md");
        await Bun.write(plan, (await Bun.file(plan).text()).replace("- [ ] T-0001", "- [x] T-0001"));
        await Bun.write(review(tree), reviewWith(await head(tree), OPEN));

        const { blocked, reason } = await guard(tree, "review-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("T-0002");
        expect(reason).toContain("not done");
        expect(reason).not.toContain("T-0001");
    });

    test("review-fix is refused when every point is closed", async () => {
        const { tree } = await done();
        const sha = await head(tree);
        await Bun.write(
            review(tree),
            reviewWith(
                sha,
                [
                    `- [x] R1 [major] src/app.ts:1 -- wrong exit code (solved in ${sha})`,
                    "- [-] R2 [minor] README.md:3 -- vague wording (won't fix: wording is fine)",
                ].join("\n"),
            ),
        );

        const { blocked, reason } = await guard(tree, "review-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("no review point is open");
    });

    test("review-fix is refused when the review has no points", async () => {
        const { tree } = await done();
        await Bun.write(review(tree), reviewWith(await head(tree), "None"));

        const { blocked, reason } = await guard(tree, "review-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("no review point is open");
    });

    test("review-fix runs once every task is done and a point is open", async () => {
        const { tree } = await done();
        await Bun.write(review(tree), reviewWith(await head(tree), OPEN));

        expect((await guard(tree, "review-fix", ID)).blocked).toBe(false);
    });
});
