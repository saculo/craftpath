import { describe, expect, test } from "bun:test";
import { shouldBlock } from "../src/hooks/guard-bash";
import { insideState, targets } from "../src/hooks/guard-write";
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
import { type Acceptance, TaskProse, TaskState, WorkState } from "../src/schema";
import { init } from "../src/core/init";
import { isConfigured, loadConfig } from "../src/core/config";
import { SLOW_MS, classify, doctor, guardsState } from "../src/core/doctor";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
import { branchName, nextId, slugify, sortedEntries, status, workNew } from "../src/core/work";
import {
    taskAck,
    taskAdd,
    taskAmend,
    taskDone,
    taskStart,
    taskVerify,
    unsatisfiedFor,
} from "../src/core/task";
import { approve, gateState } from "../src/core/approve";
import { validate, validateComplete } from "../src/core/validate";
import { derivePhase } from "../src/core/gates";
import { prBody } from "../src/core/pr";
import { archive } from "../src/core/archive";
import { SKILLS } from "../src/skills/index";
import { CLAUDE_CODE } from "../src/harness/claude-code";
import { render } from "../src/harness/render";
import { RULES } from "../src/rules/index";
import { SPEC_DELTA_TEMPLATE } from "../src/templates/spec-delta";
import { WORK_COMMAND } from "../src/commands/work";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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
    verified_by: [{ cmd: "test-integration" }],
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
function rejectedAt(
    result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } },
    ...path: PropertyKey[]
) {
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

describe("guard-bash: a craftpath call does not exempt the rest of the chain", () => {
    // The CLI pattern used to be tested against the whole command, so any
    // chain that opened with a craftpath call was allowed wholesale -- and the
    // allow-list already treats chaining as an ordinary shape.
    const blocked = [
        "craftpath status && echo x > .craftpath/state/T1.json",
        "craftpath status; sed -i s/pending/done/ .craftpath/state/0001/T001.json",
        "craftpath task done T001 | tee .craftpath/state/0001/T001.json",
        "cd /repo && craftpath status && rm .craftpath/state/0001/T001.json",
    ];
    for (const cmd of blocked) {
        test(cmd.slice(0, 50), () => expect(shouldBlock(cmd)).toBe(true));
    }
});

describe("guard-write: which paths reach state", () => {
    // The path half of the trust boundary is the one that is supposed to be
    // exact, so it is matched on the resolved path rather than a substring.
    const refused = [
        ".craftpath/state/T1.json",
        ".craftpath/work/../state/T1.json",
        ".craftpath/./state/T1.json",
        "./.craftpath/state/0001/T001.json",
        ".craftpath/state",
        // Case-insensitive volumes (macOS) reach the same file.
        ".Craftpath/state/T1.json",
    ];
    for (const path of refused) {
        test(`refuses ${path}`, () => expect(insideState(path, "/repo")).toBe(true));
    }

    const allowed = [
        ".craftpath/work/0001-avatar/tasks/T001-backend.md",
        ".craftpath/config.toml",
        "src/index.ts",
        // Not the state directory: a sibling whose name merely starts the same.
        ".craftpath/statement.md",
    ];
    for (const path of allowed) {
        test(`allows ${path}`, () => expect(insideState(path, "/repo")).toBe(false));
    }

    test("an absolute path inside the project is refused", () => {
        expect(insideState("/repo/.craftpath/state/T1.json", "/repo")).toBe(true);
    });

    test("a path outside the project is not state", () => {
        expect(insideState("/elsewhere/notes.md", "/repo")).toBe(false);
    });
});

describe("guard-write: targets", () => {
    test("covers the single-path shapes", () => {
        expect(targets({ file_path: "a.ts" })).toEqual(["a.ts"]);
        expect(targets({ path: "b.ts" })).toEqual(["b.ts"]);
        expect(targets({ notebook_path: "c.ipynb" })).toEqual(["c.ipynb"]);
    });

    test("covers the per-file edit and batch shapes", () => {
        expect(
            targets({
                file_path: "a.ts",
                edits: [{ file_path: ".craftpath/state/T1.json" }, { path: "b.ts" }],
                files: [{ file_path: "c.ts" }],
            }),
        ).toEqual(["a.ts", ".craftpath/state/T1.json", "b.ts", "c.ts"]);
    });

    test("ignores entries that carry no path", () => {
        expect(targets({ edits: [{ old_string: "x" }, null, "nope"] })).toEqual([]);
        expect(targets({ file_path: 7, edits: "not-a-list" })).toEqual([]);
    });
});

test("guard-bash: a quoted separator does not split a write into halves", () => {
    // Splitting the command and judging each piece alone would let a write hide
    // in a quoted argument: neither half carries both the path and the verb.
    expect(shouldBlock("bun -e \"x; await Bun.write('.craftpath/state/T1.json','{}')\"")).toBe(
        true,
    );
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
        expect(() => isBlocked(mk({ depends_on: ["T999"] }), new Map())).toThrow(CorruptStateError);
    });

    test("start refuses while blocked", () => {
        const t = mk({ depends_on: ["T002"] });
        expect(() => start(t, new Map([dep("T002", "pending")]))).toThrow(PreconditionError);
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
    test("satisfied by a passing run of the named command", () => {
        const t = mk({ status: "in_progress", evidence: [ev()] });
        expect(criterionSatisfied(t, CRITERION, HASH_A)).toBe(true);
    });

    test("evidence from a different command does not satisfy", () => {
        const t = mk({ status: "in_progress", evidence: [ev({ cmd: "lint" })] });
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
        expect(criterionSatisfied(mk({ acceptance: [empty] }), empty, HASH_A)).toBe(false);
    });

    test("unsatisfied lists the right ids", () => {
        expect(unsatisfied(mk({ status: "in_progress" }), HASH_A)).toEqual(["A1"]);
    });
});

// ---------------------------------------------------------------------------

describe("completion", () => {
    test("refuses with unsatisfied criteria", () => {
        expect(() => done(mk({ status: "in_progress" }), HASH_A, true)).toThrow(PreconditionError);
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
        expect(() => start(mk({ status: "done" }), new Map())).toThrow(PreconditionError);
    });

    test("amend returns a patch and leaves the task untouched", () => {
        // start, verify, ack and done all compute a status and mutate nothing.
        // amend was the exception, and it is the one function whose entire job
        // is destroying evidence: a caller persisting a state object it read
        // before the call would keep evidence the amendment had cleared. The
        // current caller happens to clear it a second time itself, which is
        // the tell.
        const t = mk({
            status: "done",
            evidence: [ev()],
            acks: [
                {
                    criterion_id: "A2",
                    by: "me@example.com",
                    at: "2026-09-11T10:00:00Z",
                    config_hash: HASH_A,
                },
            ],
        });

        expect(amend()).toEqual({ status: "pending", evidence: [], acks: [] });
        expect(t.evidence).toHaveLength(1);
        expect(t.acks).toHaveLength(1);
        expect(t.status).toBe("done");
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

    test("rejects a malformed task id", () => {
        expect(
            TaskProse.safeParse({ id: "T4", title: "x y z", acceptance: [CRITERION] }).success,
        ).toBe(false);
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
        for (const outside of ["../../etc/passwd", "/etc/passwd"]) {
            rejectedAt(TaskProse.safeParse({ ...DESIGN_TASK, produces: [outside] }), "produces", 0);
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
        // Executable in git, so a fresh clone runs it -- and bun add -g does not
        // have to loosen it, which it does to world-writable.
        const staged = await Bun.$`git -C ${ROOT} ls-files -s bin/craftpath.ts`.quiet().text();
        expect(staged).toStartWith("100755");
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

    test("readme documents the global install", async () => {
        const readme = await Bun.file(join(ROOT, "README.md")).text();
        // The registry install is the one a user follows; the checkout link is
        // for working on craftpath itself. Both are `bun add -g`, because
        // `bun link` only symlinks into a project's node_modules, which is not
        // on the PATH hooks resolve `craftpath` through.
        expect(readme).toContain("bun add -g craftpath");
        expect(readme).toContain('bun add -g "$PWD"');
        expect(readme).not.toContain("bun link");
        // The reason matters more than the command: an unlinked craftpath means
        // the guards silently do not run.
        expect(readme.toLowerCase()).toContain("hook");
    });

    test("package.json carries what publishing needs", async () => {
        const pkg = await Bun.file(join(ROOT, "package.json")).json();
        for (const field of ["description", "license", "repository", "files"]) {
            expect(pkg[field]).toBeDefined();
        }
        // Without `files`, npm packs everything git does not ignore -- which
        // included craftpath's own .claude/, the internal tooling that the
        // skills and rules modules both say does not ship.
        expect(pkg.files).toContain("bin/");
        expect(pkg.files).toContain("src/");
        expect(pkg.files).toContain("!src/**/*.test.ts");
        expect(await Bun.file(join(ROOT, "LICENSE")).exists()).toBe(true);
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
        // The exact command for this checkout, so the fix can be pasted.
        expect(err).toContain(`bun add -g ${resolve(ROOT)}`);
        expect(err).not.toContain("bun link");
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
        const after = await Array.fromAsync(
            new Bun.Glob("*").scan({ cwd: join(root, ".craftpath/work"), onlyFiles: false }),
        );
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
        // Derived from approvals and tasks, never stored.
        expect(raw.phase).toBeUndefined();
        expect(state.approvals).toEqual([]);
    });

    test("refuses a second open work item", async () => {
        const root = await initRepo();
        await workNew(root, "First thing", "light");
        expect(workNew(root, "Second thing", "light")).rejects.toThrow(PreconditionError);
        const dirs = await Array.fromAsync(
            new Bun.Glob("*").scan({ cwd: join(root, ".craftpath/work"), onlyFiles: false }),
        );
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
        await Bun.write(join(root, ".craftpath/state/0001-avatar-upload/work.json"), "{ not json");
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

describe("the open work item", () => {
    test("directory listings are sorted, not in filesystem order", async () => {
        // `open[0]` over an unsorted readdir made "the current work item" a
        // function of filesystem order. The sibling readTasks already sorts;
        // this is the same call three lines away that did not.
        const dir = join(await tmpdir(), "work");
        await mkdir(dir, { recursive: true });
        const names = [
            "0007-g",
            "0003-c",
            "0010-j",
            "0001-a",
            "0005-e",
            "0009-i",
            "0002-b",
            "0008-h",
            "0004-d",
            "0006-f",
        ];
        for (const name of names) await mkdir(join(dir, name));
        await Bun.write(join(dir, ".gitkeep"), "");

        expect(await sortedEntries(dir)).toEqual([...names].sort());
    });

    test("two open work items refuse rather than pick one", async () => {
        // workNew refuses a second one, but an interrupted archive, a manual
        // copy or a merge can still leave two -- and then status and workNew's
        // error message could name different items.
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        await mkdir(join(root, ".craftpath/work/0002-second-thing"), { recursive: true });

        const error = await status(root, false).then(
            () => null,
            (e: Error) => e,
        );
        expect(error).toBeInstanceOf(CorruptStateError);
        expect(error!.message).toContain("0001-avatar-upload");
        expect(error!.message).toContain("0002-second-thing");
    });

    test("one open work item is still read normally", async () => {
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        const out = await captured(() => status(root, true));
        expect(out).toContain("0001-avatar-upload");
    });
});

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

    test("names a dangling dependency instead of calling it a cycle", async () => {
        // waves() reports a dangling edge as a cycle, because the missing task
        // is never done. `validate` already solved this; status hit waves()
        // first and reported "dependency cycle among: T001" for a task that
        // simply points at one that does not exist.
        const root = await repoWithWork();
        await writeTask(root, WORK_ID, "T001", ["T009"]);
        const out = await captured(() => status(root, false));
        expect(out).toContain("T009");
        expect(out).toContain("T001");
        expect(out.toLowerCase()).not.toContain("cycle");
    });

    test("a real cycle still reads as a cycle", async () => {
        const root = await repoWithWork();
        await writeTask(root, WORK_ID, "T001", ["T002"]);
        await writeTask(root, WORK_ID, "T002", ["T001"]);
        const out = await captured(() => status(root, false));
        expect(out.toLowerCase()).toContain("cycle");
        expect(out).toContain("T001");
        expect(out).toContain("T002");
    });

    test("status and validate give one answer for the same graph", async () => {
        const root = await repoWithWork();
        await writeTask(root, WORK_ID, "T001", ["T009"]);

        const out = await captured(() => status(root, false));
        const error = await validate(root).then(
            () => null,
            (e: Error) => e,
        );

        const sentence = "T001 depends on T009, which does not exist";
        expect(error?.message).toContain(sentence);
        expect(out).toContain(sentence);
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
            .env({
                ...process.env,
                GIT_AUTHOR_NAME: "t",
                GIT_AUTHOR_EMAIL: "t@e.c",
                GIT_COMMITTER_NAME: "t",
                GIT_COMMITTER_EMAIL: "t@e.c",
            })
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

    test("a config still carrying selector_template is refused by name", async () => {
        // Selectors are gone: a criterion names a command and the command runs
        // whole. `.strict()` means a leftover key is refused rather than
        // ignored, so the fix is visible -- delete the line.
        const root = await initRepo();
        await writeConfig(
            root,
            '[commands.test]\nrun = "bun test"\nselector_template = "-t {selector}"\n' +
                CONFIG_TAIL,
        );
        const error = await loadConfig(root).then(
            () => null,
            (e: Error & { exitCode?: number }) => e,
        );
        expect(error?.message).toContain("selector_template");
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

    test("runs project commands in the given root", async () => {
        // doctor(root) took a root and ignored it for the one thing that
        // touches the filesystem, so a test passing a temp dir ran the
        // developer's real suite instead.
        const root = await initRepo();
        await Bun.write(join(root, "marker"), "");
        await writeConfig(root, '[commands.test]\nrun = "test -f marker"\n' + TAIL);
        const out = await captured(() => doctor(root));
        expect(out).toMatch(/test\s+PASS/);
    });

    test("a command that never finishes is reported slow", async () => {
        // §8 promises doctor "flags any command over 5 minutes -- a slow gate
        // is a gate that gets skipped", which required the command to finish:
        // a hung suite hung doctor instead of being reported.
        const root = await initRepo();
        await writeConfig(root, '[commands.test]\nrun = "sleep 30"\n' + TAIL);
        const started = Bun.nanoseconds();
        const out = await captured(() => doctor(root, 200));
        expect(out).toMatch(/test\s+SLOW/);
        expect((Bun.nanoseconds() - started) / 1e9).toBeLessThan(10);
    });

    test("a command over the threshold is reported slow", () => {
        expect(classify({ run: "x" }, { exit: 0, ms: SLOW_MS + 1 })).toBe("SLOW");
        expect(classify({ run: "x" }, { exit: 0, ms: 10 })).toBe("PASS");
        expect(classify({ run: "x" }, { exit: 1, ms: SLOW_MS + 1 })).toBe("FAIL");
        expect(classify({ run: "" }, null)).toBe("MISSING");
    });

    test("tells the three guard states apart", () => {
        const resolve = (bin: string) => (bin === "craftpath" ? "/usr/bin/craftpath" : null);
        // The worst state used to read exactly like the healthy one.
        expect(guardsState([], resolve)).toBe("unwired");
        expect(guardsState(["prettier --write $CLAUDE_FILE_PATHS"], resolve)).toBe("unwired");
        expect(guardsState(["craftpath hook guard-write"], resolve)).toBe("active");
        expect(guardsState(["bun /abs/bin/craftpath.ts hook guard-write"], resolve)).toBe(
            "unresolvable",
        );
    });

    test("says the guards are not wired when nothing wires them", async () => {
        // A project whose .claude/settings.json was deleted or never created
        // has no protection at all, and doctor -- whose stated job is the
        // harness reporting honestly on itself -- said nothing about it.
        const root = await initRepo();
        await writeConfig(root, OK + TAIL);
        await Bun.write(join(root, ".claude/settings.json"), "{}");

        const out = await captured(() => doctor(root));
        expect(out.toLowerCase()).toContain("not wired");
        expect(out).toContain("craftpath init");
    });

    test("a deleted settings file is unwired, not healthy", async () => {
        const root = await initRepo();
        await writeConfig(root, OK + TAIL);
        await Bun.file(join(root, ".claude/settings.json")).delete();

        const out = await captured(() => doctor(root));
        expect(out.toLowerCase()).toContain("not wired");
    });

    test("a hook on another event does not count as a wired guard", async () => {
        // wiredHookCommands flattened every event, so a Stop hook alone read as
        // guards being present.
        const root = await initRepo();
        await writeConfig(root, OK + TAIL);
        await Bun.write(
            join(root, ".claude/settings.json"),
            JSON.stringify({
                hooks: {
                    Stop: [{ hooks: [{ type: "command", command: "craftpath hook validate" }] }],
                },
            }),
        );

        const out = await captured(() => doctor(root));
        expect(out.toLowerCase()).toContain("not wired");
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
        expect(out).toContain(`bun add -g ${resolve(REPO_ROOT)}`);
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
        expect((await new Response(p.stdout).text()).toLowerCase()).not.toContain("not active");
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
        expect(taskAdd(root, "T001", { title: "Second" })).rejects.toThrow(PreconditionError);
        const body = await Bun.file(
            join(root, ".craftpath/work", WORK_ID, "tasks", "T001-task.md"),
        ).text();
        expect(body).toContain("First");
    });

    test("refuses when no work item is open", async () => {
        const root = await initRepo();
        expect(taskAdd(root, "T001", { title: "Orphan" })).rejects.toThrow(PreconditionError);
    });

    test("refuses a dependency that does not exist", async () => {
        const root = await repoWithWork();
        expect(taskAdd(root, "T001", { title: "Dependent", dependsOn: ["T009"] })).rejects.toThrow(
            /T009/,
        );
        expect(await Bun.file(join(root, ".craftpath/state", WORK_ID, "T001.json")).exists()).toBe(
            false,
        );
    });

    test("a task it creates is readable by status", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await captured(() => taskAdd(root, "T002", { title: "Wire the UI", dependsOn: ["T001"] }));
        const out = await captured(() => status(root, false));
        expect(out).toMatch(/T002.*blocked.*T001/s);
    });

    /** The rendered frontmatter, parsed the way readTasks parses it. */
    async function frontmatter(root: string, id: string): Promise<TaskProse> {
        const dir = join(root, ".craftpath/work", WORK_ID, "tasks");
        const file = (await Array.fromAsync(new Bun.Glob(`${id}*.md`).scan({ cwd: dir })))[0]!;
        const body = await Bun.file(join(dir, file)).text();
        return TaskProse.parse(Bun.YAML.parse(/^---\n([\s\S]*?)\n---/.exec(body)![1]!));
    }

    test("task add writes a command and nothing narrower", async () => {
        // Criteria name a command; the command runs whole. Asserted on the
        // rendered text, because there is no longer a field to read: nothing
        // in the generated task should so much as mention a selector.
        const root = await repoWithWork();
        await captured(() =>
            taskAdd(root, "D001", {
                title: "Decide the crop interaction",
                design: "ux",
                designReason: "the crop behaviour is not decided anywhere yet",
                produces: [".craftpath/work/design.md"],
            }),
        );
        await captured(() => taskAdd(root, "T001", { title: "Reject TIFF uploads" }));

        const dir = join(root, ".craftpath/work", WORK_ID, "tasks");
        for (const id of ["D001", "T001"]) {
            const file = (await Array.fromAsync(new Bun.Glob(`${id}*.md`).scan({ cwd: dir })))[0]!;
            expect(await Bun.file(join(dir, file)).text()).not.toContain("selector");
        }
        expect((await frontmatter(root, "D001")).acceptance[0]!.verified_by[0]!.cmd).toBe("manual");
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
            await Bun.file(join(root, ".craftpath/state/0001-avatar-upload/work.json")).json(),
        );
    }

    test("records a gate approval durably", async () => {
        const root = await repoWithWork();
        await captured(() => approve(root, "requirement"));

        const state = await readWork(root);
        expect(gateState(state.approvals, "requirement")).toBe("approved");
        expect(gateState(state.approvals, "plan")).toBe("pending");
        expect(state.approvals[0]!.by).toContain("@");
    });

    /** The rejection approve produced, or null when it recorded an approval. */
    async function refusal(
        root: string,
        gate: string,
    ): Promise<(Error & { exitCode?: number }) | null> {
        return await captured(() => approve(root, gate)).then(
            () => null,
            (error: Error & { exitCode?: number }) => error,
        );
    }

    test("refuses plan before requirement", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));

        const error = await refusal(root, "plan");
        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("requirement");
        expect((await readWork(root)).approvals).toEqual([]);
    });

    test("refuses result before plan", async () => {
        const root = await repoWithWork();
        await captured(() => approve(root, "requirement"));

        const error = await refusal(root, "result");
        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("plan");
        expect((await readWork(root)).approvals).toHaveLength(1);
    });

    test("refuses a plan with no tasks", async () => {
        const root = await repoWithWork();
        await captured(() => approve(root, "requirement"));

        const error = await refusal(root, "plan");
        expect(error?.exitCode).toBe(2);
        expect(error?.message).toMatch(/no tasks/);
        expect((await readWork(root)).approvals).toHaveLength(1);
    });

    test("refuses a phase that is not a gate", async () => {
        const root = await repoWithWork();
        expect(approve(root, "execute")).rejects.toThrow(/requirement, plan, result/);
    });

    test("re-approving does not overwrite the original record", async () => {
        const root = await repoWithWork();
        await captured(() => approve(root, "requirement"));
        const first = (await readWork(root)).approvals[0]!;

        await captured(() => approve(root, "requirement"));
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
        await Bun.write(join(root, ".craftpath/state/0001-avatar-upload/work.json"), "{ not json");
        const { code } = await run(root, ["status"]);
        expect(code).toBe(3);
    });

    test("work new --standard before the title uses the title, not the flag", async () => {
        // The usage string advertises [--light|--standard], so writing the flag
        // first is a reasonable thing to do -- and it silently produced a work
        // item titled "--standard", a branch work/0001-standard, and a git
        // trailer nobody would recognise.
        const root = await initRepo();
        const { code } = await run(root, ["work", "new", "--standard", "Avatar upload"]);
        expect(code).toBe(0);

        const dirs = await sortedEntries(join(root, ".craftpath/work"));
        expect(dirs).toEqual(["0001-avatar-upload"]);
        const work = await Bun.file(
            join(root, ".craftpath/state/0001-avatar-upload/work.json"),
        ).json();
        expect(work.title).toBe("Avatar upload");
        // The flag still means what it says when it comes first.
        expect(work.mode).toBe("standard");
    });

    test("work new rejects a flag it does not know", async () => {
        // `--standrd` selected light mode silently. Rejecting unknown flags is
        // also what makes --light mean something rather than be advertised and
        // never read.
        const root = await initRepo();
        const { code, err } = await run(root, ["work", "new", "Avatar upload", "--standrd"]);
        expect(code).toBe(4);
        expect(err).toContain("--standrd");
        // Naming the flags this command does take, rather than dumping the
        // whole usage string over one typo.
        expect(err).toContain("--standard");
        expect(await sortedEntries(join(root, ".craftpath/work"))).toEqual([]);
    });

    test("a typo'd boolean flag is refused rather than quietly doing less", async () => {
        // `validate --complet` ran structural validation and exited 0, which
        // reads as "proven complete" to whoever chained it -- the same shape as
        // `--standrd` selecting light mode.
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));

        const validate = await run(root, ["validate", "--complet"]);
        expect(validate.code).toBe(4);
        expect(validate.err).toContain("--complet");

        const status = await run(root, ["status", "--brif"]);
        expect(status.code).toBe(4);

        // The real flags still work.
        expect((await run(root, ["status", "--brief"])).code).toBe(0);
    });

    test("task add rejects a flag value that is another flag", async () => {
        // `flag()` returns the next argv entry whatever it is, so
        // `--title --skills backend` created a task titled "--skills".
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        const { code, err } = await run(root, [
            "task",
            "add",
            "T001",
            "--title",
            "--skills",
            "backend",
        ]);
        expect(code).toBe(4);
        expect(err).toContain("--title");
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
    const replaced = body.replace(
        /acceptance:[\s\S]*?(?=\n---)/,
        ["acceptance:", ...yaml].join("\n"),
    );
    await Bun.write(path, replaced);
}

const SUITE_CRITERION = [
    "  - id: A1",
    "    text: the endpoint rejects unsupported formats",
    "    verified_by:",
    "      - cmd: test",
];

/**
 * A verify run that is expected to be red.
 *
 * `task verify` refuses on a failing run, so a test whose subject is what
 * happens AFTER a red run has to absorb that refusal -- and assert it happened,
 * or the setup could go green without the test noticing.
 */
async function verifyRed(root: string, id: string): Promise<void> {
    await captured(() =>
        taskVerify(root, id).then(
            () => {
                throw new Error(`${id} verified clean; the test needed a red run`);
            },
            () => {},
        ),
    );
}

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

    test("refuses after a failing run but keeps the evidence", async () => {
        // The refusal is about the exit code, not the record: a red run has to
        // be kept, or a later green one has nothing to be kept alongside.
        // Exiting 0 here meant `craftpath task verify T001 && git commit`
        // proceeded on red, and the refusal arrived a step later, at task done.
        const root = await started("false");
        let error: (Error & { exitCode?: number }) | null = null;
        await captured(async () => {
            error = await taskVerify(root, "T001").then(
                () => null,
                (e: Error & { exitCode?: number }) => e,
            );
        });

        expect(error).not.toBeNull();
        expect(error!.exitCode).toBe(2);
        expect(error!.message).toContain("A1");

        const state = await readState(root, "T001");
        expect(state.evidence[0]!.exit).not.toBe(0);
        expect(state.status).toBe("in_progress");
        expect(await unsatisfiedFor(root, "T001")).toEqual(["A1"]);
    });

    test("a green run does not refuse over a manual criterion", async () => {
        // verify runs commands; a manual criterion is task ack's business. If
        // an unacked manual criterion made a green verify exit non-zero, the
        // normal verify -> ack -> done order would refuse in the middle of
        // itself.
        const root = await started();
        await setCriteria(root, "T001", [
            ...SUITE_CRITERION,
            "  - id: A2",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        const out = await captured(() => taskVerify(root, "T001"));
        expect(out).toContain("unsatisfied: A2");
        expect(await unsatisfiedFor(root, "T001")).toEqual(["A2"]);
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

    test("an amendment does not overwrite the pre-amendment log", async () => {
        // The comment above the log write says "never overwritten: a red run
        // followed by a green one must keep both". An amendment resets evidence
        // to [], so the counter restarted at 1 and clobbered the log the
        // pre-amendment record pointed at. Logs are committed, so that is a
        // rewrite of history in git too.
        const root = await repoReady("echo before-the-amendment");
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();

        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskVerify(root, "T001"));
        const before = (await readState(root, "T001")).evidence[0]!.log;

        await captured(() => taskAmend(root, "T001", "the criterion changed"));
        await Bun.write(
            join(root, ".craftpath/config.toml"),
            '[commands.test]\nrun = "echo after-the-amendment"\n' + CONFIG_TAIL,
        );
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskVerify(root, "T001"));
        const after = (await readState(root, "T001")).evidence[0]!.log;

        expect(after).not.toBe(before);
        const dir = join(root, ".craftpath/state", WORK);
        expect(await Bun.file(join(dir, before)).text()).toContain("before-the-amendment");
        expect(await Bun.file(join(dir, after)).text()).toContain("after-the-amendment");
    });

    test("refuses a criterion still carrying a placeholder", async () => {
        // A placeholder left in place is not a harmless no-op. `bun test -t`
        // exits 1 on no match, but `go test -run` exits 0 with "no tests to
        // run" -- which would mint green evidence for a run that tested
        // "you did not fill this in" is a more specific answer than "that
        // command is not defined".
        const root = await started();
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the endpoint rejects unsupported formats",
            "    verified_by:",
            "      - cmd: <config.toml command key>",
        ]);
        expect(taskVerify(root, "T001")).rejects.toThrow(/placeholder/);
        expect((await readState(root, "T001")).evidence).toEqual([]);
    });

    test("an untouched task add criterion reads as a placeholder", async () => {
        const root = await started();
        await captured(() => taskAdd(root, "T002", { title: "Wire the UI" }));
        await captured(() => taskStart(root, "T002"));
        expect(taskVerify(root, "T002")).rejects.toThrow(/placeholder/);
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
        await commit(root, `feat: the endpoint\n\nWork: ${WORK}\nTask: T001`);

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
        await commit(root, `feat: crop UI\n\nWork: ${WORK}\nTask: T001`);

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
        await commit(root, `feat: the endpoint\n\nWork: ${WORK}\nTask: T001`);
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

    test("ux skill frontmatter declares its exclusions", async () => {
        const fm = await frontmatterOf("ux");
        expect(fm.name).toBe("ux");
        // When to use it, and the boundary that stops description-matching from
        // loading this and `frontend` together for every UI task.
        expect(fm.description).toMatch(/\buse\b/i);
        expect(fm.description).toMatch(/does not implement/i);
        expect(fm.description).toMatch(/frontend/i);
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

    test("init does not scaffold a PR body template", async () => {
        // pr body generates the whole description from what was proven. A
        // template beside it is an invitation to write one freehand.
        const root = await tmpdir();
        await init(root);
        expect(await Bun.file(join(root, ".craftpath/templates/pr-body.md")).exists()).toBe(false);
    });

    test("init does not overwrite an edited template", async () => {
        const root = await tmpdir();
        await init(root);

        const edited = join(root, ".craftpath/templates/design.md");
        await Bun.write(edited, "# my own design template\n");
        await init(root);

        expect(await Bun.file(edited).text()).toBe("# my own design template\n");
        // The second template is still created alongside the edited one.
        expect(await Bun.file(join(root, ".craftpath/templates/task-design.md")).exists()).toBe(
            true,
        );
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

        expect((await resolveInputs(root, tasks.get("T001")!, tasks)).map((i) => i.path)).toEqual([
            DESIGN_DOC,
        ]);
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
        await verifyRed(root, "T001");
        await Bun.write(join(root, "green"), "");
        await captured(() => taskVerify(root, "T001"));

        expect((await readState(root, "T001")).evidence.map((e) => e.exit)).toEqual([1, 0]);
        expect(await failure(root)).toBeNull();
    });

    test("passes on a fresh clone of a verified work item", async () => {
        // validate reads every evidence log. If logs stay out of git, CI and
        // every other machine fail it on work that was genuinely verified.
        const root = await repoReady();
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskVerify(root, "T001"));
        await Bun.$`git -C ${root} add -A`.quiet();
        await Bun.$`git -C ${root} commit -q -m ${`feat: endpoint\n\nWork: ${WORK}\nTask: T001`}`.quiet();

        const clone = join(await tmpdir(), "clone");
        await Bun.$`git clone -q ${root} ${clone}`.quiet();

        expect(await failure(clone)).toBeNull();
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
            await Bun.$`git -C ${root} commit -q --allow-empty -m ${`feat: crop UI\n\nWork: ${WORK}\nTask: T001`}`.quiet();
            if (!omit.includes("done")) await captured(() => taskDone(root, "T001"));
        }

        // A plan with no tasks cannot be approved, so neither can what follows.
        const gates = omit.includes("tasks") ? ["requirement"] : ["requirement", "plan", "result"];
        for (const gate of gates) {
            if (!omit.includes(`${gate} gate` as Omitted)) {
                await captured(() => approve(root, gate, { approver: "dev@example.com" }));
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

    test("refuses criteria edited after the plan was approved", async () => {
        const root = await proven();
        // Exactly what `setCriteria` above does, which is exactly what the
        // agent can do: rewrite the acceptance block in place. No amendment is
        // recorded, so every gate still reads approved and the ack -- keyed by
        // criterion id -- still satisfies a criterion nobody approved.
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the crop UI matches whatever it happens to do",
            "    verified_by:",
            "      - cmd: manual",
        ]);

        const error = await failure(root);
        expect(error?.exitCode).toBe(1);
        expect(error?.message).toMatch(/criteria/i);
        expect(error?.message).toContain("amend");
    });

    test("reordering criteria is not a change", async () => {
        const root = await proven();
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        expect(await failure(root)).toBeNull();
    });

    test("an approval recorded before criteria were pinned still passes", async () => {
        const root = await proven();
        const path = join(root, ".craftpath/state", WORK, "work.json");
        const work = await Bun.file(path).json();
        for (const approval of work.approvals) delete approval.criteria_hash;
        await Bun.write(path, JSON.stringify(work, null, 2) + "\n");

        // Nothing to compare against is not a mismatch: a work item approved by
        // an older craftpath must not be unable to complete.
        expect(await failure(root)).toBeNull();
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

describe("init", () => {
    test("leaves evidence logs tracked", async () => {
        const root = await initRepo();
        const ignores = await Array.fromAsync(
            new Bun.Glob("**/.gitignore").scan({ cwd: join(root, ".craftpath"), dot: true }),
        );
        for (const file of ignores) {
            expect(await Bun.file(join(root, ".craftpath", file)).text()).not.toContain("logs");
        }
    });
});

describe("phase", () => {
    type Gate = "requirement" | "plan" | "result";

    const approved = (...gates: Gate[]) => ({
        approvals: gates.map((phase) => ({
            phase,
            by: "dev@example.com",
            at: "2026-09-15T10:00:00Z",
        })),
    });

    const tasks = (...statuses: Task["status"][]) =>
        new Map<string, Task>(
            statuses.map((status, i) => {
                const id = `T00${i + 1}`;
                return [id, mk({ id, status })];
            }),
        );

    test("no approvals is the requirement phase", () => {
        expect(derivePhase(approved(), tasks())).toBe("requirement");
    });

    test("an approved requirement moves to plan", () => {
        expect(derivePhase(approved("requirement"), tasks("pending"))).toBe("plan");
    });

    test("an approved plan with unfinished tasks is execute", () => {
        expect(derivePhase(approved("requirement", "plan"), tasks("done", "in_progress"))).toBe(
            "execute",
        );
    });

    test("finished tasks move to result then pr", () => {
        expect(derivePhase(approved("requirement", "plan"), tasks("done", "done"))).toBe("result");
        expect(derivePhase(approved("requirement", "plan", "result"), tasks("done", "done"))).toBe(
            "pr",
        );
    });

    test("ignores a phase stored by older work state", async () => {
        // Work items created before phase was derived still carry it. .strict()
        // must not brick them, and the stale value must not be reported.
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        const path = join(root, ".craftpath/state/0001-avatar-upload/work.json");
        const raw = await Bun.file(path).json();
        await Bun.write(path, JSON.stringify({ ...raw, phase: "execute" }));

        const out = await captured(() => status(root, false));
        expect(out).toMatch(/Phase\s+requirement/);
        expect(out).not.toContain("execute");
    });
});

describe("amend", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    /** An open work item in a real git repo, so acks, trailers and approvals sign. */
    async function ready(): Promise<string> {
        const root = await repoReady();
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
        return root;
    }

    /** A task done on both kinds of proof: command evidence and a signed ack. */
    async function doneTask(root: string, id: string): Promise<void> {
        await captured(() => taskAdd(root, id, { title: `Task ${id} work` }));
        await setCriteria(root, id, [
            ...SUITE_CRITERION,
            "  - id: A2",
            "    text: the page matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        await captured(() => taskStart(root, id));
        await captured(() => taskVerify(root, id));
        await captured(() => taskAck(root, id, "A2"));
        await Bun.$`git -C ${root} commit -q --allow-empty -m ${`feat: ${id}\n\nWork: ${WORK}\nTask: ${id}`}`.quiet();
        await captured(() => taskDone(root, id));
    }

    async function approveAll(root: string): Promise<void> {
        for (const gate of ["requirement", "plan", "result"]) {
            await captured(() => approve(root, gate, { approver: "dev@example.com" }));
        }
    }

    test("clears evidence and reopens the task", async () => {
        const root = await ready();
        await doneTask(root, "T001");

        await captured(() => taskAmend(root, "T001", "criterion could not fail"));

        const state = await readState(root, "T001");
        expect(state.status).toBe("pending");
        expect(state.evidence).toEqual([]);
        expect(state.acks).toEqual([]);
    });

    test("records the amendment in the changelog", async () => {
        const root = await ready();
        await doneTask(root, "T001");

        await captured(() => taskAmend(root, "T001", "criterion could not fail"));

        const changelog = await Bun.file(
            join(root, ".craftpath/work", WORK, "changelog.md"),
        ).text();
        expect(changelog).toContain("T001");
        expect(changelog).toContain("criterion could not fail");
    });

    test("leaves unaffected tasks untouched", async () => {
        const root = await ready();
        await doneTask(root, "T001");
        await doneTask(root, "T002");

        await captured(() => taskAmend(root, "T001", "criterion could not fail"));

        const other = await readState(root, "T002");
        expect(other.status).toBe("done");
        expect(other.evidence).toHaveLength(1);
        expect(other.acks).toHaveLength(1);
    });

    test("reopens the plan and result gates", async () => {
        const root = await ready();
        await doneTask(root, "T001");
        await approveAll(root);

        await captured(() => taskAmend(root, "T001", "criterion could not fail"));

        const brief = await captured(() => status(root, true));
        expect(brief).toContain("req=ok");
        expect(brief).toContain("plan=pending");
        expect(brief).toContain("result=pending");
    });

    test("refuses without a reason", async () => {
        const root = await ready();
        await doneTask(root, "T001");

        const p = Bun.spawn(["bun", CLI, "amend", "T001"], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(4);
        expect(await new Response(p.stderr).text()).toContain("--reason");
        expect((await readState(root, "T001")).status).toBe("done");
    });

    test("re-approving after an amendment closes the gate again", async () => {
        const root = await ready();
        await doneTask(root, "T001");
        await approveAll(root);
        await captured(() => taskAmend(root, "T001", "criterion could not fail"));

        await captured(() => approve(root, "plan"));

        expect(await captured(() => status(root, true))).toContain("plan=ok");
        const work = await Bun.file(join(root, ".craftpath/state", WORK, "work.json")).json();
        // The original approval is the record; a new one is added beside it.
        expect(work.approvals.filter((a: { phase: string }) => a.phase === "plan")).toHaveLength(2);
    });
});

describe("task add", () => {
    /** An open work item in a real git repo, with T001 and the requirement approved. */
    async function planned(): Promise<string> {
        const root = await repoReady();
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await captured(() => approve(root, "requirement"));
        return root;
    }

    const taskFiles = (root: string, id: string) =>
        Array.fromAsync(
            new Bun.Glob(`${id}-*.md`).scan({ cwd: join(root, ".craftpath/work", WORK, "tasks") }),
        );

    const workJson = (root: string) =>
        Bun.file(join(root, ".craftpath/state", WORK, "work.json")).json();

    test("after plan approval records an amendment", async () => {
        const root = await planned();
        await captured(() => approve(root, "plan"));

        await captured(() =>
            taskAdd(root, "T002", {
                title: "Reject oversized uploads",
                reason: "review: missing 413",
            }),
        );

        expect(await taskFiles(root, "T002")).toHaveLength(1);
        expect(await captured(() => status(root, true))).toContain("plan=pending");
    });

    test("after plan approval refuses without a reason", async () => {
        const root = await planned();
        await captured(() => approve(root, "plan"));

        const error = await captured(() =>
            taskAdd(root, "T002", { title: "Reject oversized uploads" }),
        ).then(
            () => null,
            (e: Error & { exitCode?: number }) => e,
        );

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("--reason");
        expect(await taskFiles(root, "T002")).toEqual([]);
        expect(await Bun.file(join(root, ".craftpath/state", WORK, "T002.json")).exists()).toBe(
            false,
        );
    });

    test("before plan approval needs no reason", async () => {
        const root = await planned();

        await captured(() => taskAdd(root, "T002", { title: "Reject oversized uploads" }));

        expect(await taskFiles(root, "T002")).toHaveLength(1);
        expect((await workJson(root)).amendments).toEqual([]);
    });
});

describe("pr body", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    /** The body of one `## ` section, up to the next one. */
    function section(body: string, heading: string): string {
        const start = body.indexOf(`## ${heading}\n`);
        if (start === -1) return "";
        const rest = body.slice(start + heading.length + 4);
        const end = rest.search(/^## /m);
        return end === -1 ? rest : rest.slice(0, end);
    }

    /**
     * A proven work item: T001 by a command run, T002 by a signed
     * ack, every gate approved, requirement and delta written.
     */
    async function complete(): Promise<string> {
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        await Bun.write(
            join(root, ".craftpath/config.toml"),
            '[commands.test]\nrun = "true"\n' + CONFIG_TAIL,
        );
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();

        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the endpoint stores the avatar",
            "    verified_by:",
            "      - cmd: test",
        ]);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskVerify(root, "T001"));

        await captured(() => taskAdd(root, "T002", { title: "Build the crop UI" }));
        await setCriteria(root, "T002", [
            "  - id: A1",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        await captured(() => taskStart(root, "T002"));
        await captured(() => taskAck(root, "T002", "A1"));

        for (const id of ["T001", "T002"]) {
            await Bun.$`git -C ${root} commit -q --allow-empty -m ${`feat: ${id}\n\nWork: ${WORK}\nTask: ${id}`}`.quiet();
            await captured(() => taskDone(root, id));
        }
        for (const gate of ["requirement", "plan", "result"]) {
            await captured(() => approve(root, gate, { approver: "dev@example.com" }));
        }

        const dir = join(root, ".craftpath/work", WORK);
        await Bun.write(
            join(dir, "requirement.md"),
            "# Avatar upload\n\n## Problem\n<!-- guidance: who and why -->\nUsers cannot set an avatar.\n\n" +
                "## Scenarios\n\nScenario: upload\n  Given a signed-in user\n",
        );
        await Bun.write(
            join(dir, "spec-delta.md"),
            "<!-- guidance: how this changes the living specs -->\n\n## ADDED\n- AVATAR-R1 — upload an avatar\n\n" +
                "## MODIFIED\n- (none)\n\n## REMOVED\n- (none)\n",
        );
        return root;
    }

    test("refuses while completion is unproven", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));

        const p = Bun.spawn(["bun", CLI, "pr", "body"], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(1);
        // Piped into gh pr create: any stdout would become a body for unproven work.
        expect(await new Response(p.stdout).text()).toBe("");
    });

    test("lists what proved each criterion", async () => {
        const tasks = section(await prBody(await complete()), "Tasks");
        const row = tasks.split("\n").find((line) => line.includes("T001"));
        expect(row).toContain("A1");
        // The command that proved it -- there is nothing narrower to name.
        expect(row).toContain("`test`");
    });

    test("names manually acknowledged criteria", async () => {
        const verification = section(await prBody(await complete()), "Verification");
        expect(verification).toMatch(/T002 A1\b.*acknowledged by dev@example\.com/);
    });

    test("includes the spec delta without guidance", async () => {
        const spec = section(await prBody(await complete()), "Spec changes");
        expect(spec).toContain("- AVATAR-R1 — upload an avatar");
        expect(spec).not.toContain("<!-- guidance");
    });

    test("takes What from the requirement problem", async () => {
        const what = section(await prBody(await complete()), "What");
        expect(what).toContain("Users cannot set an avatar.");
        expect(what).not.toContain("Scenarios");
    });
});

describe("archive", () => {
    const isDir = async (path: string) =>
        (await Bun.$`test -d ${path}`.quiet().nothrow()).exitCode === 0;

    /** A proven work item: T001 done on a signed ack, gates approved, delta written. */
    async function proven(): Promise<string> {
        const root = await repoReady();
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
        await captured(() => taskAdd(root, "T001", { title: "Crop UI" }));
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskAck(root, "T001", "A1"));
        await Bun.$`git -C ${root} commit -q --allow-empty -m ${`feat: crop UI\n\nWork: ${WORK}\nTask: T001`}`.quiet();
        await captured(() => taskDone(root, "T001"));
        for (const gate of ["requirement", "plan", "result"]) {
            await captured(() => approve(root, gate, { approver: "dev@example.com" }));
        }
        await Bun.write(
            join(root, ".craftpath/work", WORK, "spec-delta.md"),
            "## ADDED\n- AVATAR-R1 — crop an avatar\n\n## MODIFIED\n- (none)\n\n## REMOVED\n- (none)\n",
        );
        // The delta is a claim about the living specs, and archive now checks it.
        await writeSpec(root, "avatar", ["AVATAR-R1"]);
        return root;
    }

    test("refuses while completion is unproven", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await setCriteria(root, "T001", SUITE_CRITERION);
        await captured(() => taskStart(root, "T001"));

        const error = await captured(() => archive(root)).then(
            () => null,
            (e: Error & { exitCode?: number }) => e,
        );

        expect(error?.exitCode).toBe(1);
        expect(await isDir(join(root, ".craftpath/work", WORK))).toBe(true);
        expect(await isDir(join(root, ".craftpath/state", WORK))).toBe(true);
    });

    test("moves the work item and its state", async () => {
        const root = await proven();

        await captured(() => archive(root));

        expect(await exists(join(root, ".craftpath/archive", WORK, "requirement.md"))).toBe(true);
        expect(await exists(join(root, ".craftpath/archive", WORK, "state/work.json"))).toBe(true);
        expect(await isDir(join(root, ".craftpath/work", WORK))).toBe(false);
        expect(await isDir(join(root, ".craftpath/state", WORK))).toBe(false);
    });

    test("frees the slot without reusing the id", async () => {
        const root = await proven();
        await captured(() => archive(root));

        await captured(() => workNew(root, "Second thing", "light"));

        expect(await isDir(join(root, ".craftpath/work/0002-second-thing"))).toBe(true);
    });
});

describe("init installs", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");
    const SHIPPED = [
        "architecture",
        "backend",
        "frontend",
        "infrastructure",
        "planning",
        "testing",
        "ux",
    ];

    /** init run again on an existing project, with its PATH warning silenced. */
    async function reinit(root: string): Promise<void> {
        const quietErr = console.error;
        console.error = () => {};
        try {
            await captured(() => init(root));
        } finally {
            console.error = quietErr;
        }
    }

    test("every skill craftpath ships", async () => {
        // The work command loads each task's skills by name and stops when one
        // is missing, so a project without them cannot get past planning.
        const root = await initRepo();
        expect(Object.keys(SKILLS).sort()).toEqual(SHIPPED);
        for (const [name, body] of Object.entries(SKILLS)) {
            const installed = Bun.file(join(root, ".claude/skills", name, "SKILL.md"));
            expect(await installed.exists()).toBe(true);
            // Rendered for the harness it was installed into, so a `.claude/`
            // path in a pi project is impossible by construction.
            expect(await installed.text()).toBe(render(body, CLAUDE_CODE));
        }
    });

    test("the test-first rule", async () => {
        const root = await initRepo();
        expect(Object.keys(RULES)).toEqual(["tdd.md"]);
        const installed = Bun.file(join(root, ".claude/rules/tdd.md"));
        expect(await installed.exists()).toBe(true);
        expect(await installed.text()).toBe(RULES["tdd.md"]!);
    });

    test("from src alone, never from craftpath's own .claude", async () => {
        // craftpath's .claude/ is internal tooling for developing craftpath and
        // never ships. A checkout holding only bin/ and src/ must install
        // everything a project needs.
        const pkg = await tmpdir();
        await Bun.$`cp -r ${join(REPO_ROOT, "bin")} ${join(REPO_ROOT, "src")} ${join(REPO_ROOT, "package.json")} ${pkg}`.quiet();
        await Bun.$`ln -s ${join(REPO_ROOT, "node_modules")} ${join(pkg, "node_modules")}`.quiet();
        const project = await tmpdir();

        const p = Bun.spawn(["bun", join(pkg, "bin/craftpath.ts"), "init"], {
            cwd: project,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(0);

        for (const name of SHIPPED) {
            expect({
                name,
                installed: await Bun.file(
                    join(project, ".claude/skills", name, "SKILL.md"),
                ).exists(),
            }).toEqual({ name, installed: true });
        }
        expect(await Bun.file(join(project, ".claude/rules/tdd.md")).exists()).toBe(true);
    });

    test("without overwriting a skill the project edited", async () => {
        const root = await initRepo();
        const edited = join(root, ".claude/skills/backend/SKILL.md");
        await Bun.write(edited, "# our backend conventions\n");

        await reinit(root);

        expect(await Bun.file(edited).text()).toBe("# our backend conventions\n");
    });

    test("update adds a skill missing from the project", async () => {
        // Upgrading craftpath must be able to bring a new skill into a project
        // that was initialised before it existed.
        const root = await initRepo();
        await Bun.$`rm -rf ${join(root, ".claude/skills/ux")}`.quiet();

        const p = Bun.spawn(["bun", CLI, "update"], { cwd: root, stdout: "pipe", stderr: "pipe" });
        expect(await p.exited).toBe(0);

        expect(await Bun.file(join(root, ".claude/skills/ux/SKILL.md")).exists()).toBe(true);
    });

    test("with no craftpath-internal references", async () => {
        // These land in other people's repos, where craftpath's design reference,
        // milestones and plans do not exist.
        const shipped = { ...SKILLS, ...RULES };
        expect(Object.keys(shipped).length).toBeGreaterThan(0);
        for (const [file, text] of Object.entries(shipped)) {
            expect({
                file,
                match:
                    text.match(/§\d+|\bM\d\b|PLAN-|craftpath-reference|this repo does not/)?.[0] ??
                    null,
            }).toEqual({ file, match: null });
        }
    });

    test("a skills readme naming every shipped skill", async () => {
        const root = await initRepo();
        const readme = await Bun.file(join(root, ".claude/skills/README.md")).text();
        expect(Object.keys(SKILLS).length).toBeGreaterThan(0);
        for (const name of Object.keys(SKILLS)) {
            expect(readme).toContain(`\`${name}\``);
        }
        // Tasks load skills explicitly; disabling model invocation would stop that.
        expect(readme).not.toContain("disable-model-invocation: true");
    });
});

describe("init config", () => {
    test("writes only gate policies the workflow understands", async () => {
        // The work command knows auto and manual. Any other name invites the
        // agent to guess at a rule nothing implements.
        const root = await initRepo();
        const config = Bun.TOML.parse(
            await Bun.file(join(root, ".craftpath/config.toml")).text(),
        ) as {
            gates: Record<string, string>;
        };
        for (const [gate, policy] of Object.entries(config.gates)) {
            expect({ gate, policy }).toEqual({
                gate,
                policy: policy === "auto" ? "auto" : "manual",
            });
        }
    });
});

describe("amend instructions", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");
    // amend refuses without both, exit 4, so an instruction missing either one
    // sends the agent into a usage error.
    const FULL = /^ (<id>|[TD]\d{3}) --reason/;

    async function refusal(guard: string, input: Record<string, unknown>): Promise<string> {
        const p = Bun.spawn(["bun", CLI, "hook", guard], {
            stdin: new TextEncoder().encode(JSON.stringify(input)),
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(2);
        return await new Response(p.stderr).text();
    }

    test("every file init writes names a task and a reason", async () => {
        const root = await initRepo();
        const files = await Array.fromAsync(
            new Bun.Glob("{.claude,.craftpath}/**/*").scan({ cwd: root, dot: true }),
        );
        const bare: string[] = [];
        for (const file of files) {
            const text = await Bun.file(join(root, file)).text();
            for (const match of text.matchAll(/craftpath amend(.*)/g)) {
                if (!FULL.test(match[1]!))
                    bare.push(`${file}: craftpath amend${match[1]!.slice(0, 20)}`);
            }
        }
        expect(bare).toEqual([]);
    });

    test("guard-write refusal says how to amend", async () => {
        const err = await refusal("guard-write", {
            tool_name: "Write",
            tool_input: { file_path: ".craftpath/state/0001-x/T001.json" },
        });
        expect(err).toContain('craftpath amend <id> --reason "<why>"');
    });

    test("guard-bash refusal says how to amend", async () => {
        const err = await refusal("guard-bash", {
            tool_name: "Bash",
            tool_input: { command: "echo '{}' > .craftpath/state/0001-x/T001.json" },
        });
        expect(err).toContain('craftpath amend <id> --reason "<why>"');
    });

    test("starting a done task names the amend that reopens it", () => {
        const task = mk({ id: "T004", status: "done" });
        expect(() => start(task, new Map([["T004", task]]))).toThrow(
            'craftpath amend T004 --reason "<why>"',
        );
    });
});

// ---------------------------------------------------------------------------
// Fixes for the nine documented inconsistencies.
// ---------------------------------------------------------------------------

/** A spec file under .craftpath/specs/ naming the given requirement ids. */
async function writeSpec(root: string, name: string, ids: string[]): Promise<void> {
    await Bun.write(
        join(root, ".craftpath/specs", `${name}.md`),
        ["# Avatar", "", ...ids.map((id) => `## ${id} — behaviour`), ""].join("\n"),
    );
}

describe("archive applies the spec delta by refusing a delta the specs do not reflect", () => {
    /** Proven work item whose delta ADDs AVATAR-R1. Specs are left to the test. */
    async function provenWithDelta(root: string, delta: string): Promise<void> {
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
        await captured(() => taskAdd(root, "T001", { title: "Crop UI" }));
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskAck(root, "T001", "A1"));
        await Bun.$`git -C ${root} commit -q --allow-empty -m ${`feat: crop UI\n\nWork: ${WORK}\nTask: T001`}`.quiet();
        await captured(() => taskDone(root, "T001"));
        for (const gate of ["requirement", "plan", "result"]) {
            await captured(() => approve(root, gate, { approver: "dev@example.com" }));
        }
        await Bun.write(join(root, ".craftpath/work", WORK, "spec-delta.md"), delta);
    }

    const ADDS_R1 =
        "## ADDED\n- AVATAR-R1 — crop an avatar\n\n## MODIFIED\n- (none)\n\n## REMOVED\n- (none)\n";

    test("refuses when an ADDED requirement is absent from the living specs", async () => {
        const root = await repoReady();
        await provenWithDelta(root, ADDS_R1);

        const error = await captured(() => archive(root)).then(
            () => null,
            (e: Error) => e,
        );
        expect(error?.message).toMatch(/AVATAR-R1/);
        expect(await exists(join(root, ".craftpath/work", WORK, "requirement.md"))).toBe(true);
    });

    test("archives once the living spec carries the requirement", async () => {
        const root = await repoReady();
        await provenWithDelta(root, ADDS_R1);
        await writeSpec(root, "avatar", ["AVATAR-R1"]);

        await captured(() => archive(root));
        expect(await exists(join(root, ".craftpath/archive", WORK, "requirement.md"))).toBe(true);
    });

    test("refuses when a REMOVED requirement is still in the living specs", async () => {
        const root = await repoReady();
        await provenWithDelta(
            root,
            "## ADDED\n- (none)\n\n## MODIFIED\n- (none)\n\n## REMOVED\n- AVATAR-R9 — dropped\n",
        );
        await writeSpec(root, "avatar", ["AVATAR-R9"]);

        const error = await captured(() => archive(root)).then(
            () => null,
            (e: Error) => e,
        );
        expect(error?.message).toMatch(/AVATAR-R9/);
    });

    test("the shipped delta template does not promise a writer that does not exist", () => {
        expect(SPEC_DELTA_TEMPLATE).not.toMatch(/Applied to[\s\S]*by .craftpath archive/);
        expect(SPEC_DELTA_TEMPLATE).toMatch(/\.craftpath\/specs\//);
    });
});

describe("trailer check is scoped to the work item", () => {
    async function gitRepo(root: string): Promise<void> {
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
    }

    /** T001 in the currently-open work item, acked and ready to complete. */
    async function readyTask(root: string): Promise<void> {
        await captured(() => taskAdd(root, "T001", { title: "Crop UI" }));
        await setCriteria(root, "T001", [
            "  - id: A1",
            "    text: the crop UI matches the approved mock",
            "    verified_by:",
            "      - cmd: manual",
        ]);
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskAck(root, "T001", "A1"));
    }

    test("a previous work item's T001 commit does not complete this one's T001", async () => {
        const root = await repoReady();
        await gitRepo(root);

        // Work item 0001: T001 done, with both trailers, then archived.
        await readyTask(root);
        await Bun.$`git -C ${root} commit -q --allow-empty -m ${`feat: crop\n\nWork: ${WORK}\nTask: T001`}`.quiet();
        await captured(() => taskDone(root, "T001"));
        for (const gate of ["requirement", "plan", "result"]) {
            await captured(() => approve(root, gate, { approver: "dev@example.com" }));
        }
        await Bun.write(
            join(root, ".craftpath/work", WORK, "spec-delta.md"),
            "## ADDED\n- AVATAR-R1 — crop\n\n## MODIFIED\n- (none)\n\n## REMOVED\n- (none)\n",
        );
        await writeSpec(root, "avatar", ["AVATAR-R1"]);
        await captured(() => archive(root));

        // Work item 0002 restarts task ids at T001. The archived commit still
        // carries `Task: T001`, and must not satisfy this one.
        await captured(() => workNew(root, "Second thing", "light"));
        await captured(() => taskAdd(root, "T001", { title: "Second crop" }));
        const dir = join(root, ".craftpath/work/0002-second-thing/tasks");
        const file = (await Array.fromAsync(new Bun.Glob("T001*.md").scan({ cwd: dir })))[0]!;
        const body = await Bun.file(join(dir, file)).text();
        await Bun.write(
            join(dir, file),
            body.replace(
                /acceptance:[\s\S]*?(?=\n---)/,
                "acceptance:\n  - id: A1\n    text: the second crop UI matches\n    verified_by:\n      - cmd: manual",
            ),
        );
        await captured(() => taskStart(root, "T001"));
        await captured(() => taskAck(root, "T001", "A1"));

        expect(taskDone(root, "T001")).rejects.toThrow(/Task: T001/);
    });

    test("records the work trailer alongside the task trailer", async () => {
        const root = await repoReady();
        await gitRepo(root);
        await readyTask(root);
        await Bun.$`git -C ${root} commit -q --allow-empty -m ${`feat: crop\n\nWork: ${WORK}\nTask: T001`}`.quiet();
        await captured(() => taskDone(root, "T001"));

        const state = await readState(root, "T001");
        expect(state.git.trailer).toBe("Task: T001");
        expect(state.git.work_trailer).toBe(`Work: ${WORK}`);
    });

    test("a commit carrying only the task trailer does not complete the task", async () => {
        const root = await repoReady();
        await gitRepo(root);
        await readyTask(root);
        await Bun.$`git -C ${root} commit -q --allow-empty -m ${"feat: crop\n\nTask: T001"}`.quiet();

        expect(taskDone(root, "T001")).rejects.toThrow(/Work: /);
    });
});

describe("gate policy is read by the CLI it constrains", () => {
    test("a manual gate refuses without an explicit human signal", async () => {
        const root = await repoReady();
        await Bun.write(
            join(root, ".craftpath/config.toml"),
            '[commands.test]\nrun = "true"\n' +
                '\n[skills.backend]\ndefault_verify = ["test"]\n\n' +
                '[gates]\nrequirement = "manual"\nplan = "manual"\nresult = "manual"\n\n' +
                '[git]\nwork_branch_prefix = "work/"\n',
        );
        await expect(approve(root, "requirement")).rejects.toThrow(/manual/);
    });

    test("an auto gate is approved without one, and records that it was auto", async () => {
        const root = await repoReady();
        await captured(() => approve(root, "requirement"));
        const work = WorkState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "work.json")).json(),
        );
        expect(work.approvals.at(-1)?.via).toBe("auto");
    });

    test("an explicit approver satisfies a manual gate and is recorded", async () => {
        const root = await repoReady();
        await captured(() => approve(root, "requirement", { approver: "human@example.com" }));
        const work = WorkState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "work.json")).json(),
        );
        expect(work.approvals.at(-1)?.by).toBe("human@example.com");
        expect(work.approvals.at(-1)?.via).toBe("approver");
    });

    test("guard-bash denies approving a manual gate from the agent's shell", () => {
        const manual = { requirement: "manual", plan: "manual", result: "manual" };
        expect(shouldBlock("craftpath approve plan", manual)).toBe(true);
        expect(shouldBlock("craftpath approve requirement", manual)).toBe(true);
    });

    test("guard-bash allows approving an auto gate", () => {
        const policy = { requirement: "auto", plan: "manual", result: "manual" };
        expect(shouldBlock("craftpath approve requirement", policy)).toBe(false);
        expect(shouldBlock("craftpath approve plan", policy)).toBe(true);
    });

    test("guard-bash denies task ack whatever the policy", () => {
        const policy = { requirement: "auto", plan: "auto", result: "auto" };
        expect(shouldBlock("craftpath task ack T001 A1", policy)).toBe(true);
    });

    test("guard-bash defaults to denying when the policy cannot be read", () => {
        expect(shouldBlock("craftpath approve plan")).toBe(true);
    });
});

describe("task add validates what it writes", () => {
    async function repoWithWork(): Promise<string> {
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        return root;
    }

    const taskDir = (root: string) => join(root, ".craftpath/work", WORK, "tasks");
    const taskFiles = (root: string) =>
        Array.fromAsync(new Bun.Glob("*.md").scan({ cwd: taskDir(root) }));

    test("a title containing a colon survives the round trip", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "Reject TIFF: return 415" }));
        const out = await captured(() => status(root, false));
        expect(out).toContain("T001");
    });

    test("a title starting with # survives the round trip", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "#1 priority endpoint" }));
        await captured(() => status(root, false));
    });

    test("refuses a title the schema rejects, writing nothing", async () => {
        const root = await repoWithWork();
        await expect(taskAdd(root, "T001", { title: "ab" })).rejects.toThrow(PreconditionError);
        expect(await taskFiles(root)).toEqual([]);
        expect(await exists(join(root, ".craftpath/state", WORK, "T001.json"))).toBe(false);
    });

    test("refuses a skill name the schema rejects, writing nothing", async () => {
        const root = await repoWithWork();
        await expect(
            taskAdd(root, "T001", { title: "Add the endpoint", skills: ["Backend"] }),
        ).rejects.toThrow(PreconditionError);
        expect(await taskFiles(root)).toEqual([]);
    });

    test("a rejected add after plan approval records no amendment", async () => {
        const root = await repoWithWork();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await captured(() => approve(root, "requirement", { approver: "dev@example.com" }));
        await captured(() => approve(root, "plan", { approver: "dev@example.com" }));

        await expect(
            taskAdd(root, "T002", { title: "ab", reason: "review asked for it" }),
        ).rejects.toThrow(PreconditionError);

        const work = WorkState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "work.json")).json(),
        );
        expect(work.amendments).toEqual([]);
    });
});

