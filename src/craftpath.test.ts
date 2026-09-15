import { describe, expect, test } from "bun:test";
import { shouldBlock } from "../src/hooks/guard-bash";
import {
    CorruptStateError,
    PreconditionError,
    amend,
    criterionSatisfied,
    done,
    isBlocked,
    start,
    unsatisfied,
    waves,
    type Task,
} from "../src/transitions";
import { Acceptance, CommandSpec, TaskProse, TaskState, WorkState } from "../src/schema";
import { init } from "../src/core/init";
import { canRunSelector, commandFor, isConfigured, loadConfig } from "../src/core/config";
import { SLOW_MS, classify, doctor } from "../src/core/doctor";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
import { branchName, nextId, slugify, status, workNew } from "../src/core/work";
import { taskAck, taskAdd, taskDone, taskStart, taskVerify, unsatisfiedFor } from "../src/core/task";
import { approve, gateState } from "../src/core/approve";
import { validate, validateComplete } from "../src/core/validate";
import { mkdtemp } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A fresh scratch directory. Tests must not depend on each other's files. */
async function tmpdir(): Promise<string> {
    return await mkdtemp(join(osTmpdir(), "craftpath-test-"));
}

/**
 * PATH with any directory containing a `craftpath` executable removed, so the
 * "not installed" branch can be exercised on a machine where it IS installed.
 */
function pathWithoutCraftpath(): string {
    const resolved = Bun.which("craftpath");
    const entries = (process.env.PATH ?? "").split(":");
    if (!resolved) return entries.join(":");
    const owner = dirname(resolved);
    return entries.filter((dir) => dir !== owner).join(":");
}

const HASH_A = "sha256:" + "a".repeat(64);
const HASH_B = "sha256:" + "b".repeat(64);

const CRITERION: Acceptance = {
    id: "A1",
    text: "rejects TIFF uploads",
    verified_by: [{ cmd: "test-integration", selector: "AvatarIT#rejectsTiff" }],
};

const MANUAL: Acceptance = {
    id: "A2",
    text: "crop UI matches the approved spec",
    verified_by: [{ cmd: "manual" }],
};

/** A design task: D id, matching skill, a manual criterion, a declared output. */
const DESIGN_TASK = {
    id: "D001",
    title: "Decide the crop interaction",
    skills: ["ux"],
    design: {
        kind: "ux",
        reason: "three viable crop models, and the choice changes the upload API",
    },
    produces: ["work/0001-avatar-upload/design-D001.md"],
    acceptance: [MANUAL],
};

/**
 * Asserts a parse failed *at* a given field. Plain `success === false` is not
 * enough here: `.strict()` already rejects an unknown `design` key at the root,
 * so a refinement test would pass before its refinement exists.
 */
function rejectedAt(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }, ...path: PropertyKey[]) {
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(paths).toContain(path.join("."));
}

function mk(over: Partial<Task> = {}): Task {
    return {
        id: "T004",
        status: "pending",
        depends_on: [],
        acceptance: [CRITERION],
        evidence: [],
        acks: [],
        produces: [],
        ...over,
    };
}

function ev(over: Partial<Task["evidence"][number]> = {}) {
    return {
        cmd: "test-integration",
        selector: "AvatarIT#rejectsTiff" as string | null,
        exit: 0,
        log: "logs/T004.log",
        config_hash: HASH_A,
        at: "2026-09-11T09:41:55Z",
        ...over,
    };
}

function dep(id: string, status: Task["status"]): [string, Task] {
    return [id, mk({ id, status })];
}

// ---------------------------------------------------------------------------

describe("guard-bash: blocks writes", () => {
    const blocked = [
        "echo '{}' > .craftpath/state/0042/T004.json",
        "sed -i 's/pending/done/' .craftpath/state/0042/T004.json",
        "cp /tmp/fake.json .craftpath/state/0042/T004.json",
        "bun -e \"Bun.write('.craftpath/state/x.json','{}')\"",
        "cat x | tee .craftpath/state/0042/T004.json",
        "python3 -c \"open('.craftpath/state/x.json','w')\"",
    ];
    for (const cmd of blocked) {
        test(cmd.slice(0, 50), () => expect(shouldBlock(cmd)).toBe(true));
    }
});

describe("guard-bash: allows reads and sanctioned calls", () => {
    const allowed = [
        "cat .craftpath/state/0042/T004.json",
        "grep -r in_progress .craftpath/state/",
        "craftpath task done T004",
        "./bin/craftpath task verify T004",
        "cd /repo && craftpath status",
        "./gradlew :services:user:test",
        "git commit -m 'feat: thing'",
    ];
    for (const cmd of allowed) {
        test(cmd.slice(0, 50), () => expect(shouldBlock(cmd)).toBe(false));
    }
});

test("guard-bash: the .craftpath substring must not disable the guard", () => {
    // Regression: /\bcraftpath\b/ matched ".craftpath/state/..." and silently
    // allowed everything. The guard blocked nothing while appearing healthy.
    expect(shouldBlock("echo x > .craftpath/state/T1.json")).toBe(true);
});

// ---------------------------------------------------------------------------

describe("dependencies", () => {
    test("blocked while a dependency is pending", () => {
        const t = mk({ depends_on: ["T002"] });
        expect(isBlocked(t, new Map([dep("T002", "pending")]))).toBe(true);
    });

    test("unblocked once dependencies are done", () => {
        const t = mk({ depends_on: ["T002"] });
        expect(isBlocked(t, new Map([dep("T002", "done")]))).toBe(false);
    });

    test("dangling dependency is corrupt state", () => {
        expect(() => isBlocked(mk({ depends_on: ["T999"] }), new Map())).toThrow(
            CorruptStateError,
        );
    });

    test("start refuses while blocked", () => {
        const t = mk({ depends_on: ["T002"] });
        expect(() => start(t, new Map([dep("T002", "pending")]))).toThrow(
            PreconditionError,
        );
    });

    test("waves group by dependency depth", () => {
        const all = new Map<string, Task>([
            ["T001", mk({ id: "T001" })],
            ["T002", mk({ id: "T002" })],
            ["T003", mk({ id: "T003", depends_on: ["T001", "T002"] })],
            ["T004", mk({ id: "T004", depends_on: ["T003"] })],
        ]);
        expect(waves(all)).toEqual([["T001", "T002"], ["T003"], ["T004"]]);
    });

    test("a design task lands in an earlier wave than its dependent", () => {
        const design = TaskProse.parse(DESIGN_TASK);
        const impl = TaskProse.parse({
            id: "T001",
            title: "Build the crop endpoint",
            depends_on: ["D001"],
            acceptance: [CRITERION],
        });
        const all = new Map<string, Task>([
            [design.id, mk({ id: design.id, depends_on: design.depends_on })],
            [impl.id, mk({ id: impl.id, depends_on: impl.depends_on })],
        ]);
        expect(waves(all)).toEqual([["D001"], ["T001"]]);
    });

    test("cycles are detected", () => {
        const all = new Map<string, Task>([
            ["T001", mk({ id: "T001", depends_on: ["T002"] })],
            ["T002", mk({ id: "T002", depends_on: ["T001"] })],
        ]);
        expect(() => waves(all)).toThrow(CorruptStateError);
    });
});

// ---------------------------------------------------------------------------

