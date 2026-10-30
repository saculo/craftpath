/**
 * `/craftpath-verify-fix <work id>`.
 *
 * The guard lets the step start only when VERIFY.md exists, every task is
 * done, and at least one verify point is still open.
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
    HARNESSES,
    head,
    ID,
    installed,
    planned,
    script,
    TREE,
    verify,
    work,
    words,
    worktree,
} from "./kit";

afterAll(cleanScratch);

const verifyWith = (sha: string, points: string) => `# C-00001 — Health endpoint: verify

- **Verified at:** ${sha}

## Points

${points}
`;

const OPEN = "- [ ] F1 [fix] src/app.ts:1 -- given a failing test, the exit code is 0";

describe("/craftpath-verify-fix guard", () => {
    test("verify-fix is refused without a verify record, naming the verify step", async () => {
        const { tree } = await done();
        const before = (await git(tree, "status", "--porcelain")).text();

        const { blocked, reason } = await guard(tree, "verify-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("no VERIFY.md");
        expect(reason).toContain(`/craftpath-verify ${ID}`);
        expect((await git(tree, "status", "--porcelain")).text()).toBe(before);
    });

    test("verify-fix is refused while a task is open, naming it", async () => {
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
        await Bun.write(verify(tree), verifyWith(await head(tree), OPEN));

        const { blocked, reason } = await guard(tree, "verify-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("T-0002");
        expect(reason).toContain("not done");
        expect(reason).not.toContain("T-0001");
    });

    test("verify-fix is refused when every point is closed", async () => {
        const { tree } = await done();
        const sha = await head(tree);
        await Bun.write(
            verify(tree),
            verifyWith(
                sha,
                [
                    `- [x] F1 [fix] src/app.ts:1 -- given a failing test, the exit code is 0 (solved in ${sha})`,
                    "- [-] F2 [fix] README.md:3 -- given a new reader, the wording is vague (won't fix: wording is fine)",
                ].join("\n"),
            ),
        );

        const { blocked, reason } = await guard(tree, "verify-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("no verify point is open");
    });

    test("verify-fix is refused when VERIFY.md has no points", async () => {
        const { tree } = await done();
        await Bun.write(verify(tree), verifyWith(await head(tree), "None"));

        const { blocked, reason } = await guard(tree, "verify-fix", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("no verify point is open");
    });

    test("verify-fix runs once every task is done and a point is open", async () => {
        const { tree } = await done();
        await Bun.write(verify(tree), verifyWith(await head(tree), OPEN));

        expect((await guard(tree, "verify-fix", ID)).blocked).toBe(false);
    });
});

const POINTS = [
    OPEN,
    "- [x] F2 [fix] src/app.ts:2 -- given the rename, the comment is stale (solved in abc1234)",
    "- [-] F3 [fix] README.md:3 -- given a new reader, the wording is vague (won't fix: wording is fine)",
].join("\n");

/** Every file verify-fix must leave as it found it: VERIFY.md, PLAN.md and the task files. */
async function snapshot(tree: string): Promise<Record<string, string>> {
    const dir = join(tree, ".craftpath/work", ID);
    const files = ["VERIFY.md", "PLAN.md"];
    for await (const f of new Bun.Glob("tasks/T-*.md").scan(dir)) files.push(f);
    const out: Record<string, string> = {};
    for (const f of files.sort()) out[f] = await Bun.file(join(dir, f)).text();
    return out;
}

