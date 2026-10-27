/**
 * Step 2: `/craftpath-design` (optional) and `/craftpath-plan`.
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
    completeTask,
    commitsSince,
    git,
    guard,
    installed,
    ID,
    planned,
    project,
    python,
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
    test("new specifications put assumptions before open questions", async () => {
        const root = await project();
        await script(root, "spec", "Health endpoint");

        const spec = await Bun.file(join(work(root), "SPEC.md")).text();

        expect(spec).toContain("## Assumptions");
        const assumptions = spec.slice(
            spec.indexOf("## Assumptions"),
            spec.indexOf("## Open questions"),
        );
        expect(assumptions).toContain("decisions");
        expect(assumptions).toContain("why");
        const headings: string[] = [...(spec.match(/^## .+$/gm) ?? [])];
        expect(headings.filter((heading) => heading === "## Assumptions")).toEqual([
            "## Assumptions",
        ]);
        expect(headings.indexOf("## Open questions")).toBe(headings.indexOf("## Assumptions") + 1);
    });

    test("the untouched template is incomplete, and every problem is named", async () => {
        const root = await project();
        await script(root, "spec", "Health endpoint");

        const { exit, out } = await check(root, "spec");

        expect(exit).toBe(1);
        expect(out).toContain("guidance comment");
        expect(out).toContain("<name>");
        expect(out).toContain("Open questions");
    });

    test("a specification missing assumptions is incomplete", async () => {
        const root = await withSpec(COMPLETE_SPEC.replace("## Assumptions\n\nNone\n\n", ""));

        const { exit, out } = await check(root, "spec");

        expect(exit).toBe(1);
        expect(out).toContain("Assumptions");
        expect(out).not.toContain("SPEC.md is complete");
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
        const root = await withSpec(
            COMPLETE_SPEC.replace(
                "## Open questions\n\nNone\n",
                "## Open questions\n\n- Which port?\n",
            ),
        );

        const { exit, out } = await check(root, "spec");

        expect(exit).toBe(1);
        expect(out).toContain("Which port?");
    });

    test("a complete specification with assumptions does not block planning", async () => {
        const root = await withSpec(
            COMPLETE_SPEC.replace(
                "## Assumptions\n\nNone\n",
                "## Assumptions\n\n- The health route needs no database check because the request is for API availability.\n",
            ),
        );

        expect((await check(root, "spec")).exit).toBe(0);
        expect((await guard(root, "plan", ID)).blocked).toBe(false);
    });

    test("a complete spec passes, from the main checkout or the worktree", async () => {
        const root = await withSpec();

        expect((await check(root, "spec")).exit).toBe(0);
        expect((await check(worktree(root, TREE), "spec")).exit).toBe(0);
    });
});

describe("/craftpath-design", () => {
    test("is refused while SPEC.md is incomplete, saying why", async () => {
        const { blocked, reason } = await guard(
            await withSpec(
                COMPLETE_SPEC.replace(
                    "## Open questions\n\nNone\n",
                    "## Open questions\n\n- Which port?\n",
                ),
            ),
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

describe("/craftpath-plan", () => {
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

    test("the task.py command plan.py prints is accepted once its placeholders are filled in", async () => {
        const root = await withSpec();
        const { out } = await script(root, "plan", ID);
        const hint = out.split("\n").find((line) => line.includes("task.py")) ?? "";
        const command = hint
            .slice(hint.indexOf("python3 "))
            .replace("<n>", "1")
            .replace("<type>", "feat")
            .replace('"<task title>"', "Add GET /health");

        const { exit, err } = await python(root, command.split(" ").slice(1));

        expect({ command, exit, err }).toMatchObject({ exit: 0, err: "" });
        expect(await Bun.file(join(work(root), "tasks/T-0001.md")).exists()).toBe(true);
    });

    test("task.py numbers tasks, writes each from the template and lists it under its wave", async () => {
        const root = await withSpec();
        await script(root, "plan", ID);

        await script(root, "task", ID, "--wave", "1", "--type", "feat", "Add GET /health");
        await script(root, "task", ID, "--wave", "2", "--type", "feat", "Document the endpoint");
        const third = await script(
            root,
            "task",
            ID,
            "--wave",
            "1",
            "--type",
            "feat",
            "Exempt /health from auth",
        );

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

    test("a code span wrapped across a line break is not a placeholder", async () => {
        const root = await planned([[1, null]]);
        const file = join(work(root), "tasks/T-0001.md");
        await Bun.write(
            file,
            `${await Bun.file(file).text()}\n- Headings follow \`## <task id> — <task\n  title>\`.\n`,
        );

        expect(await check(root, "plan")).toMatchObject({ exit: 0 });
    });

    test("an untouched task file is named with what is missing", async () => {
        const root = await withSpec();
        await script(root, "plan", ID);
        await script(root, "task", ID, "--wave", "1", "--type", "feat", "Add GET /health");

        const { exit, out } = await check(root, "plan");

        expect(exit).toBe(1);
        expect(out).toContain("T-0001");
        expect(out).toContain("Touches");
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
        const checks = {
            spec: "spec",
            design: "design",
            plan: "plan",
            review: "review",
            learn: "knowledge",
        };
        for (const [step, file] of Object.entries(checks)) {
            expect(await read(root, `.claude/skills/craftpath-${step}/SKILL.md`)).toContain(
                `python3 .craftpath/scripts/check.py ${file}`,
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

describe("check.py plan -- the commit subject's length", () => {
    // `feat(C-00001/T-0002): ` is 22 characters: a 50-character title makes a 72-character subject.
    const TITLE_50 = "Refuse an over-long commit subject in the plan run";
    const TITLE_51 = "Refuse an over-long commit subject in the plan step";
    const TITLE_40 = "Refuse a long commit subject in the plan";

    /** T-0001 and T-0002 planned and complete, T-0002 listed in PLAN.md under `title`. */
    async function titled(title: string): Promise<string> {
        const root = await planned([
            [1, null],
            [2, "T-0001"],
        ]);
        const path = join(work(root), "PLAN.md");
        const plan = await Bun.file(path).text();
        await Bun.write(
            path,
            plan.replace("- [ ] T-0002 — Add GET /health", `- [ ] T-0002 — ${title}`),
        );
        return root;
    }

    test("a task whose commit subject would pass 72 characters is named", async () => {
        expect(`feat(C-00001/T-0002): ${TITLE_51}`).toHaveLength(73);
        const root = await titled(TITLE_51);
        const plan = await Bun.file(join(work(root), "PLAN.md")).text();
        const task = await Bun.file(join(work(root), "tasks/T-0002.md")).text();

        const { exit, out } = await check(root, "plan");

        expect(exit).toBe(1);
        expect(out).toContain("T-0002: its commit subject would be 73 characters, limit 72");
        expect(out).not.toContain("PLAN.md is complete.");
        expect(await Bun.file(join(work(root), "PLAN.md")).text()).toBe(plan);
        expect(await Bun.file(join(work(root), "tasks/T-0002.md")).text()).toBe(task);
    });

    test("a commit subject of exactly 72 characters passes the plan check", async () => {
        expect(`feat(C-00001/T-0002): ${TITLE_50}`).toHaveLength(72);

        const { exit, out } = await check(await titled(TITLE_50), "plan");

        expect(exit).toBe(0);
        expect(out).toContain("PLAN.md is complete.");
        expect(out).not.toContain("commit subject");
    });

    test("the task's type counts towards its commit subject", async () => {
        expect(`refactor(C-00001/T-0002): ${TITLE_50}`).toHaveLength(76);
        const root = await titled(TITLE_50);
        const file = join(work(root), "tasks/T-0002.md");
        await Bun.write(
            file,
            (await Bun.file(file).text()).replace("**Type:** feat", "**Type:** refactor"),
        );

        const { exit, out } = await check(root, "plan");

        expect(exit).toBe(1);
        expect(out).toContain("T-0002: its commit subject would be 76 characters, limit 72");
    });

    test("the title measured is the one in PLAN.md", async () => {
        expect(TITLE_40).toHaveLength(40);
        const root = await planned([[1, null]]);
        await script(root, "task", ID, "--wave", "2", "--type", "feat", TITLE_40);
        const file = join(work(root), "tasks/T-0002.md");
        await Bun.write(
            file,
            completeTask("T-0002", 2, "T-0001").replace("Add GET /health", TITLE_40),
        );
        const path = join(work(root), "PLAN.md");
        const plan = await Bun.file(path).text();
        expect(plan).toContain(`- [ ] T-0002 — ${TITLE_40}`);
        await Bun.write(
            path,
            plan.replace(`- [ ] T-0002 — ${TITLE_40}`, `- [ ] T-0002 — ${TITLE_51}`),
        );

        const { exit, out } = await check(root, "plan");

        expect(await Bun.file(file).text()).toContain(`# T-0002 — ${TITLE_40}`);
        expect(exit).toBe(1);
        expect(out).toContain("T-0002: its commit subject would be 73 characters, limit 72");
    });
});

