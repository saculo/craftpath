/**
 * Step 4a: `/craftpath-review <work id>`.
 *
 * The guard checks every task is done and committed and the code is
 * committed; `review.py` runs every module's tests, creates or reuses
 * REVIEW.md and says what to review; `check.py review` is REVIEW.md's
 * completeness check, which `/craftpath-pr`'s guard applies.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import {
    commitsSince,
    done,
    git,
    guard,
    head,
    ID,
    plannedOne,
    review,
    script,
    work,
    installed,
    words,
} from "./kit";

afterAll(cleanScratch);

describe("/craftpath-review guard", () => {
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

    test("V3 lets a modified existing review through", async () => {
        const { tree } = await done();
        await script(tree, "review", ID);
        await git(tree, "add", "-A");
        await git(tree, "commit", "-q", "-m", "docs: add review");
        await Bun.write(review(tree), "# revised review\n");

        expect((await guard(tree, "review", ID)).blocked).toBe(false);
    });
});

describe("/craftpath-review guard on pi", () => {
    test("the packages pi installs into the worktree are not changes the guard refuses", async () => {
        const { tree } = await done("pi");
        // What pi writes when it installs a project's packages on its first run in a worktree.
        for (const kind of ["npm", "git"]) {
            await Bun.write(join(tree, `.pi/${kind}/.gitignore`), "*\n!.gitignore\n");
        }
        await Bun.write(
            join(tree, ".pi/npm/package.json"),
            '{"name":"pi-extensions","private":true}\n',
        );
        await Bun.write(
            join(tree, ".pi/npm/node_modules/pi-subagents-lite/index.js"),
            "export {};\n",
        );
        await Bun.write(join(tree, ".pi/git/github.com/o/ext/index.ts"), "export {};\n");

        expect((await git(tree, "status", "--porcelain")).text()).toBe("");
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

    test("commits a completed review automatically", async () => {
        const { tree } = await done();
        await script(tree, "review", ID);
        const before = await head(tree);
        await Bun.write(
            review(tree),
            `# C-00001 — Health endpoint: review\n\n- **Reviewed at:** ${before}\n\n## Points\n\nNone\n`,
        );

        const { exit } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        expect(await head(tree)).not.toBe(before);
        expect((await git(tree, "log", "-1", "--format=%s")).text().trim()).toBe(
            "docs(C-00001): add review",
        );
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
    const decisions = (tree: string) => join(tree, ".craftpath/work", ID, "DECISIONS.md");
    const DECISIONS =
        "# C-00001 — decisions\n\n## T-0001\n\n- Named the field `health`: the spec says nothing.\n";
    const status = async (tree: string) => (await git(tree, "status", "--porcelain")).text();

    test("commits an uncommitted DECISIONS.md alone as the decisions", async () => {
        const { tree } = await done();
        await Bun.write(decisions(tree), DECISIONS);
        await Bun.write(join(tree, ".craftpath/work", ID, "scratch.txt"), "mine\n");
        const before = await head(tree);

        const { exit, out } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        expect(await commitsSince(tree, before)).toEqual([
            {
                subject: "docs(C-00001): add decisions",
                files: [".craftpath/work/C-00001/DECISIONS.md"],
            },
        ]);
        expect(out).toContain("docs(C-00001): add decisions");
        const left = await status(tree);
        expect(left).toContain(".craftpath/work/C-00001/scratch.txt");
        expect(left).toContain(".craftpath/work/C-00001/REVIEW.md");
        expect(left).not.toContain("DECISIONS.md");
    });

    test("with tests red, leaves DECISIONS.md uncommitted", async () => {
        const { tree } = await done();
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'down';\n");
        await git(tree, "commit", "-q", "-am", "fix: break it");
        await Bun.write(decisions(tree), DECISIONS);
        const before = await head(tree);

        const { exit } = await script(tree, "review", ID);

        expect(exit).toBe(1);
        expect(await head(tree)).toBe(before);
        expect(await status(tree)).toContain(".craftpath/work/C-00001/DECISIONS.md");
    });

    test("without DECISIONS.md, makes no decisions commit", async () => {
        const { tree } = await done();

        const { exit } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        expect((await git(tree, "log", "--format=%s")).text()).not.toContain(
            "docs(C-00001): add decisions",
        );
    });

    test("with DECISIONS.md already committed, makes no decisions commit", async () => {
        const { tree } = await done();
        await Bun.write(decisions(tree), DECISIONS);
        await git(tree, "add", decisions(tree));
        await git(tree, "commit", "-q", "-m", "docs: decisions by hand");
        const before = await head(tree);

        const { exit } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        expect(await head(tree)).toBe(before);
    });

    /** The line printed directly after the `  plan:` line. */
    const afterPlan = (out: string) => {
        const lines = out.split("\n");
        return lines[lines.findIndex((line) => line.startsWith("  plan:")) + 1];
    };

    test("names DECISIONS.md among what to review, next to the spec and the plan", async () => {
        const { tree } = await done();
        await Bun.write(decisions(tree), DECISIONS);
        const before = await head(tree);

        const { exit, out } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        expect(afterPlan(out)).toBe(`  decisions: ${decisions(tree)}`);
        expect(await commitsSince(tree, before)).toEqual([
            {
                subject: "docs(C-00001): add decisions",
                files: [".craftpath/work/C-00001/DECISIONS.md"],
            },
        ]);
    });

    test("names an already committed DECISIONS.md again on a re-review", async () => {
        const { tree } = await done();
        await Bun.write(decisions(tree), DECISIONS);
        await script(tree, "review", ID);
        const before = await head(tree);

        const { exit, out } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        expect(afterPlan(out)).toBe(`  decisions: ${decisions(tree)}`);
        expect(await head(tree)).toBe(before);
    });

    test("without DECISIONS.md, names none and creates none", async () => {
        const { tree } = await done();

        const { exit, out, err } = await script(tree, "review", ID);

        expect(exit).toBe(0);
        expect(await Bun.file(review(tree)).exists()).toBe(true);
        expect(out).toContain("  spec:");
        expect(out).toContain("  plan:");
        expect(out).not.toContain("DECISIONS.md");
        expect(err).toBe("");
        expect(await Bun.file(decisions(tree)).exists()).toBe(false);
    });
});

