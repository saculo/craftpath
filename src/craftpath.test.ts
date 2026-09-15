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
