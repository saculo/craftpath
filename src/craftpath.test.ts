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
import { taskAdd } from "../src/core/task";
import { approve, gateState } from "../src/core/approve";
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

function mk(over: Partial<Task> = {}): Task {
    return {
        id: "T004",
        status: "pending",
        depends_on: [],
        acceptance: [CRITERION],
        evidence: [],
        acks: [],
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