describe("DECISIONS.md is written by work, committed by review and read by learn", () => {
    test("only review, learn and pr name DECISIONS.md among the scripts", async () => {
        const dir = new URL("../../assets/scripts", import.meta.url).pathname;
        const naming = [];
        for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile()) continue;
            const path = join(entry.parentPath, entry.name);
            if ((await Bun.file(path).text()).includes("DECISIONS.md"))
                naming.push(path.slice(dir.length + 1));
        }

        expect(naming.sort()).toEqual(["learn.py", "pr.py", "review.py"]);
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

describe("review checks recorded decisions", () => {
    /** The installed review skill on each harness. */
    const skills = () => installed("craftpath-review");

    /** The step's numbered instructions, word-normalised. */
    const instructions = (skill: string) =>
        (skill.split("## How to review")[0] ?? "").split(/\n[ \t]*\d+\.[ \t]/).map(words);

    /** The paragraphs and bullets of *How to review*, word-normalised. */
    const guidance = (skill: string) =>
        (skill.split("## How to review")[1] ?? "")
            .split(/\n[ \t]*\n|\n(?=- )/)
            .map(words)
            .filter((p) => p !== "");

    test("review reads DECISIONS.md alongside the spec, the plan and the task files", async () => {
        for (const skill of await skills()) {
            const reading = instructions(skill).find(
                (i) =>
                    i.includes("`SPEC.md`") && i.includes("`PLAN.md`") && i.includes("task files"),
            );
            expect(reading).toBeDefined();
            expect(reading).toContain("`DECISIONS.md`");
            expect(reading).toContain("when it exists");
            expect(reading).toContain("no other file -- only `REVIEW.md`");
        }
    });

    test("review may raise any recorded decision as an ordinary point", async () => {
        for (const skill of await skills()) {
            const decisions = guidance(skill).filter((p) => p.includes("`DECISIONS.md`"));
            expect(decisions).toHaveLength(1);
            const [text] = decisions as [string];
            for (const phrase of [
                "decision",
                "wrong for the spec or the code",
                "point",
                "the code the decision shaped",
                "`DECISIONS.md:<line>`",
                "`major`",
                "`minor`",
            ])
                expect(text).toContain(phrase);
        }
    });

    test("review does not raise a missing DECISIONS.md as a point", async () => {
        for (const skill of await skills()) {
            const decisions = guidance(skill).filter((p) => p.includes("`DECISIONS.md`"));
            expect(decisions).toHaveLength(1);
            expect(decisions[0]).toContain("missing");
            expect(decisions[0]).toMatch(/\bnot\b.*\ba point\b/);
        }
    });
});