describe("derived acceptance satisfaction", () => {
    test("satisfied by evidence from the matching selector", () => {
        const t = mk({ status: "in_progress", evidence: [ev()] });
        expect(criterionSatisfied(t, CRITERION, HASH_A)).toBe(true);
    });

    test("suite-wide evidence does NOT prove a selector criterion", () => {
        const t = mk({ status: "in_progress", evidence: [ev({ selector: null })] });
        expect(criterionSatisfied(t, CRITERION, HASH_A)).toBe(false);
    });

    test("failing evidence does not satisfy", () => {
        const t = mk({ status: "in_progress", evidence: [ev({ exit: 1 })] });
        expect(criterionSatisfied(t, CRITERION, HASH_A)).toBe(false);
    });

    test("a config change makes evidence stale", () => {
        const t = mk({ status: "in_progress", evidence: [ev()] });
        expect(criterionSatisfied(t, CRITERION, HASH_B)).toBe(false);
    });

    test("manual criterion needs a signed ack", () => {
        const t = mk({
            status: "in_progress",
            acceptance: [MANUAL],
            acks: [
                {
                    criterion_id: "A2",
                    by: "me@example.com",
                    at: "2026-09-11T10:00:00Z",
                    config_hash: HASH_A,
                },
            ],
        });
        expect(criterionSatisfied(t, MANUAL, HASH_A)).toBe(true);
    });

    test("empty verified_by can never be satisfied", () => {
        const empty: Acceptance = { id: "A1", text: "vague", verified_by: [] };
        expect(criterionSatisfied(mk({ acceptance: [empty] }), empty, HASH_A)).toBe(
            false,
        );
    });

    test("unsatisfied lists the right ids", () => {
        expect(unsatisfied(mk({ status: "in_progress" }), HASH_A)).toEqual(["A1"]);
    });
});

// ---------------------------------------------------------------------------

