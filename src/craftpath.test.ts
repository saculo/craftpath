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
import { Acceptance, TaskProse, TaskState } from "../src/schema";
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
