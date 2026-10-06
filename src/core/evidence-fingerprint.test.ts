/**
 * Evidence is about the code it ran against.
 *
 * A green run proves the tree it ran on. Once that tree changes, the run
 * proves nothing about the new one -- so evidence records a fingerprint of the
 * source it ran against, and a criterion is satisfied only by evidence whose
 * fingerprint matches the code as it is now.
 *
 * The fingerprint is content, not a commit: the documented flow verifies,
 * then commits, then completes, and committing exactly what was verified must
 * not stale the proof. Craftpath's own writes under `.craftpath/` are not the
 * code under test and must not stale it either.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TaskState } from "../schema";
import { cleanScratch, scratch } from "../../test/scratch";
import { approve } from "./approve";
import { init } from "./init";
import { taskAdd, taskDone, taskStart, taskVerify, taskVerifyAll, unsatisfiedFor } from "./task";
import { validateComplete } from "./validate";
import { workNew } from "./work";

afterAll(cleanScratch);

const WORK = "W-0001-avatar-upload";
const CLI = new URL("../../bin/craftpath.ts", import.meta.url).pathname;
// The suite passes while src/ok exists: deleting it is a change that breaks it.
const CONFIG =
    '[modules.app]\npath = "./"\ntest = "test -f src/ok"\n\n' +
    '[gates]\nrequirement = "auto"\nplan = "auto"\nresult = "auto"\n\n' +
    '[git]\nwork_branch_prefix = "work/"\n';

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
        console.error = err;
    }
}

async function refusal(
    fn: () => Promise<unknown>,
): Promise<(Error & { exitCode?: number }) | null> {
    return quietly(fn).then(
        () => null,
        (error: Error & { exitCode?: number }) => error,
    );
}

function git(root: string, ...args: string[]) {
    return Bun.$`git -C ${root} -c user.email=t@example.com -c user.name=T ${args}`.quiet();
}

/** Commits everything with the trailer pair that anchors `id`. */
async function commitTask(root: string, id: string): Promise<void> {
    await git(root, "add", "-A");
    await git(
        root,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        `feat: ${id}\n\nWork: ${WORK}\nTask: ${id}`,
    );
}

/** A project on master with a work item whose tasks are planned and approved. */
async function planned(...ids: string[]): Promise<string> {
    const root = await scratch("craftpath-fingerprint-");
    await git(root, "init", "-q", "-b", "master");
    await quietly(() => init(root));
    await Bun.write(join(root, ".craftpath/config.toml"), CONFIG);
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "base");
    await quietly(() => workNew(root, "Avatar upload", "light"));

    for (const id of ids) {
        await quietly(() => taskAdd(root, id, { title: `Implement ${id}` }));
        const dir = join(root, ".craftpath/work", WORK, "tasks");
        const file = (await Array.fromAsync(new Bun.Glob(`${id}*.md`).scan({ cwd: dir })))[0]!;
        const body = await Bun.file(join(dir, file)).text();
        await Bun.write(
            join(dir, file),
            body.replace(
                /acceptance:[\s\S]*?(?=\n---)/,
                "acceptance:\n  - id: A1\n    text: the suite proves it\n    verified_by:\n      - cmd: test",
            ),
        );
    }
    await quietly(() => approve(root, "requirement"));
    await quietly(() => approve(root, "plan"));
    await Bun.write(join(root, "src/ok"), "ok\n");
    return root;
}

/** Started and verified green, nothing committed yet. */
async function verified(...ids: string[]): Promise<string> {
    const root = await planned(...ids);
    for (const id of ids) {
        await quietly(() => taskStart(root, id));
        await quietly(() => taskVerify(root, id));
    }
    return root;
}

/** Every task done on green evidence, every gate approved, delta written. */
async function completed(...ids: string[]): Promise<string> {
    const root = await verified(...ids);
    for (const id of ids) {
        await commitTask(root, id);
        await quietly(() => taskDone(root, id));
    }
    await Bun.write(
        join(root, ".craftpath/work", WORK, "spec-delta.md"),
        "# Spec delta\n\n## ADDED\n\nnothing durable\n",
    );
    await quietly(() => approve(root, "result"));
    return root;
}

describe("evidence is bound to the source it ran against", () => {
    test("a source change after verify stales the evidence, so done refuses", async () => {
        const root = await verified("T001");
        await Bun.write(join(root, "src/ok"), "");
        await git(root, "rm", "-q", "--cached", "src/ok").nothrow();
        await Bun.$`rm ${join(root, "src/ok")}`;
        await commitTask(root, "T001");

        const error = await refusal(() => taskDone(root, "T001"));

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("A1");
        expect(
            TaskState.parse(
                await Bun.file(join(root, ".craftpath/state", WORK, "T001.json")).json(),
            ).status,
        ).toBe("in_progress");
    });

    test("committing exactly what was verified keeps the evidence current", async () => {
        const root = await verified("T001");
        await commitTask(root, "T001");

        expect(await refusal(() => taskDone(root, "T001"))).toBeNull();
    });

    test("craftpath's own writes after verify do not stale the evidence", async () => {
        const root = await verified("T001");
        await Bun.write(join(root, ".craftpath/work", WORK, "changelog.md"), "# notes\n\nmore\n");
        await commitTask(root, "T001");

        expect(await unsatisfiedFor(root, "T001")).toEqual([]);
    });

    test("evidence recorded without a fingerprint reads as stale", async () => {
        // Written by a craftpath that recorded no fingerprint: nothing says
        // what it ran against, so it proves nothing about the code now.
        const root = await verified("T001");
        const path = join(root, ".craftpath/state", WORK, "T001.json");
        const state = await Bun.file(path).json();
        for (const evidence of state.evidence) delete evidence.tree;
        await Bun.write(path, JSON.stringify(state, null, 2));

        expect(await unsatisfiedFor(root, "T001")).toEqual(["A1"]);
    });
});

describe("completion proves the final code", () => {
    test("validate --complete names a done task whose code changed since, and says to re-verify", async () => {
        const root = await completed("T001", "T002");
        await Bun.write(join(root, "src/later.ts"), "export const later = 1;\n");
        await git(root, "add", "-A");
        await git(root, "commit", "-qm", "later change");

        const error = await refusal(() => validateComplete(root));

        expect(error?.message).toContain("T001");
        expect(error?.message).toContain("T002");
        expect(error?.message).toContain("task verify --all");
    });

    test("task verify --all re-proves every started task against the code now", async () => {
        const root = await completed("T001", "T002");
        await Bun.write(join(root, "src/later.ts"), "export const later = 1;\n");
        await git(root, "add", "-A");
        await git(root, "commit", "-qm", "later change");

        await quietly(() => taskVerifyAll(root));

        expect(await refusal(() => validateComplete(root))).toBeNull();
    });

    test("craftpath task verify --all runs from the command line", async () => {
        const root = await completed("T001");
        await Bun.write(join(root, "src/later.ts"), "export const later = 1;\n");

        const p = Bun.spawn([process.execPath, CLI, "task", "verify", "--all"], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
        });

        expect(await p.exited).toBe(0);
        expect(await unsatisfiedFor(root, "T001")).toEqual([]);
    });
});