describe("completion", () => {
    test("refuses with unsatisfied criteria", () => {
        expect(() => done(mk({ status: "in_progress" }), HASH_A, true)).toThrow(
            PreconditionError,
        );
    });

    test("refuses when the trailer is absent from the branch", () => {
        const t = mk({ status: "in_progress", evidence: [ev()] });
        expect(() => done(t, HASH_A, false)).toThrow(PreconditionError);
    });

    test("succeeds with evidence and trailer", () => {
        const t = mk({ status: "in_progress", evidence: [ev()] });
        expect(done(t, HASH_A, true)).toBe("done");
    });

    test("is idempotent", () => {
        expect(done(mk({ status: "done" }), HASH_A, true)).toBe("done");
    });

    test("start on a done task refuses", () => {
        expect(() => start(mk({ status: "done" }), new Map())).toThrow(
            PreconditionError,
        );
    });

    test("amend clears evidence and reopens", () => {
        const t = mk({ status: "done", evidence: [ev()] });
        expect(amend(t)).toBe("pending");
        expect(t.evidence).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------

describe("schema is strict", () => {
    test("rejects a stored `met` field on acceptance (D4)", () => {
        const r = TaskProse.safeParse({
            id: "T004",
            title: "Upload avatar",
            acceptance: [{ ...CRITERION, met: true }],
        });
        expect(r.success).toBe(false);
    });

    test("rejects a criterion with no verified_by", () => {
        const r = TaskProse.safeParse({
            id: "T004",
            title: "Upload avatar",
            acceptance: [{ id: "A1", text: "vague thing", verified_by: [] }],
        });
        expect(r.success).toBe(false);
    });

    test("rejects a selector on a manual criterion", () => {
        const r = Acceptance.safeParse({
            id: "A1",
            text: "crop UI matches",
            verified_by: [{ cmd: "manual", selector: "Foo#bar" }],
        });
        expect(r.success).toBe(false);
    });

    test("rejects a malformed task id", () => {
        expect(TaskProse.safeParse({ id: "T4", title: "x y z", acceptance: [CRITERION] }).success)
            .toBe(false);
    });

    test("accepts a well-formed task and defaults arrays", () => {
        const r = TaskProse.safeParse({
            id: "T004",
            title: "Upload avatar",
            acceptance: [CRITERION],
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.depends_on).toEqual([]);
    });

    test("accepts a task carrying a design block", () => {
        const r = TaskProse.safeParse(DESIGN_TASK);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.design?.kind).toBe("ux");
    });

    test("rejects a design block with no stated reason", () => {
        const r = TaskProse.safeParse({
            ...DESIGN_TASK,
            design: { kind: "ux", reason: "because" },
        });
        rejectedAt(r, "design", "reason");
    });

    test("rejects a design task binding the wrong skill", () => {
        rejectedAt(TaskProse.safeParse({ ...DESIGN_TASK, skills: ["backend"] }), "skills");
    });

    test("rejects a design task with no manual criterion", () => {
        rejectedAt(TaskProse.safeParse({ ...DESIGN_TASK, acceptance: [CRITERION] }), "acceptance");
    });

    test("a D id and a design block imply each other", () => {
        rejectedAt(TaskProse.safeParse({ ...DESIGN_TASK, id: "T001" }), "id");

        const { design: _dropped, ...noDesign } = DESIGN_TASK;
        rejectedAt(TaskProse.safeParse({ ...noDesign, id: "D002" }), "id");
    });

    test("rejects a design task that produces nothing", () => {
        rejectedAt(TaskProse.safeParse({ ...DESIGN_TASK, produces: [] }), "produces");
    });

    test("rejects a produces path escaping the repo", () => {
        for (const escape of ["../../etc/passwd", "/etc/passwd"]) {
            rejectedAt(TaskProse.safeParse({ ...DESIGN_TASK, produces: [escape] }), "produces", 0);
        }
    });

    test("state rejects a bad config hash", () => {
        const r = TaskState.safeParse({
            id: "T004",
            status: "done",
            evidence: [{ ...ev(), config_hash: "nope" }],
            acks: [],
            git: { trailer: "Task: T004" },
        });
        expect(r.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------

describe("validate CLI", () => {
    test("--complete refuses to report success it cannot prove", async () => {
        const p = Bun.spawn(["bun", "bin/craftpath.ts", "validate", "--complete"], {
            stderr: "pipe",
        });
        expect(await p.exited).toBe(1);
    });

    test("bare validate stays exit 0 so the Stop hook is silent on a pause", async () => {
        const p = Bun.spawn(["bun", "bin/craftpath.ts", "validate"], {
            stderr: "pipe",
        });
        expect(await p.exited).toBe(0);
    });
});

// ---------------------------------------------------------------------------

describe("cli install", () => {
    const ROOT = new URL("..", import.meta.url).pathname;
    const CLI = join(ROOT, "bin/craftpath.ts");

    test("package.json declares a bin entry pointing at an executable entry point", async () => {
        const pkg = await Bun.file(join(ROOT, "package.json")).json();
        expect(pkg.bin).toEqual({ craftpath: "./bin/craftpath.ts" });

        const entry = join(ROOT, pkg.bin.craftpath);
        expect(await Bun.file(entry).exists()).toBe(true);
        // Without the shebang the bin entry is not runnable as a command.
        expect(await Bun.file(entry).text()).toStartWith("#!/usr/bin/env bun");
    });

    test("version runs from outside the repo", async () => {
        const cwd = await tmpdir();
        const p = Bun.spawn(["bun", CLI, "version"], { cwd, stdout: "pipe", stderr: "pipe" });
        expect(await p.exited).toBe(0);
        expect(await new Response(p.stdout).text()).toContain("craftpath");
    });

    test("the resolved binary blocks a state write", async () => {
        const cwd = await tmpdir();
        const p = Bun.spawn(["bun", CLI, "hook", "guard-write"], {
            cwd,
            stdin: new TextEncoder().encode(
                JSON.stringify({
                    tool_name: "Write",
                    tool_input: { file_path: ".craftpath/state/T1.json" },
                }),
            ),
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(2);
        expect(await new Response(p.stderr).text()).toContain("owned by the Craftpath CLI");
    });

    test("readme documents the link step", async () => {
        const readme = await Bun.file(join(ROOT, "README.md")).text();
        expect(readme).toContain("bun link");
        // The reason matters more than the command: an unlinked craftpath means
        // the guards silently do not run.
        expect(readme.toLowerCase()).toContain("hook");
    });

    test("init warns when the hook command will not resolve", async () => {
        const cwd = await tmpdir();
        const p = Bun.spawn(["bun", CLI, "init"], {
            cwd,
            env: { ...process.env, PATH: pathWithoutCraftpath() },
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(0);
        const err = await new Response(p.stderr).text();
        // Case-insensitive: the message emphasises NOT, and that emphasis is
        // worth keeping rather than flattening to satisfy a literal match.
        expect(err.toLowerCase()).toContain("will not be blocked");
        expect(err).toContain("bun link craftpath");
        // The hooks are still written; a half-set-up project is worse.
        expect(await Bun.file(join(cwd, ".claude/settings.json")).exists()).toBe(true);
    });

    test("init stays quiet when the command resolves", async () => {
        const cwd = await tmpdir();
        const fakeBin = join(cwd, "fakebin");
        await Bun.write(join(fakeBin, "craftpath"), "#!/bin/sh\nexit 0\n");
        await Bun.$`chmod +x ${join(fakeBin, "craftpath")}`.quiet();

        const p = Bun.spawn(["bun", CLI, "init"], {
            cwd,
            env: { ...process.env, PATH: `${fakeBin}:${pathWithoutCraftpath()}` },
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(0);
        expect((await new Response(p.stderr).text()).toLowerCase()).not.toContain(
            "will not be blocked",
        );
    });
});

// ---------------------------------------------------------------------------

describe("work schema", () => {
    const VALID = {
        id: "0042-avatar-upload",
        title: "Avatar upload",
        mode: "light",
        phase: "requirement",
        approvals: [],
        created_at: "2026-09-13T09:41:55Z",
    };

    test("accepts a well-formed work state", () => {
        const parsed = WorkState.parse(VALID);
        expect(parsed.mode).toBe("light");
        expect(gateState(parsed.approvals, "plan")).toBe("pending");
    });

    test("rejects an unknown key", () => {
        expect(() => WorkState.parse({ ...VALID, branch: "work/0042" })).toThrow();
    });

    test("rejects a malformed work id", () => {
        for (const id of ["avatar-upload", "42-avatar", "0042-Avatar", "0042-"]) {
            expect(() => WorkState.parse({ ...VALID, id })).toThrow();
        }
    });

    test("rejects an approval for something that is not a gate", () => {
        expect(() =>
            WorkState.parse({
                ...VALID,
                approvals: [{ phase: "execute", by: "a@b.c", at: "2026-09-13T09:41:55Z" }],
            }),
        ).toThrow();
    });
});

// ---------------------------------------------------------------------------

/** A tmpdir with `craftpath init` already run in it. */
async function initRepo(): Promise<string> {
    const root = await tmpdir();
    const quietLog = console.log;
    const quietErr = console.error;
    console.log = () => {};
    console.error = () => {}; // the not-on-PATH warning is expected here
    try {
        await init(root);
    } finally {
        console.log = quietLog;
        console.error = quietErr;
    }
    return root;
}

/** Captures console.log while fn runs. */
async function captured(fn: () => Promise<void>): Promise<string> {
    const lines: string[] = [];
    const quiet = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        await fn();
    } finally {
        console.log = quiet;
    }
    return lines.join("\n");
}

const exists = (p: string) => Bun.file(p).exists();

describe("work new", () => {
    test("allocates above the highest id in work and archive", () => {
        expect(nextId(["0001-a", ".gitkeep", "0007-b"])).toBe("0008");
        expect(nextId([])).toBe("0001");
        expect(nextId([".gitkeep"])).toBe("0001");
    });

    test("turns a title into a readable slug", () => {
        expect(slugify("Add an Admin Page!")).toBe("add-an-admin-page");
        expect(slugify("  Spaces  everywhere  ")).toBe("spaces-everywhere");
        expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    });

    test("refuses a title that slugs to nothing", async () => {
        const root = await initRepo();
        expect(workNew(root, "***", "light")).rejects.toThrow();
        const after = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: join(root, ".craftpath/work"), onlyFiles: false }));
        expect(after.filter((e) => e !== ".gitkeep")).toEqual([]);
    });

    test("light mode scaffolds only its own artifacts", async () => {
        const root = await initRepo();
        await workNew(root, "Avatar upload", "light");
        const dir = join(root, ".craftpath/work/0001-avatar-upload");
        for (const f of ["requirement.md", "spec-delta.md", "changelog.md"]) {
            expect(await exists(join(dir, f))).toBe(true);
        }
        for (const f of ["context.md", "plan.md", "result.md", "design.md"]) {
            expect(await exists(join(dir, f))).toBe(false);
        }
    });

    test("standard mode adds context plan and result", async () => {
        const root = await initRepo();
        await workNew(root, "Avatar upload", "standard");
        const dir = join(root, ".craftpath/work/0001-avatar-upload");
        for (const f of ["context.md", "plan.md", "result.md"]) {
            expect(await exists(join(dir, f))).toBe(true);
        }
        expect(await exists(join(dir, "design.md"))).toBe(false);
    });

    test("writes valid kernel state with gates pending", async () => {
        const root = await initRepo();
        await workNew(root, "Avatar upload", "light");
        const raw = await Bun.file(
            join(root, ".craftpath/state/0001-avatar-upload/work.json"),
        ).json();
        const state = WorkState.parse(raw);
        expect(state.phase).toBe("requirement");
        expect(state.approvals).toEqual([]);
    });

    test("refuses a second open work item", async () => {
        const root = await initRepo();
        await workNew(root, "First thing", "light");
        expect(workNew(root, "Second thing", "light")).rejects.toThrow(PreconditionError);
        const dirs = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: join(root, ".craftpath/work"), onlyFiles: false }));
        expect(dirs.filter((e) => e !== ".gitkeep")).toEqual(["0001-first-thing"]);
    });
});

describe("status", () => {
    test("an empty repo exits zero and says what to run", async () => {
        const root = await initRepo();
        const out = await captured(() => status(root, false));
        expect(out).toContain("work new");
    });

    test("reports id mode phase and every gate", async () => {
        const root = await initRepo();
        await workNew(root, "Avatar upload", "light");
        const out = await captured(() => status(root, false));
        expect(out).toContain("0001-avatar-upload");
        expect(out).toContain("light");
        expect(out).toContain("requirement");
        for (const gate of ["requirement", "plan", "result"]) {
            expect(out).toContain(gate);
        }
    });

    test("brief output is a single line", async () => {
        const root = await initRepo();
        await workNew(root, "Avatar upload", "light");
        const out = await captured(() => status(root, true));
        expect(out.trim().split("\n")).toHaveLength(1);
    });

    test("corrupt kernel state is not reported as empty", async () => {
        const root = await initRepo();
        await workNew(root, "Avatar upload", "light");
        await Bun.write(
            join(root, ".craftpath/state/0001-avatar-upload/work.json"),
            "{ not json",
        );
        expect(status(root, false)).rejects.toThrow(CorruptStateError);
    });
});

// ---------------------------------------------------------------------------

/** Writes a minimal task prose file into the open work item. */
async function writeTask(
    root: string,
    workId: string,
    id: string,
    dependsOn: string[] = [],
): Promise<void> {
    const body = [
        "---",
        `id: ${id}`,
        `title: Task ${id}`,
        `depends_on: [${dependsOn.join(", ")}]`,
        "skills: []",
        "acceptance:",
        "  - id: A1",
        "    text: does the thing observably",
        "    verified_by:",
        "      - cmd: test",
        `        selector: "${id} works"`,
        "---",
        "",
        "## Context",
    ].join("\n");
    await Bun.write(join(root, ".craftpath/work", workId, "tasks", `${id}-backend.md`), body);
}

/** Writes kernel state for a task. */
async function writeTaskState(
    root: string,
    workId: string,
    id: string,
    status: "pending" | "in_progress" | "done",
): Promise<void> {
    await Bun.write(
        join(root, ".craftpath/state", workId, `${id}.json`),
        JSON.stringify({
            id,
            status,
            evidence: [],
            acks: [],
            git: { trailer: `Task: ${id}`, commits_hint: [] },
        }),
    );
}

describe("status tasks", () => {
    const WORK_ID = "0001-avatar-upload";

    async function repoWithWork(): Promise<string> {
        const root = await initRepo();
        const quiet = console.log;
        console.log = () => {};
        try {
            await workNew(root, "Avatar upload", "light");
        } finally {
            console.log = quiet;
        }
        return root;
    }

    test("an empty tasks directory says so", async () => {
        const root = await repoWithWork();
        const out = await captured(() => status(root, false));
        expect(out.toLowerCase()).toContain("no tasks");
    });

    test("shows what is blocked and by what", async () => {
        const root = await repoWithWork();
        await writeTask(root, WORK_ID, "T001");
        await writeTask(root, WORK_ID, "T002", ["T001"]);
        const out = await captured(() => status(root, false));
        expect(out).toContain("T002");
        expect(out).toMatch(/T002.*blocked.*T001/s);
        expect(out).toMatch(/next.*T001/is);
    });

    test("a done dependency unblocks its dependent", async () => {
        const root = await repoWithWork();
        await writeTask(root, WORK_ID, "T001");
        await writeTask(root, WORK_ID, "T002", ["T001"]);
        await writeTaskState(root, WORK_ID, "T001", "done");
        const out = await captured(() => status(root, false));
        expect(out).not.toMatch(/T002.*blocked/s);
    });

    test("a task with no state file reads as pending", async () => {
        const root = await repoWithWork();
        await writeTask(root, WORK_ID, "T001");
        const out = await captured(() => status(root, false));
        expect(out).toMatch(/T001.*pending/s);
    });

    test("names the task file that failed to parse", async () => {
        const root = await repoWithWork();
        await Bun.write(
            join(root, ".craftpath/work", WORK_ID, "tasks", "T009-broken.md"),
            "---\nid: nonsense\n---\n",
        );
        expect(status(root, false)).rejects.toThrow(/T009-broken\.md/);
    });
});

describe("work branch", () => {
    test("builds the branch name from the configured prefix", () => {
        expect(branchName("work/", "0042-avatar-upload")).toBe("work/0042-avatar-upload");
        expect(branchName("work", "0042-avatar-upload")).toBe("work/0042-avatar-upload");
    });

    test("switches to the new work branch", async () => {
        const root = await initRepo();
        await Bun.$`git init -q -b main ${root}`.quiet();
        await Bun.$`git -C ${root} commit -q --allow-empty -m seed`
            .env({ ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e.c", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e.c" })
            .quiet();

        const quiet = console.log;
        console.log = () => {};
        try {
            await workNew(root, "Avatar upload", "light");
        } finally {
            console.log = quiet;
        }

        const branch = await Bun.$`git -C ${root} rev-parse --abbrev-ref HEAD`.quiet().text();
        expect(branch.trim()).toBe("work/0001-avatar-upload");
    });
});

// ---------------------------------------------------------------------------

async function writeConfig(root: string, toml: string): Promise<void> {
    await Bun.write(join(root, ".craftpath/config.toml"), toml);
}

describe("config", () => {
    test("parses the config init writes", async () => {
        const root = await initRepo();
        const config = await loadConfig(root);
        expect(config.commands.test!.run).toBe("");
        expect(config.git.work_branch_prefix).toBe("work/");
        expect(config.gates.result).toBe("manual");
    });

    test("rejects an unknown top-level key", async () => {
        const root = await initRepo();
        await writeConfig(root, '[command.test]\nrun = "bun test"\n');
        expect(loadConfig(root)).rejects.toThrow(/command/);
    });

    test("whitespace-only run counts as unconfigured", () => {
        expect(isConfigured({ run: "   " })).toBe(false);
        expect(isConfigured({ run: "" })).toBe(false);
        expect(isConfigured({ run: "bun test" })).toBe(true);
    });

    test("a runner with no selector template cannot scope a selector", () => {
        expect(canRunSelector({ run: "bun test" })).toBe(false);
        expect(canRunSelector({ run: "bun test", selector_template: "-t {selector}" })).toBe(true);
        expect(canRunSelector({ run: "", selector_template: "-t {selector}" })).toBe(false);
    });

    test("rejects a selector template with no placeholder", () => {
        // Without {selector} the selector is silently dropped and the whole
        // suite runs, which proves nothing about the criterion that asked.
        expect(() => CommandSpec.parse({ run: "bun test", selector_template: "-t" })).toThrow();
        expect(() =>
            CommandSpec.parse({ run: "bun test", selector_template: "-t {selector}" }),
        ).not.toThrow();
    });

    test("builds a scoped command for every runner shape", () => {
        const cases: [string, string, string, string][] = [
            ["./gradlew test", "--tests {selector}", "AvatarIT.rejectsTiff", "./gradlew test --tests 'AvatarIT.rejectsTiff'"],
            ["./mvnw test", "-Dtest={selector}", "AvatarIT#rejectsTiff", "./mvnw test -Dtest='AvatarIT#rejectsTiff'"],
            ["pytest", "-k {selector}", "test_rejects_tiff", "pytest -k 'test_rejects_tiff'"],
            ["go test", "-run {selector} ./...", "TestRejectsTiff", "go test -run 'TestRejectsTiff' ./..."],
            ["bun test", "-t {selector}", "rejects tiff", "bun test -t 'rejects tiff'"],
        ];
        for (const [run, selector_template, selector, expected] of cases) {
            expect(commandFor({ run, selector_template }, selector)).toBe(expected);
        }
    });

    test("runs the bare command when no selector is scoped", () => {
        expect(commandFor({ run: "bun test" })).toBe("bun test");
        expect(commandFor({ run: "bun test", selector_template: "-t {selector}" })).toBe("bun test");
    });

    test("quotes the selector so it cannot break out of the command", async () => {
        // Selectors come from task files, which are model space.
        const dir = await tmpdir();
        const evil = "x'; touch PWNED; echo '";
        const built = commandFor({ run: "printf %s", selector_template: "{selector}" }, evil);
        await Bun.$`sh -c ${built}`.cwd(dir).quiet().nothrow();
        expect(await Bun.file(join(dir, "PWNED")).exists()).toBe(false);
    });

    test("refuses to scope a selector a runner cannot express", () => {
        expect(() => commandFor({ run: "bun test" }, "some test")).toThrow(/selector_template/);
    });

    test("malformed toml reports the file it failed on", async () => {
        const root = await initRepo();
        await writeConfig(root, "[commands.test\nrun =\n");
        expect(loadConfig(root)).rejects.toThrow(/config\.toml/);
    });
});

describe("doctor", () => {
    const OK = '[commands.test]\nrun = "true"\n';
    const TAIL =
        '\n[skills.backend]\ndefault_verify = ["test"]\n\n' +
        '[gates]\nrequirement = "auto"\nplan = "auto"\nresult = "manual"\n\n' +
        '[git]\nwork_branch_prefix = "work/"\n';

    test("a blank command is reported missing and not run", async () => {
        const root = await initRepo();
        await writeConfig(root, '[commands.test]\nrun = ""\n' + TAIL);
        const out = await captured(() => doctor(root));
        expect(out).toMatch(/test\s+MISSING/);
    });

    test("all commands passing reports healthy", async () => {
        const root = await initRepo();
        await writeConfig(root, OK + TAIL);
        const out = await captured(() => doctor(root));
        expect(out.toLowerCase()).toContain("healthy");
        expect(out).toMatch(/test\s+PASS/);
    });

    test("an unusable repo still exits zero", async () => {
        const root = await initRepo();
        await writeConfig(root, '[commands.test]\nrun = ""\n' + TAIL);
        const out = await captured(() => doctor(root));
        expect(out.toLowerCase()).toContain("unusable");
    });

    test("a failing command does not stop the report", async () => {
        const root = await initRepo();
        await writeConfig(
            root,
            '[commands.a]\nrun = "false"\n\n[commands.b]\nrun = "true"\n' + TAIL,
        );
        const out = await captured(() => doctor(root));
        expect(out).toMatch(/a\s+FAIL/);
        expect(out).toMatch(/b\s+PASS/);
        expect(out.toLowerCase()).toContain("degraded");
    });

    test("a command over the threshold is reported slow", () => {
        expect(classify({ run: "x" }, { exit: 0, ms: SLOW_MS + 1 })).toBe("SLOW");
        expect(classify({ run: "x" }, { exit: 0, ms: 10 })).toBe("PASS");
        expect(classify({ run: "x" }, { exit: 1, ms: SLOW_MS + 1 })).toBe("FAIL");
        expect(classify({ run: "" }, null)).toBe("MISSING");
    });

    test("reports when the wired guards cannot run", async () => {
        const root = await initRepo();
        await writeConfig(root, OK + TAIL);
        const p = Bun.spawn(["bun", join(REPO_ROOT, "bin/craftpath.ts"), "doctor"], {
            cwd: root,
            env: { ...process.env, PATH: pathWithoutCraftpath() },
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(0);
        const out = await new Response(p.stdout).text();
        expect(out.toLowerCase()).toContain("guards");
        expect(out.toLowerCase()).toContain("not active");
    });

    test("says nothing about guards when they are active", async () => {
        const root = await initRepo();
        await writeConfig(root, OK + TAIL);
        const fakeBin = join(root, "fakebin");
        await Bun.write(join(fakeBin, "craftpath"), "#!/bin/sh\nexit 0\n");
        await Bun.$`chmod +x ${join(fakeBin, "craftpath")}`.quiet();

        const p = Bun.spawn(["bun", join(REPO_ROOT, "bin/craftpath.ts"), "doctor"], {
            cwd: root,
            env: { ...process.env, PATH: `${fakeBin}:${pathWithoutCraftpath()}` },
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(0);
        expect((await new Response(p.stdout).text()).toLowerCase()).not.toContain(
            "not active",
        );
    });
});

// ---------------------------------------------------------------------------

describe("task add", () => {
    const WORK_ID = "0001-avatar-upload";

    async function repoWithWork(): Promise<string> {
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        return root;
    }

    test("creates prose and kernel state together", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));

        const files = await Array.fromAsync(
            new Bun.Glob("T001*.md").scan({ cwd: join(root, ".craftpath/work", WORK_ID, "tasks") }),
        );
        expect(files).toHaveLength(1);

        const state = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK_ID, "T001.json")).json(),
        );
        expect(state.status).toBe("pending");
        expect(state.evidence).toEqual([]);
        expect(state.git.trailer).toBe("Task: T001");
    });

    test("refuses a duplicate task id", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "First" }));
        expect(taskAdd(root, "T001", { title: "Second" })).rejects.toThrow(
            PreconditionError,
        );
        const body = await Bun.file(
            join(root, ".craftpath/work", WORK_ID, "tasks", "T001-task.md"),
        ).text();
        expect(body).toContain("First");
    });

    test("refuses when no work item is open", async () => {
        const root = await initRepo();
        expect(taskAdd(root, "T001", { title: "Orphan" })).rejects.toThrow(
            PreconditionError,
        );
    });

    test("refuses a dependency that does not exist", async () => {
        const root = await repoWithWork();
        expect(
            taskAdd(root, "T001", { title: "Dependent", dependsOn: ["T009"] }),
        ).rejects.toThrow(/T009/);
        expect(
            await Bun.file(join(root, ".craftpath/state", WORK_ID, "T001.json")).exists(),
        ).toBe(false);
    });

    test("a task it creates is readable by status", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await captured(() =>
            taskAdd(root, "T002", { title: "Wire the UI", dependsOn: ["T001"] }),
        );
        const out = await captured(() => status(root, false));
        expect(out).toMatch(/T002.*blocked.*T001/s);
    });
});


// ---------------------------------------------------------------------------

describe("approve", () => {
    async function repoWithWork(): Promise<string> {
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        return root;
    }

    async function readWork(root: string) {
        return WorkState.parse(
            await Bun.file(
                join(root, ".craftpath/state/0001-avatar-upload/work.json"),
            ).json(),
        );
    }

    test("records a gate approval durably", async () => {
        const root = await repoWithWork();
        await captured(() => approve(root, "plan"));

        const state = await readWork(root);
        expect(gateState(state.approvals, "plan")).toBe("approved");
        expect(gateState(state.approvals, "result")).toBe("pending");
        expect(state.approvals[0]!.by).toContain("@");
    });

    test("refuses a phase that is not a gate", async () => {
        const root = await repoWithWork();
        expect(approve(root, "execute")).rejects.toThrow(/requirement, plan, result/);
    });

    test("re-approving does not overwrite the original record", async () => {
        const root = await repoWithWork();
        await captured(() => approve(root, "plan"));
        const first = (await readWork(root)).approvals[0]!;

        await captured(() => approve(root, "plan"));
        const after = await readWork(root);

        expect(after.approvals).toHaveLength(1);
        expect(after.approvals[0]!.at).toBe(first.at);
    });
});

// ---------------------------------------------------------------------------

describe("cli errors", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    async function run(cwd: string, args: string[]) {
        const p = Bun.spawn(["bun", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
        const code = await p.exited;
        return { code, err: await new Response(p.stderr).text() };
    }

    test("a precondition failure exits 2 with no stack trace", async () => {
        const root = await initRepo();
        const { code, err } = await run(root, ["approve", "plan"]);
        // Exit codes are the contract hooks and CI branch on (src/exit.ts).
        expect(code).toBe(2);
        expect(err).toContain("No open work item");
        expect(err).not.toContain("at taskAdd");
        expect(err).not.toMatch(/^\s*\d+\s*\|/m); // no source-line dump
    });

    test("task done reaches the kernel rather than the usage branch", async () => {
        // Without the CLI case, `task done` exits 4 as an unknown subcommand --
        // which reads to a caller as "you typed it wrong", not "it refused".
        const root = await initRepo();
        const { code, err } = await run(root, ["task", "done", "T001"]);
        expect(code).toBe(2);
        expect(err).toContain("No open work item");
    });

    test("corrupt state exits 3", async () => {
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        await Bun.write(
            join(root, ".craftpath/state/0001-avatar-upload/work.json"),
            "{ not json",
        );
        const { code } = await run(root, ["status"]);
        expect(code).toBe(3);
    });
});

// ---------------------------------------------------------------------------

const CONFIG_TAIL =
    '\n[skills.backend]\ndefault_verify = ["test"]\n\n' +
    '[gates]\nrequirement = "auto"\nplan = "auto"\nresult = "manual"\n\n' +
    '[git]\nwork_branch_prefix = "work/"\n';

/** Repo with an open work item and a configured `test` command. */
async function repoReady(run = "true"): Promise<string> {
    const root = await initRepo();
    await captured(() => workNew(root, "Avatar upload", "light"));
    await Bun.write(
        join(root, ".craftpath/config.toml"),
        `[commands.test]\nrun = "${run}"\n` + CONFIG_TAIL,
    );
    return root;
}

const WORK = "0001-avatar-upload";

/** Overwrites a task's acceptance block. Criteria are model space. */
async function setCriteria(root: string, id: string, yaml: string[]): Promise<void> {
    const dir = join(root, ".craftpath/work", WORK, "tasks");
    const file = (await Array.fromAsync(new Bun.Glob(`${id}*.md`).scan({ cwd: dir })))[0]!;
    const path = join(dir, file);
    const body = await Bun.file(path).text();
    const replaced = body.replace(/acceptance:[\s\S]*?(?=\n---)/, ["acceptance:", ...yaml].join("\n"));
    await Bun.write(path, replaced);
}

const SUITE_CRITERION = [
    "  - id: A1",
    "    text: the endpoint rejects unsupported formats",
    "    verified_by:",
    "      - cmd: test",
];

async function readState(root: string, id: string) {
    return TaskState.parse(
        await Bun.file(join(root, ".craftpath/state", WORK, `${id}.json`)).json(),
    );
}

describe("task start", () => {
    test("moves a pending task to in progress", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await captured(() => taskStart(root, "T001"));
        expect((await readState(root, "T001")).status).toBe("in_progress");
    });

    test("refuses a blocked task and names the blocker", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "First" }));
        await captured(() => taskAdd(root, "T002", { title: "Second", dependsOn: ["T001"] }));
        expect(taskStart(root, "T002")).rejects.toThrow(/T001/);
        expect((await readState(root, "T002")).status).toBe("pending");
    });

    test("starting twice is a resume not an error", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "First" }));
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskStart(root, "T001"));
        expect((await readState(root, "T001")).status).toBe("in_progress");
    });
});