describe("verify-fix.py", () => {
    test("verify-fix.py lists only the open points", async () => {
        const { tree } = await done();
        await Bun.write(verify(tree), verifyWith(await head(tree), POINTS));

        const { exit, out, err } = await script(tree, "verify-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(out).toContain(OPEN);
        expect(out).not.toMatch(/\bR2\b/);
        expect(out).not.toMatch(/\bR3\b/);
    });

    test("verify-fix.py says where the fix tasks go", async () => {
        const root = await planned([
            [1, null],
            [1, null],
            [2, null],
        ]);
        const tree = worktree(root, TREE);
        const plan = join(work(root), "PLAN.md");
        await Bun.write(plan, (await Bun.file(plan).text()).replaceAll("- [ ] T-", "- [x] T-"));
        await Bun.write(verify(tree), verifyWith(await head(tree), OPEN));

        const { exit, out, err } = await script(tree, "verify-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        const lines = out.split("\n").map((l) => l.trim());
        expect(lines).toContain("last task: T-0003");
        expect(lines).toContain("highest wave: 2");
        expect(lines).toContain("fix tasks start at wave 3");
        expect(out).toMatch(/task\.py C-00001 .*--type fix/);
    });

    test("verify-fix.py commits VERIFY.md and writes nothing else", async () => {
        const { tree } = await done();
        await Bun.write(verify(tree), verifyWith(await head(tree), OPEN));
        const before = await head(tree);
        const files = await snapshot(tree);

        const { exit, err } = await script(tree, "verify-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(await commitsSince(tree, before)).toEqual([
            { subject: `docs(${ID}): add verify`, files: [`.craftpath/work/${ID}/VERIFY.md`] },
        ]);
        expect(await snapshot(tree)).toEqual(files);
    });

    test("verify-fix.py makes no commit when VERIFY.md is committed", async () => {
        const { tree } = await done();
        await Bun.write(verify(tree), verifyWith(await head(tree), OPEN));
        await git(tree, "add", verify(tree));
        await git(tree, "commit", "-q", "-m", `docs(${ID}): add verify`);
        const before = await head(tree);

        const { exit, err } = await script(tree, "verify-fix", ID);

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(await head(tree)).toBe(before);
        expect((await git(tree, "status", "--porcelain")).text()).toBe("");
    });

    test("work runs only the fix tasks verify-fix added", async () => {
        const { tree } = await done();
        await Bun.write(verify(tree), verifyWith(await head(tree), OPEN));
        expect((await script(tree, "verify-fix", ID)).exit).toBe(0);

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
                .replace("- **Scenarios:** S1", "- **Scenarios:** S1\n- **Fixes:** F1"),
        );

        const { exit, out, err } = await script(tree, "work", ID, "all");

        expect(err).toBe("");
        expect(exit).toBe(0);
        expect(out).toContain("T-0002");
        expect(out).not.toContain("T-0001");
    });
});

/**
 * C-00001 with T-0001 done, a committed VERIFY.md with the given points, and one
 * new fix task per entry of `fixes`, added by task.py in its own wave: each
 * entry is the task's Fixes value, or null for a task with no Fixes line.
 */
async function fixTasks(points: string, fixes: (string | null)[]): Promise<string> {
    const { tree } = await done();
    const sha = await head(tree);
    await Bun.write(verify(tree), verifyWith(sha, points.replaceAll("<sha>", sha)));
    await git(tree, "add", verify(tree));
    await git(tree, "commit", "-q", "-m", `docs(${ID}): add verify`);
    for (const [i, value] of fixes.entries()) await addFix(tree, `T-000${i + 2}`, i + 2, value);
    return tree;
}

/**
 * A new fix task `id` added by task.py in `wave`, its file filled in: `fixes`
 * is its Fixes value, or null for a task with no Fixes line.
 */
async function addFix(
    tree: string,
    id: string,
    wave: number,
    fixes: string | null,
    touches?: string,
): Promise<void> {
    const added = await script(tree, "task", ID, "--wave", String(wave), "--type", "fix", "Fix it");
    if (added.exit !== 0) throw new Error(added.out + added.err);
    const fixesLine = fixes === null ? "" : `\n- **Fixes:** ${fixes}`;
    await Bun.write(
        join(tree, ".craftpath/work", ID, "tasks", `${id}.md`),
        completeTask(id, wave, "none", touches)
            .replace("- **Type:** feat", "- **Type:** fix")
            .replace("- **Scenarios:** S1", `- **Scenarios:** S1${fixesLine}`),
    );
}

const TWO_MODULES = `[git]
base_branch = "main"

[modules.app]
path = "./"
test = "true"

[modules.docs]
path = "docs"
test = "true"
`;

