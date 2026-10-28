/**
 * `/craftpath-review-fix <work id>`.
 *
 * The guard lets the step start only when there is a review, every task is
 * done, and at least one review point is still open.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import {
    commitsSince,
    completeTask,
    done,
    git,
    guard,
    head,
    ID,
    planned,
    review,
    script,
    TREE,
    work,
    worktree,
} from "./kit";

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
        await Bun.write(
            plan,
            (await Bun.file(plan).text()).replace("- [ ] T-0001", "- [x] T-0001"),
        );
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

const POINTS = [
    OPEN,
    "- [x] R2 [minor] src/app.ts:2 -- stale comment (solved in abc1234)",
    "- [-] R3 [minor] README.md:3 -- vague wording (won't fix: wording is fine)",
].join("\n");

/** Every file review-fix must leave as it found it: REVIEW.md, PLAN.md and the task files. */
async function snapshot(tree: string): Promise<Record<string, string>> {
    const dir = join(tree, ".craftpath/work", ID);
    const files = ["REVIEW.md", "PLAN.md"];
    for await (const f of new Bun.Glob("tasks/T-*.md").scan(dir)) files.push(f);
    const out: Record<string, string> = {};
    for (const f of files.sort()) out[f] = await Bun.file(join(dir, f)).text();
    return out;
}

describe("review-fix.py", () => {
    test("review-fix.py lists only the open points", async () => {
        const { tree } = await done();
        await Bun.write(review(tree), reviewWith(await head(tree), POINTS));

        const { exit, out, err } = await script(tree, "review-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(out).toContain(OPEN);
        expect(out).not.toMatch(/\bR2\b/);
        expect(out).not.toMatch(/\bR3\b/);
    });

    test("review-fix.py says where the fix tasks go", async () => {
        const root = await planned([
            [1, null],
            [1, null],
            [2, null],
        ]);
        const tree = worktree(root, TREE);
        const plan = join(work(root), "PLAN.md");
        await Bun.write(plan, (await Bun.file(plan).text()).replaceAll("- [ ] T-", "- [x] T-"));
        await Bun.write(review(tree), reviewWith(await head(tree), OPEN));

        const { exit, out, err } = await script(tree, "review-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        const lines = out.split("\n").map((l) => l.trim());
        expect(lines).toContain("last task: T-0003");
        expect(lines).toContain("highest wave: 2");
        expect(lines).toContain("fix tasks start at wave 3");
        expect(out).toMatch(/task\.py C-00001 .*--type fix/);
    });

    test("review-fix.py commits the review and writes nothing else", async () => {
        const { tree } = await done();
        await Bun.write(review(tree), reviewWith(await head(tree), OPEN));
        const before = await head(tree);
        const files = await snapshot(tree);

        const { exit, err } = await script(tree, "review-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(await commitsSince(tree, before)).toEqual([
            { subject: `docs(${ID}): add review`, files: [`.craftpath/work/${ID}/REVIEW.md`] },
        ]);
        expect(await snapshot(tree)).toEqual(files);
    });

    test("review-fix.py makes no commit when the review is committed", async () => {
        const { tree } = await done();
        await Bun.write(review(tree), reviewWith(await head(tree), OPEN));
        await git(tree, "add", review(tree));
        await git(tree, "commit", "-q", "-m", `docs(${ID}): add review`);
        const before = await head(tree);

        const { exit, err } = await script(tree, "review-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(await head(tree)).toBe(before);
        expect((await git(tree, "status", "--porcelain")).text()).toBe("");
    });

    test("work runs only the fix tasks review-fix added", async () => {
        const { tree } = await done();
        await Bun.write(review(tree), reviewWith(await head(tree), OPEN));
        expect((await script(tree, "review-fix", ID)).exit).toBe(0);

        const added = await script(
            tree,
            "task",
            ID,
            "--wave",
            "2",
            "--type",
            "fix",
            "Return exit code 1",
        );
        expect(added.exit).toBe(0);
        await Bun.write(
            join(tree, ".craftpath/work", ID, "tasks", "T-0002.md"),
            completeTask("T-0002", 2)
                .replace("- **Type:** feat", "- **Type:** fix")
                .replace("- **Scenarios:** S1", "- **Scenarios:** S1\n- **Fixes:** R1"),
        );

        const { exit, out, err } = await script(tree, "work", ID, "all");

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(out).toContain("T-0002");
        expect(out).not.toContain("T-0001");
    });
});

/**
 * C-00001 with T-0001 done, a committed REVIEW.md with the given points, and one
 * new fix task per entry of `fixes`, added by task.py in its own wave: each
 * entry is the task's Fixes value, or null for a task with no Fixes line.
 */
async function fixTasks(points: string, fixes: (string | null)[]): Promise<string> {
    const { tree } = await done();
    const sha = await head(tree);
    await Bun.write(review(tree), reviewWith(sha, points.replaceAll("<sha>", sha)));
    await git(tree, "add", review(tree));
    await git(tree, "commit", "-q", "-m", `docs(${ID}): add review`);
    for (const [i, value] of fixes.entries()) {
        const id = `T-000${i + 2}`;
        const wave = i + 2;
        const added = await script(
            tree,
            "task",
            ID,
            "--wave",
            String(wave),
            "--type",
            "fix",
            "Fix it",
        );
        if (added.exit !== 0) throw new Error(added.out + added.err);
        const fixesLine = value === null ? "" : `\n- **Fixes:** ${value}`;
        await Bun.write(
            join(tree, ".craftpath/work", ID, "tasks", `${id}.md`),
            completeTask(id, wave)
                .replace("- **Type:** feat", "- **Type:** fix")
                .replace("- **Scenarios:** S1", `- **Scenarios:** S1${fixesLine}`),
        );
    }
    return tree;
}

const point = (state: " " | "x" | "-", id: string) =>
    state === " "
        ? `- [ ] ${id} [major] src/app.ts:1 -- wrong exit code`
        : state === "x"
          ? `- [x] ${id} [minor] src/app.ts:2 -- stale comment (solved in <sha>)`
          : `- [-] ${id} [minor] README.md:3 -- vague wording (won't fix: wording is fine)`;

const reviewFix = (tree: string) => script(tree, "check", "review-fix", ID);

describe("check.py review-fix", () => {
    test("fix tasks naming every open point pass the review-fix check", async () => {
        const tree = await fixTasks([point(" ", "R1"), point(" ", "R2")].join("\n"), ["R1", "R2"]);

        const { exit, out } = await reviewFix(tree);

        expect(out).toContain("PLAN.md is complete.");
        expect(exit).toBe(0);
    });

    test("one fix task may fix several points", async () => {
        const tree = await fixTasks([point(" ", "R1"), point(" ", "R3")].join("\n"), ["R1, R3"]);

        const { exit, out } = await reviewFix(tree);

        expect(out).toContain("PLAN.md is complete.");
        expect(exit).toBe(0);
    });

    test("an open point no new task fixes fails the review-fix check", async () => {
        const tree = await fixTasks([point(" ", "R1"), point(" ", "R3")].join("\n"), ["R1"]);

        const { exit, out } = await reviewFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/R3 is open, but no new task fixes it/);
    });

    test("a fix task naming a closed point fails the review-fix check", async () => {
        for (const closed of [point("x", "R2"), point("-", "R2")]) {
            const tree = await fixTasks([point(" ", "R1"), closed].join("\n"), ["R1, R2"]);

            const { exit, out } = await reviewFix(tree);

            expect(exit).toBe(1);
            expect(out).toMatch(/T-0002: fixes R2, which is not an open review point/);
        }
        const tree = await fixTasks([point(" ", "R1"), point("-", "R3")].join("\n"), ["R1, R3"]);

        const { exit, out } = await reviewFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0002: fixes R3, which is not an open review point/);
    });

    test("a new task without Fixes fails the review-fix check", async () => {
        const tree = await fixTasks(point(" ", "R1"), ["R1", null]);

        const { exit, out } = await reviewFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0003: fixes no review point/);
    });
});