describe("task verify", () => {
    async function started(run = "true"): Promise<string> {
        const root = await repoReady(run);
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));
        return root;
    }

    test("records exit code and config hash for the whole suite", async () => {
        const root = await started();
        await captured(() => taskVerify(root, "T001"));

        const state = await readState(root, "T001");
        expect(state.evidence).toHaveLength(1);
        expect(state.evidence[0]!.cmd).toBe("test");
        expect(state.evidence[0]!.exit).toBe(0);
        // Suite-wide: it ran everything, and says so.
        expect(state.evidence[0]!.selector).toBeNull();
        expect(state.evidence[0]!.config_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    test("writes the log the evidence points at", async () => {
        const root = await started("echo hello-from-the-suite");
        await captured(() => taskVerify(root, "T001"));
        const state = await readState(root, "T001");
        const log = join(root, ".craftpath/state", WORK, state.evidence[0]!.log);
        expect(await Bun.file(log).text()).toContain("hello-from-the-suite");
    });

    test("passing evidence satisfies its criterion", async () => {
        const root = await started();
        await captured(() => taskVerify(root, "T001"));
        const out = await captured(() => status(root, false));
        expect(out).toMatch(/T001.*in_progress/s);
        expect(await unsatisfiedFor(root, "T001")).toEqual([]);
    });

    test("failing evidence is recorded and satisfies nothing", async () => {
        const root = await started("false");
        await captured(() => taskVerify(root, "T001"));
        const state = await readState(root, "T001");
        expect(state.evidence[0]!.exit).not.toBe(0);
        expect(state.status).toBe("in_progress");
        expect(await unsatisfiedFor(root, "T001")).toEqual(["A1"]);
    });

    test("editing config makes prior evidence stale", async () => {
        const root = await started();
        await captured(() => taskVerify(root, "T001"));
        expect(await unsatisfiedFor(root, "T001")).toEqual([]);

        await Bun.write(
            join(root, ".craftpath/config.toml"),
            '[commands.test]\nrun = "true # changed"\n' + CONFIG_TAIL,
        );
        expect(await unsatisfiedFor(root, "T001")).toEqual(["A1"]);
    });

    test("refuses a command the config does not define", async () => {
        const root = await started();
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the endpoint rejects unsupported formats",
            "    verified_by:",
            "      - cmd: nonexistent",
        ]);
        expect(taskVerify(root, "T001")).rejects.toThrow(/nonexistent/);
        expect((await readState(root, "T001")).evidence).toEqual([]);
    });

    test("refuses a selector the runner cannot scope", async () => {
        const root = await started();
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the endpoint rejects unsupported formats",
            "    verified_by:",
            "      - cmd: test",
            '        selector: "AvatarIT#rejectsTiff"',
        ]);
        expect(taskVerify(root, "T001")).rejects.toThrow(/selector_template/);
        expect((await readState(root, "T001")).evidence).toEqual([]);
    });

    test("runs a shared command once for several criteria", async () => {
        const root = await started();
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the endpoint rejects unsupported formats",
            "    verified_by:",
            "      - cmd: test",
            "  - id: A2",
            "    text: the endpoint accepts a valid upload",
            "    verified_by:",
            "      - cmd: test",
        ]);
        await captured(() => taskVerify(root, "T001"));
        // One run, one record: both criteria are proven by the same suite pass.
        expect((await readState(root, "T001")).evidence).toHaveLength(1);
        expect(await unsatisfiedFor(root, "T001")).toEqual([]);
    });
});