/** C-00001 planned with T-0001 and T-0002 added by task.py; the PLAN.md text before the call. */
async function twoTasks(): Promise<{ root: string; plan: string }> {
    const root = await planned([
        [1, null],
        [2, "T-0001"],
    ]);
    return { root, plan: await Bun.file(join(work(root), "PLAN.md")).text() };
}

async function nothingAdded(root: string, plan: string) {
    expect(await Bun.file(join(work(root), "tasks/T-0003.md")).exists()).toBe(false);
    expect(await Bun.file(join(work(root), "PLAN.md")).text()).toBe(plan);
}

describe("task.py --type -- every task is added with its commit type", () => {
    // `refactor(C-00001/T-0003): ` is 26 characters: a 46-character title makes a 72-character subject.
    const TITLE_46 = "Record the type of a task when it is added now";

    test("adding a task without a type is refused with the usage", async () => {
        const { root, plan } = await twoTasks();

        const { exit, err } = await script(root, "task", ID, "--wave", "1", "Add the length check");

        expect(exit).toBe(1);
        expect(err).toContain('--wave <n> --type <type> "<title>"');
        await nothingAdded(root, plan);
    });

    test("adding a task with an unknown type is refused", async () => {
        const { root, plan } = await twoTasks();

        const { exit, err } = await script(
            root,
            "task",
            ID,
            "--wave",
            "1",
            "--type",
            "feature",
            "Add the length check",
        );

        expect(exit).toBe(1);
        expect(err).toContain(
            "the type must be one of feat, fix, test, refactor, docs, perf, chore",
        );
        await nothingAdded(root, plan);
    });

    test("adding a task records its type in the task file", async () => {
        expect(`refactor(C-00001/T-0003): ${TITLE_46}`).toHaveLength(72);
        const { root } = await twoTasks();

        const { exit } = await script(
            root,
            "task",
            ID,
            "--wave",
            "1",
            "--type",
            "refactor",
            TITLE_46,
        );

        expect(exit).toBe(0);
        expect(await Bun.file(join(work(root), "tasks/T-0003.md")).text()).toContain(
            "- **Type:** refactor",
        );
        const plan = await Bun.file(join(work(root), "PLAN.md")).text();
        const wave1 = plan.slice(plan.indexOf("### Wave 1"), plan.indexOf("### Wave 2"));
        expect(wave1).toContain(`- [ ] T-0003 — ${TITLE_46}`);
        expect((await check(root, "plan")).out).not.toContain("T-0003: Type");
    });

    test("--type is accepted anywhere among the arguments", async () => {
        const { root } = await twoTasks();

        const { exit } = await script(
            root,
            "task",
            "--type",
            "docs",
            ID,
            "--wave",
            "2",
            "Document the endpoint",
        );

        expect(exit).toBe(0);
        expect(await Bun.file(join(work(root), "tasks/T-0003.md")).text()).toContain(
            "- **Type:** docs",
        );
    });

    test("the plan step adds every task with its type", async () => {
        for (const skill of await installed("craftpath-plan")) {
            expect(skill).toContain('task.py <work id> --wave <n> --type <type> "<task title>"');
            expect(skill).not.toContain('--wave <n> "');
        }
    });
});

