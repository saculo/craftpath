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
import { guard, project, script, worktree } from "./kit";

afterAll(cleanScratch);

const ID = "C-00001";
const TREE = "C-00001-health-endpoint";
const work = (root: string) => join(worktree(root, TREE), ".craftpath/work", ID);

const COMPLETE_SPEC = `# C-00001 — Health endpoint

## Problem

Load balancers cannot tell whether the API is up.

## Scenarios

### S1 — Health check succeeds

- **Given** the API is running
- **When** a client sends GET /health
- **Then** it answers 200 with the JSON body {"ok":true}

## Out of scope

Checking the database.

## Open questions

None
`;

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

const completeTask = (id: string, wave: number, depends = "none") => `# ${id} — Add GET /health

- **Work:** C-00001
- **Type:** feat
- **Wave:** ${wave}
- **Depends on:** ${depends}
- **Touches:** src/app.ts, test/health.test.ts
- **Scenarios:** S1

## Acceptance criteria

- **A1** GET /health answers 200 with {"ok":true} and needs no token — proven by integration test \`GET /health returns ok\`

## Notes
`;

/** A project with work item C-00001 created, its SPEC.md as given. */
async function withSpec(spec = COMPLETE_SPEC): Promise<string> {
    const root = await project();
    await script(root, "spec", "Health endpoint");
    await Bun.write(join(work(root), "SPEC.md"), spec);
    return root;
}

const check = (cwd: string, step: string, id = ID) => script(cwd, "check", step, id);

describe("work item ids in step commands", () => {
    test("a missing id is refused", async () => {
        const { exit, err } = await guard(await withSpec(), "plan", "");

        expect(exit).toBe(2);
        expect(err).toContain("/craftpath:plan <work id>");
    });

    test("an unknown id is refused, listing the open work items", async () => {
        const { exit, err } = await guard(await withSpec(), "plan", "C-00042");

        expect(exit).toBe(2);
        expect(err).toContain("C-00042");
        expect(err).toContain("C-00001");
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
        const { exit, err } = await guard(
            await withSpec(COMPLETE_SPEC.replace("None\n", "- Which port?\n")),
            "design",
            ID,
        );

        expect(exit).toBe(2);
        expect(err).toContain("SPEC.md");
        expect(err).toContain("Which port?");
    });

    test("creates DESIGN.md from the template, and leaves an existing one alone", async () => {
        const root = await withSpec();
        expect((await guard(root, "design", ID)).exit).toBe(0);

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

describe("/craftpath:plan", () => {
    test("is refused while SPEC.md is incomplete", async () => {
        const root = await project();
        await script(root, "spec", "Health endpoint");

        const { exit, err } = await guard(root, "plan", ID);

        expect(exit).toBe(2);
        expect(err).toContain("SPEC.md");
    });

    test("is refused while an existing DESIGN.md is incomplete", async () => {
        const root = await withSpec();
        await script(root, "design", ID);

        const { exit, err } = await guard(root, "plan", ID);

        expect(exit).toBe(2);
        expect(err).toContain("DESIGN.md");
    });

    test("with a complete spec, plan.py creates PLAN.md", async () => {
        const root = await withSpec();
        expect((await guard(root, "plan", ID)).exit).toBe(0);

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
    /** A plan with goal and approach written and the given tasks added and filled. */
    async function planned(tasks: [number, string | null][]): Promise<string> {
        const root = await withSpec();
        await script(root, "plan", ID);
        const path = join(work(root), "PLAN.md");
        // Goal and Approach written, guidance comments gone; task.py adds the tasks.
        const plan = [
            "# C-00001 — Health endpoint: plan",
            "",
            "## Goal",
            "",
            "GET /health tells load balancers the API is up.",
            "",
            "## Approach",
            "",
            "One route, tested end to end.",
            "",
            "## Tasks",
            "",
        ].join("\n");
        await Bun.write(path, plan);
        for (const [i, [wave, depends]] of tasks.entries()) {
            const id = `T-000${i + 1}`;
            await script(root, "task", ID, "--wave", String(wave), "Add GET /health");
            await Bun.write(
                join(work(root), "tasks", `${id}.md`),
                completeTask(id, wave, depends ?? "none"),
            );
        }
        return root;
    }

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

describe("the step commands", () => {
    const read = (root: string, path: string) => Bun.file(join(root, path)).text();

    test("on Claude Code, design and plan run their script first and may run task.py and check.py", async () => {
        const root = await project();
        const plan = await read(root, ".claude/commands/craftpath/plan.md");
        const design = await read(root, ".claude/commands/craftpath/design.md");

        expect(plan).toContain('!`python3 .craftpath/scripts/plan.py "$ARGUMENTS"`');
        expect(plan).toContain("Bash(python3 .craftpath/scripts/task.py:*)");
        expect(plan).toContain("Bash(python3 .craftpath/scripts/check.py:*)");
        expect(design).toContain('!`python3 .craftpath/scripts/design.py "$ARGUMENTS"`');
        expect(plan + design).not.toContain("{{");
    });

    test("every step ends by checking its own output", async () => {
        const root = await project();
        for (const [step, kind] of [
            ["spec", "spec"],
            ["design", "design"],
            ["plan", "plan"],
        ]) {
            expect(await read(root, `.claude/commands/craftpath/${step}.md`)).toContain(
                `python3 .craftpath/scripts/check.py ${kind}`,
            );
        }
    });

    test("on pi, the extension runs plan.py before the agent", async () => {
        const root = await project({ harness: "pi" });

        expect(await read(root, ".pi/craftpath/commands/plan.md")).toContain("{{RUN:plan}}");
    });
});