describe("task done", () => {
    /** A real git repo: the trailer check reads history, not a state field. */
    async function gitInit(root: string): Promise<void> {
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
    }

    async function commit(root: string, message: string): Promise<void> {
        await Bun.$`git -C ${root} commit -q --allow-empty -m ${message}`.quiet();
    }

    /** T001 in_progress with its one manual criterion acked. */
    async function satisfied(): Promise<string> {
        const root = await repoReady();
        await gitInit(root);
        await captured(() => taskAdd(root, "T001", { title: "Crop UI" }));
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskAck(root, "T001", "A1"));
        return root;
    }

    test("refuses while a criterion is unsatisfied", async () => {
        const root = await repoReady();
        await gitInit(root);
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));
        await commit(root, "feat: the endpoint\n\nTask: T001");

        expect(taskDone(root, "T001")).rejects.toThrow(/A1/);
        expect((await readState(root, "T001")).status).toBe("in_progress");
    });

    test("refuses when the trailer is absent from the branch", async () => {
        const root = await satisfied();
        // A commit exists, but it does not carry `Task: T001`.
        await commit(root, "chore: unrelated work");

        expect(taskDone(root, "T001")).rejects.toThrow(/Task: T001/);
        expect((await readState(root, "T001")).status).toBe("in_progress");
    });

    test("completes with evidence and a trailer present", async () => {
        const root = await satisfied();
        await commit(root, "feat: crop UI\n\nTask: T001");

        await captured(() => taskDone(root, "T001"));
        expect((await readState(root, "T001")).status).toBe("done");
    });

    test("stale evidence does not complete a task", async () => {
        const root = await repoReady();
        await gitInit(root);
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskVerify(root, "T001"));
        await commit(root, "feat: the endpoint\n\nTask: T001");
        expect(await unsatisfiedFor(root, "T001")).toEqual([]);

        // The commands that produced the evidence are no longer the commands
        // configured, so what was proven was proven about something else.
        await Bun.write(
            join(root, ".craftpath/config.toml"),
            '[commands.test]\nrun = "true # changed"\n' + CONFIG_TAIL,
        );

        expect(taskDone(root, "T001")).rejects.toThrow(/A1/);
        expect((await readState(root, "T001")).status).toBe("in_progress");
    });
});

