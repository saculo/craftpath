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
import { init } from "../../src/init";
import { cleanScratch } from "../scratch";
import {
    commitsSince,
    done,
    git,
    guard,
    HARNESSES,
    head,
    ID,
    installed,
    plannedOne,
    project,
    quietly,
    script,
    verify,
    words,
    work,
} from "./kit";

afterAll(cleanScratch);

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

describe("verify.py -- tests first, then VERIFY.md", () => {
    test("S3 with a module's tests red, exits 1 with their output and creates no VERIFY.md", async () => {
        const { tree } = await done();
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'down';\n");
        await git(tree, "commit", "-q", "-am", "fix: break it");
        const before = await head(tree);

        const { exit, out, err } = await script(tree, "verify", ID);

        expect(exit).toBe(1);
        expect(out + err).toContain("app is broken");
        expect(await Bun.file(verify(tree)).exists()).toBe(false);
        expect(await head(tree)).toBe(before);
    });

    test("S3 with a module check red, exits 1 and neither writes nor commits", async () => {
        const { tree } = await done();
        const config = join(tree, ".craftpath/config.toml");
        await Bun.write(
            config,
            `${await Bun.file(config).text()}check = "echo check failed; exit 1"\n`,
        );
        await git(tree, "add", config);
        await git(tree, "commit", "-q", "-m", "chore: add failing module check");
        const before = await head(tree);

        const { exit, out, err } = await script(tree, "verify", ID);

        expect(exit).toBe(1);
        expect(out + err).toContain("check failed");
        expect(await Bun.file(verify(tree)).exists()).toBe(false);
        expect(await head(tree)).toBe(before);
    });

    test("S4 without VERIFY.md, creates it verified at HEAD and says what to verify", async () => {
        const { tree } = await done();
        const base = (await git(tree, "merge-base", "main", "HEAD")).text().trim();
        const sha = await head(tree);

        const { exit, out } = await script(tree, "verify", ID);

        expect(exit).toBe(0);
        const text = await Bun.file(verify(tree)).text();
        expect(text).toStartWith("# C-00001 — Health endpoint: verify");
        expect(text).toContain(`- **Verified at:** ${sha}`);
        expect(out).toContain(verify(tree));
        expect(out).toContain(`${base.slice(0, 7)}..${sha.slice(0, 7)}`);
        expect(out).toContain("feat(C-00001/T-0001): Add GET /health");
        expect(out).toContain("src/app.ts");
        expect(out).toContain("Open points: none");
        expect(out).toContain("next point: F1");
        expect(await Bun.file(join(tree, ".craftpath/work", ID, "REVIEW.md")).exists()).toBe(false);
    });

    test("S5 a re-run keeps every point, moves Verified at to HEAD and gives F3", async () => {
        const { tree } = await done();
        const older = await head(tree);
        const points = [
            "- [ ] F1 [major] src/app.ts:1 -- given the API is down, health still says ok",
            `- [x] F2 [minor] src/app.ts:1 -- given no body, health throws (solved in ${older.slice(0, 7)})`,
        ].join("\n");
        await Bun.write(
            verify(tree),
            `# C-00001 — Health endpoint: verify\n\n- **Verified at:** ${older}\n\n## Points\n\n${points}\n`,
        );
        await git(tree, "add", "-A");
        await git(tree, "commit", "-q", "-m", "docs: an earlier verify");

        const { exit, out } = await script(tree, "verify", ID);

        expect(exit).toBe(0);
        const text = await Bun.file(verify(tree)).text();
        expect(text).toContain(points);
        expect(text).toContain(`- **Verified at:** ${await head(tree)}`);
        expect(text).not.toContain(older);
        expect(out).toContain("F1 [major]");
        expect(out).not.toContain("F2 [minor]");
        expect(out).toContain("next point: F3");
    });

    test("commits an uncommitted DECISIONS.md alone before verifying", async () => {
        const { tree } = await done();
        const decisions = join(tree, ".craftpath/work", ID, "DECISIONS.md");
        await Bun.write(decisions, "# C-00001 — decisions\n\n## T-0001\n\n- Named it `health`.\n");
        const before = await head(tree);

        const { exit, out } = await script(tree, "verify", ID);

        expect(exit).toBe(0);
        expect(await commitsSince(tree, before)).toEqual([
            {
                subject: "docs(C-00001): add decisions",
                files: [".craftpath/work/C-00001/DECISIONS.md"],
            },
        ]);
        expect(out).not.toContain(decisions);
    });

    test("commits a VERIFY.md with no open point as the verify record", async () => {
        const { tree } = await done();
        await script(tree, "verify", ID);
        const before = await head(tree);
        const record = (points: string) =>
            Bun.write(
                verify(tree),
                `# C-00001 — Health endpoint: verify\n\n- **Verified at:** ${before}\n\n## Points\n\n${points}\n`,
            );
        await record("None");
        expect(await script(tree, "check", "verify", ID)).toMatchObject({ exit: 0 });

        expect(await script(tree, "verify", ID)).toMatchObject({ exit: 0 });

        expect(await head(tree)).not.toBe(before);
        expect((await git(tree, "log", "-1", "--format=%s")).text().trim()).toBe(
            "docs(C-00001): add verify",
        );

        const closed = await head(tree);
        await record(
            "- [ ] F1 [major] src/app.ts:1 -- given the API is down, health still says ok",
        );
        expect(await script(tree, "verify", ID)).toMatchObject({ exit: 0 });
        expect(await head(tree)).toBe(closed);
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

/** The installed verify step split into what the step does, the finder's brief and the refuter's. */
function parts(skill: string): { step: string; finder: string; refuter: string } {
    const [step = "", rest = ""] = skill.split("## The finder's brief");
    const [finder = "", refuter = ""] = rest.split("## The refuter's brief");
    return { step: words(step), finder: words(finder), refuter: words(refuter) };
}

describe("the verify step -- find, then refute", () => {
    test("S7 the finder reads the spec, plan, tasks and diff, never DECISIONS.md", async () => {
        for (const skill of await installed("craftpath-verify")) {
            const { step, finder } = parts(skill);
            expect(step).toContain("Start one finder");
            for (const reads of ["`SPEC.md`", "`PLAN.md`", "task files", "`git diff <range>`"])
                expect(finder).toContain(reads);
            for (const states of ["input or state", "what goes wrong", "`file:line`"])
                expect(finder).toContain(states);
            expect(skill).not.toContain("DECISIONS.md");
        }
    });

    test("S7 the refuter gets only the findings and the worktree, and may run the code", async () => {
        for (const skill of await installed("craftpath-verify")) {
            const { step, refuter } = parts(skill);
            expect(step).toContain("start a second subagent, in a fresh context");
            expect(step).toContain("only the finder's findings, verbatim, and the worktree");
            for (const does of ["refute", "reading the code", "running it", "throwaway test"])
                expect(refuter).toContain(does);
            expect(refuter).toContain("delete every test you wrote");
            for (const withheld of ["SPEC.md", "PLAN.md", "task file"])
                expect(refuter).not.toContain(withheld);
        }
    });

    test("S8 only findings the refuter could not refute become points", async () => {
        for (const skill of await installed("craftpath-verify")) {
            const { step, finder } = parts(skill);
            expect(step).toContain(
                "Add only the findings the refuter could not refute as new points",
            );
            expect(step).toContain(
                "`- [ ] F<n> [major|minor] <file:line> -- given <input or state>, <what goes wrong>`",
            );
            expect(step).toContain(
                "A refuted finding, and a finding without a failure scenario, is written into no file",
            );
            for (const text of [step, finder])
                expect(text).toContain("Style, naming and formatting are never findings");
        }
    });
});

describe("the verify step's finder and refuter settings", () => {
    /** A `claude-code,pi` project re-initialised with `steps` added to its config.toml. */
    async function configuredWith(steps: string): Promise<[string, string]> {
        const root = await project({ harness: "claude-code,pi" });
        const config = join(root, ".craftpath/config.toml");
        await Bun.write(config, `${await Bun.file(config).text()}\n${steps}`);
        await quietly(() => init(root, ["--harness", "claude-code,pi"]));
        const [claude = "", pi = ""] = await Promise.all(
            HARNESSES.map((dir) =>
                Bun.file(join(root, dir, "skills/craftpath-verify/SKILL.md")).text(),
            ),
        );
        return [claude, pi];
    }

    const WORK = [
        "[steps.work.claude-code]",
        'model = "sonnet"',
        "[steps.work.pi]",
        'model = "openai-codex/gpt-5.6-terra"',
        "",
    ].join("\n");
    const frontmatter = (skill: string) => skill.split("---\n")[1]!.split("\n");
    const count = (text: string, part: string) => text.split(part).length - 1;

    test("S9 finder and refuter both start with verify's model and effort, never work's", async () => {
        const [claude, pi] = await configuredWith(
            [
                WORK,
                "[steps.verify.claude-code]",
                'model = "opus"',
                'effort = "high"',
                "[steps.verify.pi]",
                'model = "anthropic/claude-opus-5-5"',
                'effort = "high"',
                "",
            ].join("\n"),
        );

        expect(count(claude, "model `opus`, effort `high`")).toBe(2);
        expect(claude).not.toContain("sonnet");
        expect(
            frontmatter(claude).filter((l) => /^(model:|effort:|context: fork)/.test(l)),
        ).toEqual([]);
        expect(count(pi, "model `anthropic/claude-opus-5-5`, thinking level `high`")).toBe(2);
        expect(pi).not.toContain("gpt-5.6-terra");
    });

    test("S10 without verify settings, finder and refuter run on the session model", async () => {
        const [claude, pi] = await configuredWith(WORK);

        for (const skill of [claude, pi])
            for (const named of ["model `", "effort `", "thinking level `"])
                expect(skill).not.toContain(named);
        expect(frontmatter(claude).filter((l) => /^(model|effort):/.test(l))).toEqual([]);
    });
});
