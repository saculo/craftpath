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
import { readdir } from "node:fs/promises";
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

    test("S3 a passing module check runs after the tests, before VERIFY.md is created", async () => {
        const { tree } = await done();
        const config = join(tree, ".craftpath/config.toml");
        await Bun.write(
            config,
            (await Bun.file(config).text()).replace(
                'test = "grep -q ok src/app.ts || (echo app is broken; exit 3)"',
                'test = "echo test passed"\ncheck = "echo check passed"',
            ),
        );
        await git(tree, "add", config);
        await git(tree, "commit", "-q", "-m", "chore: add passing module check");

        const { exit, out, err } = await script(tree, "verify", ID);

        expect(exit).toBe(0);
        expect(err).toBe("");
        expect(out.indexOf("test passed")).toBeGreaterThanOrEqual(0);
        expect(out.indexOf("test passed")).toBeLessThan(out.indexOf("check passed"));
        expect(await Bun.file(verify(tree)).exists()).toBe(true);
    });

    test("S3 a module check red leaves an existing VERIFY.md unchanged", async () => {
        const { tree } = await done();
        const config = join(tree, ".craftpath/config.toml");
        const original = "# existing verify\n";
        await Bun.write(verify(tree), original);
        await Bun.write(
            config,
            `${await Bun.file(config).text()}check = "echo check failed; exit 1"\n`,
        );
        await git(tree, "add", config, verify(tree));
        await git(tree, "commit", "-q", "-m", "chore: add failing module check");
        const before = await head(tree);

        const { exit, out, err } = await script(tree, "verify", ID);

        expect(exit).toBe(1);
        expect(out + err).toContain("check failed");
        expect(await Bun.file(verify(tree)).text()).toBe(original);
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
            "- [ ] F1 [fix] src/app.ts:1 -- given the API is down, health still says ok",
            `- [x] F2 [fix] src/app.ts:1 -- given no body, health throws (solved in ${older.slice(0, 7)})`,
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
        expect(out).toContain("F1 [fix]");
        expect(out).not.toContain("F2 [fix]");
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

    test("S7 the diff it prints for the finder leaves DECISIONS.md out", async () => {
        const { tree } = await done();
        await Bun.write(
            join(tree, ".craftpath/work", ID, "DECISIONS.md"),
            "# C-00001 — decisions\n\n## T-0001\n\n- Named it `health`.\n",
        );

        const { exit, out } = await script(tree, "verify", ID);

        expect(exit).toBe(0);
        const command = out.match(/^Diff: (git diff .+)$/m)?.[1] ?? "";
        expect(command).toContain(`..${await head(tree)} `);
        const diff = (await Bun.$`sh -c ${command}`.cwd(tree).quiet()).text();
        expect(diff).toContain("diff --git");
        expect(diff).not.toContain("DECISIONS.md");
        expect(diff).not.toContain("Named it");
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
            "- [ ] F1 [fix] src/app.ts:1 -- given the API is down, health still says ok",
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
            "- [ ] F1 [fix] src/a.ts:12 -- given an empty list, total() returns NaN instead of 0",
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
        const tree = await withVerify("- [ ] F1 [fix] src/a.ts:12 -- total() is wrong");

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(exit).toBe(1);
        expect(out).toContain("F1 has no failure scenario");
        expect(out).not.toContain("F1 has no file:line");
    });

    test("S6 names a point without a file:line by id", async () => {
        const tree = await withVerify(
            "- [ ] F2 [fix] src/a.ts -- given an empty list, total() returns NaN",
        );

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(exit).toBe(1);
        expect(out).toContain("F2 has no file:line");
        expect(out).not.toContain("F2 has no failure scenario");
    });

    test("check verify accepts the fix, you and noted categories", async () => {
        const where = "src/a.ts:12 -- given an empty list, total() returns NaN";
        const tree = await withVerify(
            [`- [ ] F1 [fix] ${where}`, `- [ ] F2 [you] ${where}`, `- [ ] F3 [noted] ${where}`].join(
                "\n",
            ),
        );

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(out).toContain("VERIFY.md is complete.");
        expect(exit).toBe(0);
    });

    test("check verify rejects the major and minor tags", async () => {
        for (const tag of ["major", "minor"]) {
            const line = `- [ ] F1 [${tag}] src/a.ts:3 -- given x, y`;
            const tree = await withVerify(line);

            const { exit, out } = await script(tree, "check", "verify", ID);

            expect(exit).toBe(1);
            expect(out).toContain(`not a point: ${line}`);
            expect(out).toContain("[fix|you|noted]");
        }
    });

    test("check verify rejects a point without a category", async () => {
        for (const tag of ["", " [later]"]) {
            const line = `- [ ] F1${tag} src/a.ts:3 -- given x, y`;
            const tree = await withVerify(line);
            const before = await head(tree);

            const { exit, out } = await script(tree, "check", "verify", ID);

            expect(exit).toBe(1);
            expect(out).toContain(`not a point: ${line}`);
            expect(await head(tree)).toBe(before);
        }
    });

    test("the verify template names the three categories", async () => {
        const { tree } = await done();

        const template = await Bun.file(join(tree, ".craftpath/templates/VERIFY.md")).text();

        expect(template).toContain("[fix|you|noted]");
        expect(template).not.toContain("major|minor");
    });

    test("names a review-style id, a duplicate, an unsolved [x] and a reasonless [-]", async () => {
        const scenario = "given an empty list, total() returns NaN";
        const tree = await withVerify(
            [
                `- [ ] R1 [fix] src/a.ts:1 -- ${scenario}`,
                `- [ ] F3 [fix] src/a.ts:2 -- ${scenario}`,
                `- [ ] F3 [fix] src/a.ts:3 -- ${scenario}`,
                `- [x] F4 [fix] src/a.ts:4 -- ${scenario}`,
                `- [-] F5 [fix] src/a.ts:5 -- ${scenario}`,
            ].join("\n"),
        );

        const { exit, out } = await script(tree, "check", "verify", ID);

        expect(exit).toBe(1);
        expect(out).toContain(`not a point: - [ ] R1 [fix] src/a.ts:1 -- ${scenario}`);
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
            for (const reads of ["`SPEC.md`", "`PLAN.md`", "task files", "`<diff command>`"])
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

    test("S8 the report leaves out the findings the refuter refuted", async () => {
        for (const skill of await installed("craftpath-verify")) {
            const report = parts(skill).step.split("Stop. Report")[1] ?? "";
            expect(report).toContain("the points you added");
            expect(report).not.toContain("refut");
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

describe("DECISIONS.md is written by work, committed by verify and read by learn and pr", () => {
    test("only verify, learn and pr name DECISIONS.md among the scripts", async () => {
        const dir = new URL("../../assets/scripts", import.meta.url).pathname;
        const naming = [];
        for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
            if (!entry.isFile()) continue;
            const path = join(entry.parentPath, entry.name);
            if ((await Bun.file(path).text()).includes("DECISIONS.md"))
                naming.push(path.slice(dir.length + 1));
        }

        expect(naming.sort()).toEqual(["learn.py", "pr.py", "verify.py"]);
    });
});