describe("check.py review-fix leaves finished work alone", () => {
    const file = (tree: string, name: string) => join(tree, ".craftpath/work", ID, name);

    test("adding no fix task passes the review-fix check", async () => {
        const tree = await fixTasks(point(" ", "R1"), []);

        const { exit, out } = await reviewFix(tree);

        expect(out).toContain("PLAN.md is complete.");
        expect(exit).toBe(0);
    });

    test("an edited finished task file fails the review-fix check", async () => {
        const tree = await fixTasks(point(" ", "R1"), ["R1"]);
        const task = file(tree, "tasks/T-0001.md");
        await Bun.write(task, `${await Bun.file(task).text()}one more line\n`);

        const { exit, out } = await reviewFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0001: .*changed/);
    });

    test("a reopened finished task fails the review-fix check", async () => {
        const tree = await fixTasks(point(" ", "R1"), ["R1"]);
        const plan = file(tree, "PLAN.md");
        await Bun.write(
            plan,
            (await Bun.file(plan).text()).replace("- [x] T-0001", "- [ ] T-0001"),
        );

        const { exit, out } = await reviewFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0001: .*changed/);
    });

    test("an edited review fails the review-fix check", async () => {
        const tree = await fixTasks(point(" ", "R1"), ["R1"]);
        const text = file(tree, "REVIEW.md");
        await Bun.write(
            text,
            (await Bun.file(text).text()).replace("wrong exit code", "exit code is wrong"),
        );

        const { exit, out } = await reviewFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/REVIEW\.md: .*changed/);
    });
});