describe("task ack", () => {
    async function withManual(): Promise<string> {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Crop UI" }));
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        await captured(() => taskStart(root, "T001"));
        return root;
    }

    test("a signed ack satisfies a manual criterion", async () => {
        const root = await withManual();
        await captured(() => taskAck(root, "T001", "A1"));
        const state = await readState(root, "T001");
        expect(state.acks[0]!.by).toContain("@");
        expect(await unsatisfiedFor(root, "T001")).toEqual([]);
    });

    test("refuses to ack a command-verified criterion", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));
        expect(taskAck(root, "T001", "A1")).rejects.toThrow(/verify/);
    });

    test("refuses an unknown criterion id", async () => {
        const root = await withManual();
        expect(taskAck(root, "T001", "A9")).rejects.toThrow(/A9/);
    });
});

// ---------------------------------------------------------------------------

describe("skills", () => {
    const REPO = join(import.meta.dir, "..");

    /** Frontmatter of a skill in this repo's catalog. */
    async function frontmatterOf(skill: string) {
        const source = await Bun.file(join(REPO, ".claude/skills", skill, "SKILL.md")).text();
        const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
        expect(match).not.toBeNull();
        return Bun.YAML.parse(match![1]!) as { name?: string; description?: string };
    }

    async function evalsOf(skill: string) {
        const raw = await Bun.file(join(REPO, ".claude/skills", skill, "evals/evals.json")).text();
        return JSON.parse(raw) as {
            skill_name?: string;
            evals?: { prompt?: string; expected_output?: string }[];
        };
    }

    /**
     * A skill's evals are its only mechanical proof. Two cases minimum: one is
     * an anecdote, and a suite of one cannot show the skill generalises.
     */
    function assertEvals(suite: Awaited<ReturnType<typeof evalsOf>>, skill: string) {
        expect(suite.skill_name).toBe(skill);
        expect(suite.evals?.length ?? 0).toBeGreaterThanOrEqual(2);
        for (const c of suite.evals ?? []) {
            expect(c.prompt?.length ?? 0).toBeGreaterThan(0);
            expect(c.expected_output?.length ?? 0).toBeGreaterThan(0);
        }
    }

    test("ux skill frontmatter declares its exclusions", async () => {
        const fm = await frontmatterOf("ux");
        expect(fm.name).toBe("ux");
        // When to use it, and the boundary that stops description-matching from
        // loading this and `frontend` together for every UI task.
        expect(fm.description).toMatch(/\buse\b/i);
        expect(fm.description).toMatch(/does not implement/i);
        expect(fm.description).toMatch(/frontend/i);
    });

    test("ux evals parse and name their skill", async () => {
        assertEvals(await evalsOf("ux"), "ux");
    });

    test("planning skill distinguishes task-local from boundary design", async () => {
        const skill = await Bun.file(join(REPO, ".claude/skills/planning/SKILL.md")).text();

        // The test that decides the level, and a different artifact for each side.
        expect(skill).toMatch(/would a different answer change the task list/i);
        expect(skill).toMatch(/design\.md/);
        expect(skill).toMatch(/design:/);
        expect(skill).toMatch(/\bux\b/);
        expect(skill).toMatch(/\barchitecture\b/);
    });

    test("planning checklist requires design tasks to have a consumer", async () => {
        const skill = await Bun.file(join(REPO, ".claude/skills/planning/SKILL.md")).text();
        const checklist = skill.slice(skill.indexOf("## Before submitting the plan"));

        // An eleventh item: a design task nothing depends on produced nothing.
        expect(checklist).toMatch(/^11\. .*design task/im);
        expect(checklist).toMatch(/depends on it|consumes it|depended on/i);
    });

    test("architecture skill frontmatter declares its scope", async () => {
        const fm = await frontmatterOf("architecture");
        expect(fm.name).toBe("architecture");
        expect(fm.description).toMatch(/\buse\b/i);
        // Distinguished from work-level boundary design, which happens before
        // the decomposition rather than inside a task.
        expect(fm.description).toMatch(/boundary/i);
    });

    test("architecture evals parse and name their skill", async () => {
        assertEvals(await evalsOf("architecture"), "architecture");
    });
});

