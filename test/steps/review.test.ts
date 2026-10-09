/**
 * Step 4a: `/craftpath:review <work id>`.
 *
 * The guard checks every task is done and committed and the code is
 * committed; `review.py` runs every module's tests, creates or reuses
 * REVIEW.md and says what to review; `check.py review` is REVIEW.md's
 * completeness check, which `/craftpath:pr`'s guard applies.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { git, guard, ID, planned, script, TREE, work, worktree } from "./kit";

afterAll(cleanScratch);

// One module, the whole repository; its tests pass once src/app.ts says ok.
const CONFIG = `[git]
base_branch = "main"

[modules.app]
path = "./"
test = "grep -q ok src/app.ts || (echo app is broken; exit 3)"
`;

const head = async (tree: string) => (await git(tree, "rev-parse", "HEAD")).text().trim();

/** C-00001 planned with one task, T-0001, and the modules config committed. */
async function plannedOne(): Promise<{ root: string; tree: string }> {
    const root = await planned([[1, null]]);
    const tree = worktree(root, TREE);
    await Bun.write(join(tree, ".craftpath/config.toml"), CONFIG);
    await git(tree, "add", ".craftpath/config.toml");
    await git(tree, "commit", "-q", "-m", "chore: one module");
    return { root, tree };
}

/** C-00001 with T-0001 implemented and completed: ready for review. */
async function done(): Promise<{ root: string; tree: string }> {
    const { root, tree } = await plannedOne();
    await script(tree, "work", ID, "all");
    await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok';\n");
    const completed = await script(tree, "complete", ID, "T-0001");
    if (completed.exit !== 0) throw new Error(completed.out + completed.err);
    return { root, tree };
}

const review = (tree: string) => join(tree, ".craftpath/work", ID, "REVIEW.md");

describe("/craftpath:review guard", () => {
    test("V1 is refused while a task is not done, naming it", async () => {
        const { tree } = await plannedOne();
        await script(tree, "work", ID, "all");

        const { blocked, reason } = await guard(tree, "review", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("T-0001");
        expect(reason).toContain("not done");
    });

    test("V2 is refused when a done task has no commit carrying its id, naming it", async () => {
        const { root, tree } = await plannedOne();
        await script(tree, "work", ID, "all");
        const plan = join(work(root), "PLAN.md");
        await Bun.write(
            plan,
            (await Bun.file(plan).text()).replace("- [ ] T-0001", "- [x] T-0001"),
        );
        await git(tree, "commit", "-q", "-am", "chore: tick by hand");

        const { blocked, reason } = await guard(tree, "review", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("T-0001");
        expect(reason).toContain("C-00001/T-0001");
    });

    test("V3 is refused with uncommitted changes outside the work item, listing them", async () => {
        const { tree } = await done();
        await Bun.write(join(tree, "src/other.ts"), "export const other = 1;\n");

        const { blocked, reason } = await guard(tree, "review", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("src/other.ts");
    });

    test("V3 lets uncommitted changes inside the work item's directory through", async () => {
        const { tree } = await done();
        await Bun.write(review(tree), "# notes\n");

        expect((await guard(tree, "review", ID)).blocked).toBe(false);
    });
});

describe("review.py -- tests first, then REVIEW.md", () => {
    test("V4 with a module's tests red, exits 1 with their output and creates no REVIEW.md", async () => {
        const { tree } = await done();
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'down';\n");
        await git(tree, "commit", "-q", "-am", "fix: break it");

        const { exit, out, err } = await script(tree, "review", ID);

        expect(exit).toBe(1);
        expect(out + err).toContain("app is broken");
        expect(await Bun.file(review(tree)).exists()).toBe(false);
    });

    test("V5 without REVIEW.md, creates it reviewed at HEAD and says what to review", async () => {
        const { tree } = await done();
        const base = (await git(tree, "merge-base", "main", "HEAD")).text().trim();

        const { exit, out } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        const text = await Bun.file(review(tree)).text();
        expect(text).toStartWith("# C-00001 — Health endpoint: review");
        expect(text).toContain(`- **Reviewed at:** ${await head(tree)}`);
        expect(out).toContain(review(tree));
        expect(out).toContain(`${base.slice(0, 7)}`);
        expect(out).toContain("feat(C-00001/T-0001): Add GET /health");
        expect(out).toContain("src/app.ts");
        expect(out).toContain("next point: R1");
    });

    test("V6 with REVIEW.md, keeps every point, moves Reviewed at to HEAD and lists the open points", async () => {
        const { tree } = await done();
        const solvedIn = (await head(tree)).slice(0, 7);
        const points = [
            "- [ ] R1 [major] src/app.ts:1 -- health says ok without checking anything",
            `- [x] R2 [minor] src/app.ts:1 -- no type (solved in ${solvedIn})`,
            "- [-] R3 [minor] README.md -- no endpoint list (won't fix: out of scope)",
        ].join("\n");
        await Bun.write(
            review(tree),
            `# C-00001 — Health endpoint: review\n\n- **Reviewed at:** 0000000\n\n## Points\n\n${points}\n`,
        );
        await git(tree, "add", "-A");
        await git(tree, "commit", "-q", "-m", "docs: an earlier review");

        const { exit, out } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        const text = await Bun.file(review(tree)).text();
        expect(text).toContain(points);
        expect(text).toContain(`- **Reviewed at:** ${await head(tree)}`);
        expect(out).toContain("R1 [major]");
        expect(out).not.toContain("R2 [minor]");
        expect(out).not.toContain("R3 [minor]");
        expect(out).toContain("next point: R4");
    });
});

describe("check.py review -- what 'complete' means for REVIEW.md", () => {
    async function withReview(points: string): Promise<string> {
        const { tree } = await done();
        await script(tree, "review", ID);
        const sha = await head(tree);
        await Bun.write(
            review(tree),
            `# C-00001 — Health endpoint: review\n\n- **Reviewed at:** ${sha}\n\n## Points\n\n${points.replaceAll("HEAD", sha.slice(0, 7))}\n`,
        );
        return tree;
    }

    test("V7 well-formed points pass, and so does None", async () => {
        const tree = await withReview(
            [
                "- [ ] R1 [major] src/app.ts:1 -- health says ok without checking anything",
                "- [x] R2 [minor] src/app.ts -- no type (solved in HEAD)",
                "- [-] R3 [minor] README.md -- no endpoint list (won't fix: out of scope)",
            ].join("\n"),
        );
        expect(await script(tree, "check", "review", ID)).toMatchObject({ exit: 0 });

        const none = await withReview("None");
        expect(await script(none, "check", "review", ID)).toMatchObject({ exit: 0 });
    });

    test("V7 names a malformed point, a duplicate id, an unsolved [x] and a [-] without a reason", async () => {
        const tree = await withReview(
            [
                "- [ ] R1 [major] src/app.ts:1 -- fine",
                "- [ ] R1 [minor] src/app.ts:2 -- the same id again",
                "- [ ] R2 health is slow",
                "- [x] R3 [minor] src/app.ts -- solved, but where",
                "- [x] R4 [minor] src/app.ts -- solved in a commit that is not there (solved in deadbee)",
                "- [-] R5 [minor] README.md -- dropped",
            ].join("\n"),
        );

        const { exit, out } = await script(tree, "check", "review", ID);

        expect(exit).toBe(1);
        expect(out).toContain("R1 is used twice");
        expect(out).toContain("- [ ] R2 health is slow");
        expect(out).toContain("R3");
        expect(out).toContain("deadbee");
        expect(out).toContain("R5");
        expect(out).not.toContain("R1 [major]");
    });
});
