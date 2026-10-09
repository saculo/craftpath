/**
 * Step 2: `/craftpath:design` (optional) and `/craftpath:plan`.
 *
 * Each step's guard refuses until its inputs are complete; its script creates
 * the step's file from the template; `task.py` adds one task file per task and
 * lists it under its wave in PLAN.md; `check.py` is the completeness check the
 * guards use and each step runs on its own output before it ends.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import {
    COMPLETE_SPEC,
    commitsSince,
    git,
    guard,
    ID,
    planned,
    project,
    script,
    TREE,
    withSpec,
    work,
    worktree,
} from "./kit";

afterAll(cleanScratch);

const COMPLETE_DESIGN = `# C-00001 — Health endpoint: design

## Context

S1 needs a route that bypasses authentication.

## Decisions

### D1 — Where the route lives

- **Options:** inside the API router; a separate server
- **Chosen:** inside the API router -- one process to deploy
- **Rejected:** a separate server -- a second port to open

## Boundaries

src/app.ts only.

## Risks

None
`;

const check = (cwd: string, step: string, id = ID) => script(cwd, "check", step, id);

describe("work item ids in step commands", () => {
    test("a missing id is refused", async () => {
        const { blocked, reason } = await guard(await withSpec(), "plan", "");

        expect(blocked).toBe(true);
        expect(reason).toContain("/craftpath-plan <work id>");
    });

    test("an unknown id is refused, listing the open work items", async () => {
        const { blocked, reason } = await guard(await withSpec(), "plan", "C-00042");

        expect(blocked).toBe(true);
        expect(reason).toContain("C-00042");
        expect(reason).toContain("C-00001");
    });
});

describe("check.py spec -- what 'complete' means for SPEC.md", () => {
    test("the untouched template is incomplete, and every problem is named", async () => {
        const root = await project();
        await script(root, "spec", "Health endpoint");

        const { exit, out } = await check(root, "spec");

        expect(exit).toBe(1);
        expect(out).toContain("guidance comment");
        expect(out).toContain("<name>");
        expect(out).toContain("Open questions");
    });

    test("a scenario without When is named", async () => {
        const root = await withSpec(
            COMPLETE_SPEC.replace("- **When** a client sends GET /health\n", ""),
        );

        const { exit, out } = await check(root, "spec");

        expect(exit).toBe(1);
        expect(out).toContain("S1");
        expect(out).toContain("When");
    });

    test("unresolved open questions are named", async () => {
        const root = await withSpec(COMPLETE_SPEC.replace("None\n", "- Which port?\n"));

        const { exit, out } = await check(root, "spec");

        expect(exit).toBe(1);
        expect(out).toContain("Which port?");
    });

    test("a complete spec passes, from the main checkout or the worktree", async () => {
        const root = await withSpec();

        expect((await check(root, "spec")).exit).toBe(0);
        expect((await check(worktree(root, TREE), "spec")).exit).toBe(0);
    });
});

describe("/craftpath:design", () => {
    test("is refused while SPEC.md is incomplete, saying why", async () => {
        const { blocked, reason } = await guard(
            await withSpec(COMPLETE_SPEC.replace("None\n", "- Which port?\n")),
            "design",
            ID,
        );

        expect(blocked).toBe(true);
        expect(reason).toContain("SPEC.md");
        expect(reason).toContain("Which port?");
    });

    test("creates DESIGN.md from the template, and leaves an existing one alone", async () => {
        const root = await withSpec();
        expect((await guard(root, "design", ID)).blocked).toBe(false);

        const first = await script(root, "design", ID);
        const file = join(work(root), "DESIGN.md");
        await Bun.write(file, COMPLETE_DESIGN);
        const second = await script(root, "design", ID);

        expect(first.exit).toBe(0);
        expect(first.out).toContain(file);
        expect(second.out).toContain("already exists");
        expect(await Bun.file(file).text()).toBe(COMPLETE_DESIGN);
    });
});

describe("each step commits the file of the step before it (11.5)", () => {
    test("K1 plan.py commits SPEC.md and DESIGN.md, one commit each, before it writes PLAN.md", async () => {
        const root = await withSpec();
        await Bun.write(join(work(root), "DESIGN.md"), COMPLETE_DESIGN);
        const tree = worktree(root, TREE);
        const before = (await git(tree, "rev-parse", "HEAD")).text().trim();

        await script(root, "plan", ID);

        expect(await commitsSince(tree, before)).toEqual([
            { subject: "docs(C-00001): add spec", files: [".craftpath/work/C-00001/SPEC.md"] },
            { subject: "docs(C-00001): add design", files: [".craftpath/work/C-00001/DESIGN.md"] },
        ]);
        expect((await git(tree, "status", "--porcelain")).text()).toContain("PLAN.md");
    });

    test("K2 design.py commits SPEC.md before it writes DESIGN.md", async () => {
        const root = await withSpec();
        const tree = worktree(root, TREE);
        const before = (await git(tree, "rev-parse", "HEAD")).text().trim();

        await script(root, "design", ID);

        expect(await commitsSince(tree, before)).toEqual([
            { subject: "docs(C-00001): add spec", files: [".craftpath/work/C-00001/SPEC.md"] },
        ]);
    });

    test("K4 a step whose input files are already committed makes no commit", async () => {
        const root = await withSpec();
        await script(root, "design", ID);
        const tree = worktree(root, TREE);
        const before = (await git(tree, "rev-parse", "HEAD")).text().trim();

        await script(root, "design", ID);

        expect(await commitsSince(tree, before)).toEqual([]);
    });
});

describe("/craftpath:plan", () => {
    test("is refused while SPEC.md is incomplete", async () => {
        const root = await project();
        await script(root, "spec", "Health endpoint");

        const { blocked, reason } = await guard(root, "plan", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("SPEC.md");
    });

    test("is refused while an existing DESIGN.md is incomplete", async () => {
        const root = await withSpec();
        await script(root, "design", ID);

        const { blocked, reason } = await guard(root, "plan", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("DESIGN.md");
    });

    test("with a complete spec, plan.py creates PLAN.md", async () => {
        const root = await withSpec();
        expect((await guard(root, "plan", ID)).blocked).toBe(false);

        const { exit, out } = await script(root, "plan", ID);

        expect(exit).toBe(0);
        expect(out).toContain(join(work(root), "PLAN.md"));
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toStartWith(
            "# C-00001 — Health endpoint: plan",
        );
    });

    test("task.py numbers tasks, writes each from the template and lists it under its wave", async () => {
        const root = await withSpec();
        await script(root, "plan", ID);

        await script(root, "task", ID, "--wave", "1", "Add GET /health");
        await script(root, "task", ID, "--wave", "2", "Document the endpoint");
        const third = await script(root, "task", ID, "--wave", "1", "Exempt /health from auth");

        expect(third.out).toContain(join(work(root), "tasks/T-0003.md"));
        const task = await Bun.file(join(work(root), "tasks/T-0003.md")).text();
        expect(task).toStartWith("# T-0003 — Exempt /health from auth");
        expect(task).toContain("- **Wave:** 1");
        const plan = await Bun.file(join(work(root), "PLAN.md")).text();
        // The structure task.py maintains: wave headings in order, each task
        // under its own wave, in the order added.
        const structure = plan
            .slice(plan.indexOf("## Tasks"))
            .split("\n")
            .filter((line) => /^(### Wave \d+|- \[[ x]\] T-\d{4} — .+)$/.test(line));
        expect(structure).toEqual([
            "### Wave 1",
            "- [ ] T-0001 — Add GET /health",
            "- [ ] T-0003 — Exempt /health from auth",
            "### Wave 2",
            "- [ ] T-0002 — Document the endpoint",
        ]);
    });
});

describe("check.py plan -- what 'complete' means for a plan", () => {
    test("a complete plan passes", async () => {
        expect(
            await check(
                await planned([
                    [1, null],
                    [2, "T-0001"],
                ]),
                "plan",
            ),
        ).toMatchObject({ exit: 0 });
    });

    test("an untouched task file is named with what is missing", async () => {
        const root = await withSpec();
        await script(root, "plan", ID);
        await script(root, "task", ID, "--wave", "1", "Add GET /health");

        const { exit, out } = await check(root, "plan");

        expect(exit).toBe(1);
        expect(out).toContain("T-0001");
        expect(out).toContain("Type");
    });

    test("a criterion not proven by an integration or e2e test is named", async () => {
        const root = await planned([[1, null]]);
        const file = join(work(root), "tasks/T-0001.md");
        await Bun.write(
            file,
            (await Bun.file(file).text()).replace("integration test", "unit test"),
        );

        const { exit, out } = await check(root, "plan");

        expect(exit).toBe(1);
        expect(out).toContain("A1");
        expect(out).toContain("integration or e2e");
    });

    test("a task depending on a task in the same or a later wave is named", async () => {
        const { exit, out } = await check(
            await planned([
                [1, null],
                [1, "T-0001"],
            ]),
            "plan",
        );

        expect(exit).toBe(1);
        expect(out).toContain("T-0002");
        expect(out).toContain("earlier wave");
    });

    test("a task naming a scenario SPEC.md does not have is named", async () => {
        const root = await planned([[1, null]]);
        const file = join(work(root), "tasks/T-0001.md");
        await Bun.write(
            file,
            (await Bun.file(file).text()).replace("**Scenarios:** S1", "**Scenarios:** S1, S9"),
        );

        const { exit, out } = await check(root, "plan");

        expect(exit).toBe(1);
        expect(out).toContain("S9");
    });
});

describe("the step skills", () => {
    const read = (root: string, path: string) => Bun.file(join(root, path)).text();

    test("plan and design start by running their script, and plan adds tasks with task.py", async () => {
        const root = await project();
        const plan = await read(root, ".claude/skills/craftpath-plan/SKILL.md");
        const design = await read(root, ".claude/skills/craftpath-design/SKILL.md");

        expect(plan).toContain('python3 .craftpath/scripts/plan.py "$ARGUMENTS"');
        expect(plan).toContain("python3 .craftpath/scripts/task.py");
        expect(design).toContain('python3 .craftpath/scripts/design.py "$ARGUMENTS"');
        expect(plan + design).not.toContain("{{");
    });

    test("every step ends by checking its own output", async () => {
        const root = await project();
        for (const step of ["spec", "design", "plan", "review"]) {
            expect(await read(root, `.claude/skills/craftpath-${step}/SKILL.md`)).toContain(
                `python3 .craftpath/scripts/check.py ${step}`,
            );
        }
    });

    test("the plan step carries the planning guidance itself", async () => {
        const root = await project();
        const plan = await read(root, ".claude/skills/craftpath-plan/SKILL.md");

        expect(plan).toContain("Acceptance criteria are the whole job");
        expect(plan).toContain("Tasks in one wave");
    });
});