// ---------------------------------------------------------------------------

describe("templates", () => {
    test("work-level design template scopes itself to boundary decisions", async () => {
        const { DESIGN_TEMPLATE } = await import("../src/templates/design");
        // The test that decides which level a decision belongs at.
        expect(DESIGN_TEMPLATE).toMatch(/would a different answer change the task list/i);
        expect(DESIGN_TEMPLATE).toMatch(/design:/);
        expect(DESIGN_TEMPLATE).toMatch(/BOUNDARY/);
    });

    test("init writes the per-task design template", async () => {
        const root = await tmpdir();
        await init(root);

        const path = join(root, ".craftpath/templates/task-design.md");
        expect(await Bun.file(path).exists()).toBe(true);
        // A decision contradicting an approved criterion must route to amend,
        // not widen the dependent task quietly.
        expect(await Bun.file(path).text()).toMatch(/craftpath amend/);
    });

    test("init does not overwrite an edited template", async () => {
        const root = await tmpdir();
        await init(root);

        const edited = join(root, ".craftpath/templates/design.md");
        await Bun.write(edited, "# my own design template\n");
        await init(root);

        expect(await Bun.file(edited).text()).toBe("# my own design template\n");
        // The second template is still created alongside the edited one.
        expect(await Bun.file(join(root, ".craftpath/templates/task-design.md")).exists()).toBe(true);
    });
});

// ---------------------------------------------------------------------------

describe("task inputs", () => {
    const DESIGN_DOC = `.craftpath/work/${WORK}/design-D001.md`;
    const ARTBOARD = `.craftpath/work/${WORK}/crop.dc.html`;

    /** A task file written directly: `task add` does not author design blocks. */
    async function writeTask(root: string, id: string, extra: string): Promise<void> {
        await Bun.write(
            join(root, ".craftpath/work", WORK, "tasks", `${id}-fixture.md`),
            `---\nid: ${id}\ntitle: Fixture task ${id}\n${extra}acceptance:\n` +
                `  - id: A1\n    text: a reviewer confirms the decision\n` +
                `    verified_by:\n      - cmd: manual\n---\n`,
        );
    }

    async function markDone(root: string, id: string): Promise<void> {
        await Bun.write(
            join(root, ".craftpath/state", WORK, `${id}.json`),
            JSON.stringify({
                id,
                status: "done",
                evidence: [],
                acks: [],
                git: { trailer: `Task: ${id}` },
            }),
        );
    }

    /** D001 done, producing `produces`; T001 depends on it. */
    async function withDesign(produces: string[], onDisk: string[]): Promise<string> {
        const root = await repoReady();
        await writeTask(
            root,
            "D001",
            "skills: [ux]\ndesign:\n  kind: ux\n  reason: three viable crop models, " +
                "and the choice changes the upload API\nproduces:\n" +
                produces.map((p) => `  - ${p}\n`).join(""),
        );
        await markDone(root, "D001");
        await writeTask(root, "T001", "depends_on: [D001]\n");
        for (const path of onDisk) await Bun.write(join(root, path), `body of ${path}\n`);
        return root;
    }

    test("resolves produces from a done dependency", async () => {
        const root = await withDesign([DESIGN_DOC, ARTBOARD], [DESIGN_DOC, ARTBOARD]);
        const { resolveInputs } = await import("../src/core/task");
        const { readTasks } = await import("../src/core/work");

        const tasks = await readTasks(root, WORK);
        const inputs = await resolveInputs(root, tasks.get("T001")!, tasks);

        expect(inputs.map((i) => i.path).sort()).toEqual([ARTBOARD, DESIGN_DOC].sort());
        expect(inputs.find((i) => i.path === DESIGN_DOC)?.content).toContain("body of");
    });

    test("refuses to start when a declared artifact is missing", async () => {
        // D001 claims the artboard; only the document was written.
        const root = await withDesign([DESIGN_DOC, ARTBOARD], [DESIGN_DOC]);

        expect(taskStart(root, "T001")).rejects.toThrow(/crop\.dc\.html/);

        const { readTasks } = await import("../src/core/work");
        expect((await readTasks(root, WORK)).get("T001")!.status).toBe("pending");
    });

    test("ignores artifacts no dependency declared", async () => {
        const root = await withDesign([DESIGN_DOC], [DESIGN_DOC]);
        await Bun.write(join(root, ".craftpath/work", WORK, "scratch.md"), "undeclared\n");

        const { resolveInputs } = await import("../src/core/task");
        const { readTasks } = await import("../src/core/work");
        const tasks = await readTasks(root, WORK);

        expect((await resolveInputs(root, tasks.get("T001")!, tasks)).map((i) => i.path))
            .toEqual([DESIGN_DOC]);
    });

    test("a task with no dependencies reads nothing", async () => {
        const root = await repoReady();
        await writeTask(root, "T002", "");
        const { resolveInputs } = await import("../src/core/task");
        const { readTasks } = await import("../src/core/work");
        const tasks = await readTasks(root, WORK);

        // A root that does not exist: any filesystem read would fail here.
        expect(await resolveInputs("/nonexistent-root", tasks.get("T002")!, tasks)).toEqual([]);
    });
});