describe("task add creates design tasks", () => {
    async function repoWithWork(): Promise<string> {
        const root = await initRepo();
        await captured(() => workNew(root, "Avatar upload", "light"));
        return root;
    }

    test("writes a D task the schema and status both accept", async () => {
        const root = await repoWithWork();
        await captured(() =>
            taskAdd(root, "D001", {
                title: "Decide the crop interaction",
                design: "ux",
                designReason: "three viable crop models, and the choice changes the upload API",
                produces: [`.craftpath/work/${WORK}/design-D001.md`],
            }),
        );

        const out = await captured(() => status(root, false));
        expect(out).toContain("D001");

        const dir = join(root, ".craftpath/work", WORK, "tasks");
        const file = (await Array.fromAsync(new Bun.Glob("D001*.md").scan({ cwd: dir })))[0]!;
        const body = await Bun.file(join(dir, file)).text();
        const parsed = TaskProse.safeParse(Bun.YAML.parse(/^---\n([\s\S]*?)\n---/.exec(body)![1]!));
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.design?.kind).toBe("ux");
        expect(parsed.success && parsed.data.skills).toContain("ux");
    });

    test("refuses a D id with no design block, writing nothing", async () => {
        const root = await repoWithWork();
        await expect(taskAdd(root, "D001", { title: "Decide the crop" })).rejects.toThrow(
            /--design/,
        );
        expect(
            await Array.fromAsync(
                new Bun.Glob("*.md").scan({ cwd: join(root, ".craftpath/work", WORK, "tasks") }),
            ),
        ).toEqual([]);
    });

    test("refuses a design block on a T id", async () => {
        const root = await repoWithWork();
        await expect(
            taskAdd(root, "T001", {
                title: "Build the crop",
                design: "ux",
                designReason: "three viable crop models, and the choice changes the API",
                produces: ["docs/crop.md"],
            }),
        ).rejects.toThrow(PreconditionError);
    });

    test("refuses a design task that declares no produces", async () => {
        const root = await repoWithWork();
        await expect(
            taskAdd(root, "D001", {
                title: "Decide the crop",
                design: "ux",
                designReason: "three viable crop models, and the choice changes the API",
            }),
        ).rejects.toThrow(/produces/);
    });
});