/**
 * C-00001 with a committed, finished plan whose highest wave is 2 -- T-0001
 * (app) and T-0002 (docs) in wave 1, T-0003 (app) in wave 2, all ticked --
 * and a committed VERIFY.md with the given points.
 */
async function finishedPlan(points: string): Promise<string> {
    const root = await planned([
        [1, null],
        [1, null, "docs/guide.md"],
        [2, null],
    ]);
    const tree = worktree(root, TREE);
    await Bun.write(join(tree, ".craftpath/config.toml"), TWO_MODULES);
    const plan = join(work(root), "PLAN.md");
    await Bun.write(plan, (await Bun.file(plan).text()).replaceAll("- [ ] T-", "- [x] T-"));
    await Bun.write(verify(tree), verifyWith(await head(tree), points));
    await git(tree, "add", "-A");
    await git(tree, "commit", "-q", "-m", `docs(${ID}): finished plan and verify`);
    return tree;
}

const point = (state: " " | "x" | "-", id: string) =>
    state === " "
        ? `- [ ] ${id} [fix] src/app.ts:1 -- given a failing test, the exit code is 0`
        : state === "x"
          ? `- [x] ${id} [fix] src/app.ts:2 -- given the rename, the comment is stale (solved in <sha>)`
          : `- [-] ${id} [fix] README.md:3 -- given a new reader, the wording is vague (won't fix: wording is fine)`;

const verifyFix = (tree: string) => script(tree, "check", "verify-fix", ID);

describe("check.py verify-fix", () => {
    test("fix tasks naming every open point pass the verify-fix check", async () => {
        const tree = await fixTasks([point(" ", "F1"), point(" ", "F2")].join("\n"), ["F1", "F2"]);

        const { exit, out } = await verifyFix(tree);

        expect(out).toContain("PLAN.md is complete.");
        expect(exit).toBe(0);
    });

    test("one fix task may fix several points", async () => {
        const tree = await fixTasks([point(" ", "F1"), point(" ", "F3")].join("\n"), ["F1, F3"]);

        const { exit, out } = await verifyFix(tree);

        expect(out).toContain("PLAN.md is complete.");
        expect(exit).toBe(0);
    });

    test("an open point no new task fixes fails the verify-fix check", async () => {
        const tree = await fixTasks([point(" ", "F1"), point(" ", "F3")].join("\n"), ["F1"]);

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/F3 is open, but no new task fixes it/);
    });

    test("a fix task naming a closed point fails the verify-fix check", async () => {
        for (const closed of [point("x", "F2"), point("-", "F2")]) {
            const tree = await fixTasks([point(" ", "F1"), closed].join("\n"), ["F1, F2"]);

            const { exit, out } = await verifyFix(tree);

            expect(exit).toBe(1);
            expect(out).toMatch(/T-0002: fixes F2, which is not an open verify point/);
        }
        const tree = await fixTasks([point(" ", "F1"), point("-", "F3")].join("\n"), ["F1, F3"]);

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0002: fixes F3, which is not an open verify point/);
    });

    test("a new task without Fixes fails the verify-fix check", async () => {
        const tree = await fixTasks(point(" ", "F1"), ["F1", null]);

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0003: fixes no verify point/);
    });
});

describe("check.py verify-fix leaves finished work alone", () => {
    const file = (tree: string, name: string) => join(tree, ".craftpath/work", ID, name);

    test("adding no fix task passes the verify-fix check", async () => {
        const tree = await fixTasks(point(" ", "F1"), []);

        const { exit, out } = await verifyFix(tree);

        expect(out).toContain("PLAN.md is complete.");
        expect(exit).toBe(0);
    });

    test("an edited finished task file fails the verify-fix check", async () => {
        const tree = await fixTasks(point(" ", "F1"), ["F1"]);
        const task = file(tree, "tasks/T-0001.md");
        await Bun.write(task, `${await Bun.file(task).text()}one more line\n`);

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0001: .*changed/);
    });

    test("a reopened finished task fails the verify-fix check", async () => {
        const tree = await fixTasks(point(" ", "F1"), ["F1"]);
        const plan = file(tree, "PLAN.md");
        await Bun.write(
            plan,
            (await Bun.file(plan).text()).replace("- [x] T-0001", "- [ ] T-0001"),
        );

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0001: .*changed/);
    });

    test("an edited VERIFY.md fails the verify-fix check", async () => {
        const tree = await fixTasks(point(" ", "F1"), ["F1"]);
        const text = file(tree, "VERIFY.md");
        await Bun.write(
            text,
            (await Bun.file(text).text()).replace("the exit code is 0", "it exits 0"),
        );

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/VERIFY\.md: .*changed/);
    });
});