describe("validate", () => {
    /** The rejection validate produced, or null when it passed. */
    async function failure(root: string): Promise<(Error & { exitCode?: number }) | null> {
        return await validate(root).then(
            () => null,
            (error: Error & { exitCode?: number }) => error,
        );
    }

    /** Kernel state for T001 carrying one evidence record. */
    async function withEvidence(root: string, exit: number): Promise<void> {
        await Bun.write(
            join(root, ".craftpath/state", WORK, "T001.json"),
            JSON.stringify({
                id: "T001",
                status: "in_progress",
                evidence: [
                    {
                        cmd: "test",
                        selector: "T001 works",
                        exit,
                        log: "logs/T001-test.log",
                        config_hash: HASH_A,
                        at: "2026-09-14T10:00:00Z",
                    },
                ],
                acks: [],
                git: { trailer: "Task: T001", commits_hint: [] },
            }),
        );
    }

    test("a half-finished work item is structurally valid", async () => {
        // The Stop hook runs this on every pause. Unfinished is not invalid.
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await captured(() => taskAdd(root, "T002", { title: "Add the page" }));
        await setCriteria(root, "T002", SUITE_CRITERION);
        await captured(() => taskStart(root, "T002"));
        await captured(() => taskVerify(root, "T002"));

        expect(await failure(root)).toBeNull();
    });

    test("re-verifying after a failure stays valid", async () => {
        // Red then green is the normal flow. The failing run must keep its own
        // log, or the green run overwrites it and the old record looks forged.
        const root = await repoReady("test -f green");
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskVerify(root, "T001"));
        await Bun.write(join(root, "green"), "");
        await captured(() => taskVerify(root, "T001"));

        expect((await readState(root, "T001")).evidence.map((e) => e.exit)).toEqual([1, 0]);
        expect(await failure(root)).toBeNull();
    });

    test("detects a dependency cycle", async () => {
        const root = await repoReady();
        await writeTask(root, WORK, "T001", ["T002"]);
        await writeTask(root, WORK, "T002", ["T001"]);

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("T001");
        expect(error?.message).toContain("T002");
    });

    test("evidence pointing at a missing log fails", async () => {
        const root = await repoReady();
        await writeTask(root, WORK, "T001");
        await withEvidence(root, 0);

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("T001");
        expect(error?.message).toContain("logs/T001-test.log");
    });

    test("a log disagreeing with its recorded exit code fails", async () => {
        const root = await repoReady();
        await writeTask(root, WORK, "T001");
        await withEvidence(root, 0);
        // What task verify writes, with the run having actually failed.
        await Bun.write(
            join(root, ".craftpath/state", WORK, "logs/T001-test.log"),
            "$ bun test -t 'T001 works'\n\n1 fail\n\nexit: 1\n",
        );

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("T001");
        expect(error?.message).toMatch(/exit/);
    });

    test("a dangling dependency fails", async () => {
        const root = await repoReady();
        await writeTask(root, WORK, "T001", ["T009"]);

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("T001");
        expect(error?.message).toContain("T009");
        // Not misreported as a cycle: waves() cannot tell the two apart.
        expect(error?.message).not.toMatch(/cycle/);
    });
});

describe("validate complete", () => {
    async function failure(root: string): Promise<(Error & { exitCode?: number }) | null> {
        return await validateComplete(root).then(
            () => null,
            (error: Error & { exitCode?: number }) => error,
        );
    }

    const DELTA = [
        "## ADDED",
        "- AVATAR-R1 — a user can upload an avatar",
        "",
        "## MODIFIED",
        "- (none)",
        "",
        "## REMOVED",
        "- (none)",
        "",
    ].join("\n");

    type Omitted =
        | "tasks"
        | "done"
        | "requirement gate"
        | "plan gate"
        | "result gate"
        | "spec delta"
        | "delta content";

    /**
     * A work item with everything proven: T001 done on a signed ack and its
     * trailer, every gate approved, a filled-in spec delta. Each argument
     * leaves exactly one of those out, so a test names the one thing missing.
     */
    async function proven(...omit: Omitted[]): Promise<string> {
        const root = await repoReady();
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();

        if (!omit.includes("tasks")) {
            await captured(() => taskAdd(root, "T001", { title: "Crop UI" }));
            await setCriteria(root, "T001", [
                "  - id: A1",
                "    text: the crop UI matches the approved mock",
                "    verified_by:",
                "      - cmd: manual",
            ]);
            await captured(() => taskStart(root, "T001"));
            await captured(() => taskAck(root, "T001", "A1"));
            await Bun.$`git -C ${root} commit -q --allow-empty -m ${"feat: crop UI\n\nTask: T001"}`.quiet();
            if (!omit.includes("done")) await captured(() => taskDone(root, "T001"));
        }

        for (const gate of ["requirement", "plan", "result"]) {
            if (!omit.includes(`${gate} gate` as Omitted)) {
                await captured(() => approve(root, gate));
            }
        }

        const delta = join(root, ".craftpath/work", WORK, "spec-delta.md");
        if (omit.includes("spec delta")) await Bun.file(delta).delete();
        else if (!omit.includes("delta content")) await Bun.write(delta, DELTA);
        return root;
    }

    test("passes when everything is proven", async () => {
        expect(await failure(await proven())).toBeNull();
    });

    test("refuses while a task is unfinished", async () => {
        const error = await failure(await proven("done"));
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("T001");
    });

    test("refuses while a required gate is pending", async () => {
        const error = await failure(await proven("result gate"));
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("result");
    });

    test("refuses without a spec delta", async () => {
        const error = await failure(await proven("spec delta"));
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("spec-delta.md");
    });

    test("refuses a spec delta still holding the template placeholder", async () => {
        // work new always scaffolds spec-delta.md, so absent is the rare case;
        // the untouched template is the common one.
        const error = await failure(await proven("delta content"));
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("spec-delta.md");
        expect(error?.message).toMatch(/placeholder/);
    });

    test("refuses a work item with no tasks", async () => {
        // Nothing to prove is not the same as proven.
        const error = await failure(await proven("tasks"));
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toMatch(/no tasks/);
    });

    test("refuses a done task whose proof has gone stale", async () => {
        const root = await proven();
        const config = join(root, ".craftpath/config.toml");
        await Bun.write(config, (await Bun.file(config).text()) + "\n# edited\n");

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("T001");
        expect(error?.message).toContain("A1");
    });

    test("refuses a done task whose trailer is gone from the branch", async () => {
        const root = await proven();
        await Bun.$`git -C ${root} commit -q --allow-empty --amend -m ${"feat: crop UI"}`.quiet();

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("Task: T001");
    });

    test("refuses a structurally invalid work item", async () => {
        const root = await proven();
        const statePath = join(root, ".craftpath/state", WORK, "T001.json");
        const state = await Bun.file(statePath).json();
        state.evidence.push({
            cmd: "test",
            selector: null,
            exit: 0,
            log: "logs/T001-test-1.log",
            config_hash: HASH_A,
            at: "2026-09-15T10:00:00Z",
        });
        await Bun.write(statePath, JSON.stringify(state));

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toContain("logs/T001-test-1.log");
    });
});