describe("task.py -- the commit subject's length", () => {
    // `refactor(C-00001/T-0003): ` is 26 characters, `feat(C-00001/T-0003): ` 22.
    const TITLE_46 = "Record the type of a task when it is added now";
    const TITLE_47 = "Record the type of a task when it is added now!";
    const TITLE_51 = "Measure the commit subject of a task when it is new";

    test("adding a task whose commit subject is too long is refused", async () => {
        expect(TITLE_47).toHaveLength(47);
        const { root, plan } = await twoTasks();

        const { exit, err } = await script(
            root,
            "task",
            ID,
            "--wave",
            "1",
            "--type",
            "refactor",
            TITLE_47,
        );

        expect(exit).toBe(1);
        expect(err).toContain("T-0003");
        expect(err).toContain("its commit subject would be 73 characters, limit 72");
        await nothingAdded(root, plan);
    });

    test("adding a task whose commit subject is exactly 72 characters succeeds", async () => {
        expect(TITLE_46).toHaveLength(46);
        const { root } = await twoTasks();

        const { exit } = await script(
            root,
            "task",
            ID,
            "--wave",
            "1",
            "--type",
            "refactor",
            TITLE_46,
        );

        expect(exit).toBe(0);
        expect(await Bun.file(join(work(root), "tasks/T-0003.md")).exists()).toBe(true);
        const plan = await Bun.file(join(work(root), "PLAN.md")).text();
        const wave1 = plan.slice(plan.indexOf("### Wave 1"), plan.indexOf("### Wave 2"));
        expect(wave1).toContain(`- [ ] T-0003 — ${TITLE_46}`);
    });

    test("adding a task measures its subject with the type given", async () => {
        expect(TITLE_51).toHaveLength(51);
        const { root, plan } = await twoTasks();

        const { exit } = await script(root, "task", ID, "--wave", "1", "--type", "feat", TITLE_51);

        expect(exit).toBe(1);
        await nothingAdded(root, plan);
    });
});