describe("check.py verify-fix follows the finished plan", () => {
    test("fix tasks in waves after the plan pass the verify-fix check", async () => {
        const tree = await finishedPlan([point(" ", "F1"), point(" ", "F2")].join("\n"));
        await addFix(tree, "T-0004", 3, "F1");
        await addFix(tree, "T-0005", 4, "F2");

        const { exit, out } = await verifyFix(tree);

        expect(out).toContain("PLAN.md is complete.");
        expect(exit).toBe(0);
    });

    test("a fix task in a finished wave fails the verify-fix check", async () => {
        const tree = await finishedPlan(point(" ", "F1"));
        await addFix(tree, "T-0004", 2, "F1", "docs/guide.md");

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0004: in wave 2, not after the finished plan's waves/);
    });

    test("a ticked new task fails the verify-fix check", async () => {
        const tree = await fixTasks(point(" ", "F1"), ["F1"]);
        const plan = join(tree, ".craftpath/work", ID, "PLAN.md");
        await Bun.write(
            plan,
            (await Bun.file(plan).text()).replace("- [ ] T-0002", "- [x] T-0002"),
        );

        const { exit, out } = await verifyFix(tree);

        expect(exit).toBe(1);
        expect(out).toMatch(/T-0002: .*ticked/);
    });
});

describe("the installed verify-fix step", () => {
    /** The installed verify-fix skill on each harness, word-normalised, with its harness's step prefix. */
    const skills = async () =>
        (await installed("craftpath-verify-fix")).map((skill, i) => ({
            text: words(skill),
            prefix: HARNESSES[i] === ".pi" ? "/skill:" : "/",
        }));

    /** The sentences of a word-normalised skill. */
    const sentences = (text: string) => text.split(/(?<=[.:])\s+(?=[A-Z`*])/);

    test("verify-fix is installed on both harnesses, running the same script and check", async () => {
        for (const { text } of await skills()) {
            expect(text).toContain("python3 .craftpath/scripts/verify-fix.py");
            expect(text).toContain("python3 .craftpath/scripts/check.py verify-fix");
        }
    });

    test("verify-fix adds fix tasks and stops, pointing to work", async () => {
        for (const { text, prefix } of await skills()) {
            expect(text).toContain(
                "python3 .craftpath/scripts/task.py <work id> --wave <n> --type fix",
            );
            const forbidden = sentences(text).find(
                (s) => s.includes("`complete.py`") && /\bnot\b/i.test(s),
            );
            expect(forbidden).toBeDefined();
            expect(forbidden).toContain(`\`${prefix}craftpath-work\``);
            expect(text).toContain(`\`${prefix}craftpath-work <work id> all\``);
        }
    });

    test("verify-fix keeps untestable points out of tasks of their own", async () => {
        for (const { text } of await skills()) {
            const ridesAlong = sentences(text).find((s) => s.includes("untestable point"));
            expect(ridesAlong).toBeDefined();
            expect(ridesAlong).toContain("`Fixes`");
            expect(ridesAlong).toContain("task for a testable point");
            expect(ridesAlong).toContain("never in a task of its own");
            const onlyUntestable = sentences(text).find((s) =>
                s.includes("only untestable points"),
            );
            expect(onlyUntestable).toBeDefined();
            expect(onlyUntestable).toContain("add no task");
            expect(onlyUntestable).toContain("fix them by hand");
            expect(onlyUntestable).toContain("mark them won't fix");
        }
    });
});