describe("shipped command text", () => {
    test("never pipes a refusable command into gh", () => {
        // `a | b` runs b even when a refuses: gh would open a PR with no body.
        expect(WORK_COMMAND).not.toMatch(/craftpath pr body\s*\|/);
        expect(WORK_COMMAND).toMatch(/craftpath pr body/);
    });

    test("every --skills example names only skills craftpath ships", () => {
        const shipped = new Set(Object.keys(SKILLS));
        const named = [...WORK_COMMAND.matchAll(/--skills ([a-z0-9,-]+)/g)].flatMap((m) =>
            m[1]!.split(","),
        );
        expect(named.length).toBeGreaterThan(0);
        expect(named.filter((s) => !shipped.has(s))).toEqual([]);
    });

    test("phase 9 does not claim specs update themselves", () => {
        expect(WORK_COMMAND).not.toMatch(/\| 9 \| Archive \| Updated specs and archive \|/);
    });
});

describe("version is one fact", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    // The string was hardcoded in the command while package.json carried no
    // version at all. Nothing could tell them apart, so the first tag would
    // have made `craftpath version` quietly wrong and stayed that way.
    test("the CLI reports the version the package declares", async () => {
        const pkg = await Bun.file(join(REPO_ROOT, "package.json")).json();
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);

        const p = Bun.spawn(["bun", CLI, "version"], { cwd: REPO_ROOT, stdout: "pipe" });
        const out = await new Response(p.stdout).text();
        expect(await p.exited).toBe(0);
        expect(out.trim()).toBe(`craftpath ${pkg.version}`);
    });
});

describe("an unusable hook fails open", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    async function run(args: string[]) {
        const p = Bun.spawn(["bun", CLI, ...args], {
            cwd: REPO_ROOT,
            stdin: new Response("{}"),
            stdout: "pipe",
            stderr: "pipe",
        });
        return await p.exited;
    }

    // Claude Code treats exit 2 as "block this tool call" and every other
    // non-zero code as a hook ERROR. A guard name craftpath does not recognise
    // is a wiring mistake, not a reason to stop the session, so it must exit 0.
    test("an unknown guard name exits zero rather than blocking", async () => {
        expect(await run(["hook", "guard-typo"])).toBe(0);
    });

    test("hook with no guard name exits zero", async () => {
        expect(await run(["hook"])).toBe(0);
    });

    // Bare `craftpath` prints usage for a human who typed it alone; that is not
    // a usage error, and exiting non-zero would make `craftpath || echo` lie.
    test("bare craftpath prints usage and exits zero", async () => {
        expect(await run([])).toBe(0);
    });
});

describe("stop hook can block", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    test("init wires a Stop hook that uses the blocking exit code", async () => {
        const root = await initRepo();
        const settings = JSON.parse(await Bun.file(join(root, ".claude/settings.json")).text()) as {
            hooks: { Stop: { hooks: { command: string }[] }[] };
        };
        const commands = settings.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
        expect(commands).toContain("craftpath hook validate");
    });

    test("hook validate exits 2 on a structurally invalid work item", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        await captured(() => taskAdd(root, "T002", { title: "Wire the UI", dependsOn: ["T001"] }));
        // Break the graph: T002 now depends on a task that does not exist.
        const dir = join(root, ".craftpath/work", WORK, "tasks");
        const file = (await Array.fromAsync(new Bun.Glob("T002*.md").scan({ cwd: dir })))[0]!;
        const body = await Bun.file(join(dir, file)).text();
        await Bun.write(
            join(dir, file),
            body.replace(/depends_on: \[.*\]/, 'depends_on: ["T009"]'),
        );

        const p = Bun.spawn(["bun", CLI, "hook", "validate"], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(2);
    });

    test("hook validate exits 0 when the work item is structurally sound", async () => {
        const root = await repoReady();
        await captured(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
        const p = Bun.spawn(["bun", CLI, "hook", "validate"], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(await p.exited).toBe(0);
    });
});

/** Runs init over a settings.json written verbatim, quietly. */
async function initWith(settings: string): Promise<{ root: string; error: Error | null }> {
    const root = await tmpdir();
    await mkdir(join(root, ".claude"), { recursive: true });
    await Bun.write(join(root, ".claude/settings.json"), settings);

    const quietLog = console.log;
    const quietErr = console.error;
    console.log = () => {};
    console.error = () => {};
    const error = await init(root).then(
        () => null,
        (e: Error) => e,
    );
    console.log = quietLog;
    console.error = quietErr;
    return { root, error };
}

/** Every hook command registered under one event, in file order. */
async function wiredCommands(root: string, event: string): Promise<string[]> {
    const settings = JSON.parse(await Bun.file(join(root, ".claude/settings.json")).text()) as {
        hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
    };
    return (settings.hooks?.[event] ?? []).flatMap((entry) =>
        (entry.hooks ?? []).map((h) => h.command ?? ""),
    );
}

describe("init with malformed settings.json", () => {
    test("still writes the slash commands", async () => {
        const { root } = await initWith("{ not json");
        expect(await exists(join(root, ".claude/commands/craftpath/work.md"))).toBe(true);
    });

    test("does not report success", async () => {
        const { error } = await initWith("{ not json");
        expect(error).not.toBeNull();
        expect((error as Error & { exitCode?: number }).exitCode).toBeGreaterThan(0);
    });

    test("does not warn about hooks it did not wire", async () => {
        // The PATH warning's premise is "the hooks just wired"; with unreadable
        // settings there are none, and a false warning is how real ones get
        // ignored.
        const root = await tmpdir();
        await mkdir(join(root, ".claude"), { recursive: true });
        await Bun.write(join(root, ".claude/settings.json"), "{ not json");

        const errors: string[] = [];
        const quietLog = console.log;
        const quietErr = console.error;
        console.log = () => {};
        console.error = (...args: unknown[]) => void errors.push(args.join(" "));
        await init(root).catch(() => {});
        console.log = quietLog;
        console.error = quietErr;

        expect(errors.join("\n")).not.toMatch(/hooks just wired/);
    });

    test("leaves the unreadable settings file untouched", async () => {
        const { root } = await initWith("{ not json");
        expect(await Bun.file(join(root, ".claude/settings.json")).text()).toBe("{ not json");
    });

    test("a non-list hooks block is refused without a stack dump", async () => {
        // `settings.hooks.PreToolUse ??= []` leaves a hand-edited object in
        // place and `alreadyWired` then calls `.some` on it: an uncaught
        // TypeError with a source dump, after the templates and skills were
        // already written. Same class as unreadable JSON, so it gets the same
        // contract -- finish the install, touch nothing, refuse at the end.
        const { root, error } = await initWith('{"hooks":{"PreToolUse":{"note":"hand edited"}}}');

        expect(error).not.toBeNull();
        expect(error).not.toBeInstanceOf(TypeError);
        expect((error as Error & { exitCode?: number }).exitCode).toBeGreaterThan(0);
        expect(error!.message).toContain("PreToolUse");
        expect(await exists(join(root, ".claude/commands/craftpath/work.md"))).toBe(true);
        expect(await Bun.file(join(root, ".claude/settings.json")).text()).toContain("hand edited");
    });

    test("a non-list Stop block is refused the same way", async () => {
        const { error } = await initWith('{"hooks":{"Stop":"craftpath hook validate"}}');
        expect(error).not.toBeNull();
        expect(error!.message).toContain("Stop");
    });
});

describe("init wiring", () => {
    test("does not double-wire an equivalent hook command", async () => {
        // A project wired as `bun /abs/bin/craftpath.ts hook guard-write` got a
        // second, unresolvable entry: every Edit then pays for two hook spawns
        // and one of them 127s.
        const { root } = await initWith(
            JSON.stringify({
                hooks: {
                    PreToolUse: [
                        {
                            matcher: "Edit|Write|MultiEdit|NotebookEdit",
                            hooks: [
                                {
                                    type: "command",
                                    command: "bun /abs/bin/craftpath.ts hook guard-write",
                                    timeout: 5,
                                },
                            ],
                        },
                    ],
                },
            }),
        );

        const pre = await wiredCommands(root, "PreToolUse");
        expect(pre.filter((c) => c.includes("guard-write"))).toHaveLength(1);
        // The guard that was NOT already wired still gets wired.
        expect(pre.filter((c) => c.includes("guard-bash"))).toHaveLength(1);
    });

    test("wires both guards and the stop hook in a fresh project", async () => {
        const { root, error } = await initWith("{}");
        expect(error).toBeNull();
        expect(await wiredCommands(root, "PreToolUse")).toEqual([
            "craftpath hook guard-write",
            "craftpath hook guard-bash",
        ]);
        expect(await wiredCommands(root, "Stop")).toEqual(["craftpath hook validate"]);
    });

    test("running twice adds nothing the second time", async () => {
        const { root } = await initWith("{}");
        const quiet = console.log;
        const quietErr = console.error;
        console.log = () => {};
        console.error = () => {};
        await init(root).catch(() => {});
        console.log = quiet;
        console.error = quietErr;
        expect(await wiredCommands(root, "PreToolUse")).toHaveLength(2);
    });
});

describe("cli surfaces the new flags", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    async function run(root: string, ...args: string[]) {
        const p = Bun.spawn(["bun", CLI, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([
            new Response(p.stdout).text(),
            new Response(p.stderr).text(),
            p.exited,
        ]);
        return { out, err, code };
    }

    async function ready(): Promise<string> {
        const root = await repoReady();
        await Bun.$`git -C ${root} init -q`.quiet();
        await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
        await Bun.$`git -C ${root} config user.name Dev`.quiet();
        return root;
    }

    test("task add builds a design task from flags alone", async () => {
        const root = await ready();
        const { code, err } = await run(
            root,
            "task",
            "add",
            "D001",
            "--title",
            "Decide the crop interaction",
            "--design",
            "ux",
            "--design-reason",
            "three viable crop models, and the choice changes the upload API",
            "--produces",
            `.craftpath/work/${WORK}/design-D001.md`,
        );
        expect({ code, err }).toEqual({ code: 0, err: "" });

        const status = await run(root, "status", "--brief");
        expect(status.code).toBe(0);
    });

    test("task add refuses a bad title through the CLI, exit 2", async () => {
        const root = await ready();
        const { code } = await run(root, "task", "add", "T001", "--title", "ab");
        expect(code).toBe(2);
    });

    test("approve passes --approver through and records it", async () => {
        const root = await ready();
        const { code } = await run(
            root,
            "approve",
            "requirement",
            "--approver",
            "human@example.com",
        );
        expect(code).toBe(0);

        const work = WorkState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "work.json")).json(),
        );
        expect(work.approvals.at(-1)?.by).toBe("human@example.com");
        expect(work.approvals.at(-1)?.via).toBe("approver");
    });

    test("approve refuses a manual gate with no signal, exit 2", async () => {
        const root = await ready();
        await Bun.write(
            join(root, ".craftpath/config.toml"),
            '[commands.test]\nrun = "true"\n' +
                '\n[skills.backend]\ndefault_verify = ["test"]\n\n' +
                '[gates]\nrequirement = "manual"\nplan = "manual"\nresult = "manual"\n\n' +
                '[git]\nwork_branch_prefix = "work/"\n',
        );
        const { code, err } = await run(root, "approve", "requirement");
        expect(code).toBe(2);
        expect(err).toMatch(/--approver/);
    });

    test("usage names the design and approver flags", async () => {
        const root = await ready();
        const { err } = await run(root, "nonsense");
        expect(err).toMatch(/--design/);
        expect(err).toMatch(/--approver/);
    });
});

describe("planning skill reaches design tasks through the CLI", () => {
    test("names the command that creates one", () => {
        // The shape alone invites hand-authoring, which is exactly how a task
        // file that no later parse accepts used to get written.
        expect(SKILLS.planning!).toMatch(/craftpath task add D001[\s\S]{0,200}--design/);
    });

    test("does not present hand-authoring as the way in", () => {
        const planning = SKILLS.planning!;
        const section = planning.slice(planning.indexOf("id: D001"));
        expect(section).toMatch(/--design-reason/);
    });
});

describe("guard-bash end to end", () => {
    const CLI = join(REPO_ROOT, "bin/craftpath.ts");

    /** Runs the real hook, from a real repo, the way Claude Code invokes it. */
    async function hook(root: string, command: string): Promise<number> {
        const p = Bun.spawn(["bun", CLI, "hook", "guard-bash"], {
            cwd: root,
            stdin: new TextEncoder().encode(JSON.stringify({ tool_input: { command } })),
            stdout: "pipe",
            stderr: "pipe",
        });
        return await p.exited;
    }

    test("allows the agent to approve a gate whose policy is auto", async () => {
        // repoReady sets requirement = "auto". The work command tells the agent
        // to run this one itself, so blocking it would contradict the policy.
        const root = await repoReady();
        expect(await hook(root, "craftpath approve requirement")).toBe(0);
    });

    test("blocks the agent from approving a gate whose policy is manual", async () => {
        const root = await repoReady(); // result = "manual"
        expect(await hook(root, "craftpath approve result")).toBe(2);
    });

    test("blocks task ack", async () => {
        const root = await repoReady();
        expect(await hook(root, "craftpath task ack T001 A1")).toBe(2);
    });

    test("still blocks a direct state write", async () => {
        const root = await repoReady();
        expect(await hook(root, "echo '{}' > .craftpath/state/0001/T001.json")).toBe(2);
    });

    test("still allows ordinary commands", async () => {
        const root = await repoReady();
        expect(await hook(root, "git commit -m 'feat: thing'")).toBe(0);
    });
});

describe("guard messages match what the guards allow", () => {
    test("the state-write guards do not tell the agent to run a human sign-off", async () => {
        // Both guards listed `craftpath approve` and `task ack` as "the
        // sanctioned commands". guard-bash now refuses both, so that advice
        // sent the model straight into a second refusal.
        const sources = await Promise.all(
            ["src/hooks/guard-write.ts", "src/hooks/guard-bash.ts"].map((f) =>
                Bun.file(join(REPO_ROOT, f)).text(),
            ),
        );
        for (const [i, text] of sources.entries()) {
            expect({ file: i, line: text.includes("task start|verify|ack|done") }).toEqual({
                file: i,
                line: false,
            });
        }
    });
});
