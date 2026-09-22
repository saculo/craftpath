import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { init } from "./init";
import { reconcile } from "./reconcile";
import { ARCHIVE, STATE, WORK, workNew } from "./work";

const WORK_ID = "0001-avatar-upload";

/** A fresh scratch directory. Tests must not depend on each other's files. */
async function tmpdir(): Promise<string> {
    return await mkdtemp(join(osTmpdir(), "craftpath-reconcile-"));
}

/** Silences a command that writes to stdout, or warns about PATH. */
async function quietly(fn: () => Promise<void>): Promise<void> {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        await fn();
    } finally {
        console.log = log;
        console.error = err;
    }
}

/**
 * An initialised repository with one open work item and a real git history.
 *
 * The git repository is not optional: drift is defined against what `git log`
 * can still reach, so a test that skipped it would be asking a different
 * question than the one reconcile exists to answer.
 */
async function repoWithWork(): Promise<string> {
    const root = await tmpdir();
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await Bun.$`git -C ${root} init -q`.quiet();
    await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
    await Bun.$`git -C ${root} config user.name Dev`.quiet();
    await Bun.$`git -C ${root} add -A`.quiet();
    await Bun.$`git -C ${root} commit -q -m ${"chore: scaffold"}`.quiet();
    return root;
}

/** Kernel state for a done task, with no commit carrying its trailer yet. */
async function doneTask(root: string, id: string): Promise<string> {
    const path = join(root, STATE, WORK_ID, `${id}.json`);
    await Bun.write(
        path,
        JSON.stringify({
            id,
            status: "done",
            evidence: [],
            acks: [],
            git: { trailer: `Task: ${id}`, work_trailer: `Work: ${WORK_ID}`, commits_hint: [] },
        }),
    );
    return path;
}

const HASH = "sha256:" + "a".repeat(64);

/** Kernel state for a done task carrying one evidence record and one ack. */
async function doneWithProof(root: string, id: string): Promise<string> {
    const path = join(root, STATE, WORK_ID, `${id}.json`);
    await Bun.write(
        path,
        JSON.stringify({
            id,
            status: "done",
            evidence: [
                {
                    cmd: "test",
                    exit: 0,
                    log: `.craftpath/work/${WORK_ID}/evidence/${id}-test.log`,
                    config_hash: HASH,
                    at: "2026-09-01T10:00:00.000Z",
                },
            ],
            acks: [
                {
                    criterion_id: "A2",
                    by: "dev@example.com",
                    at: "2026-09-01T10:05:00.000Z",
                    config_hash: HASH,
                },
            ],
            git: { trailer: `Task: ${id}`, work_trailer: `Work: ${WORK_ID}`, commits_hint: [] },
        }),
    );
    return path;
}

/** Commits an empty change carrying both anchor trailers for a task. */
async function commitWithTrailers(root: string, id: string): Promise<void> {
    const message = `feat: the thing\n\nWork: ${WORK_ID}\nTask: ${id}`;
    await Bun.$`git -C ${root} commit -q --allow-empty -m ${message}`.quiet();
}

/** Whether a directory is there. `Bun.file().exists()` answers for files only. */
async function dirExists(path: string): Promise<boolean> {
    return await stat(path).then(
        (s) => s.isDirectory(),
        () => false,
    );
}

/** The rejection reconcile produced, or null when it found no drift. */
async function drift(root: string): Promise<(Error & { exitCode?: number }) | null> {
    return await reconcile(root).then(
        () => null,
        (error: Error & { exitCode?: number }) => error,
    );
}

/** The rejection `--fix` produced, or null when it repaired everything. */
async function fixFailure(root: string): Promise<(Error & { exitCode?: number }) | null> {
    const quiet = console.log;
    console.log = () => {};
    try {
        return await reconcile(root, { fix: true }).then(
            () => null,
            (error: Error & { exitCode?: number }) => error,
        );
    } finally {
        console.log = quiet;
    }
}

describe("reconcile", () => {
    // T601-A1
    test("reports a done task with no trailer", async () => {
        const root = await repoWithWork();
        const path = await doneTask(root, "T001");
        const before = await Bun.file(path).text();

        const found = await drift(root);

        expect(found?.exitCode).toBe(1);
        expect(found?.message).toContain("T001");
        expect(found?.message).toContain("Task: T001");
        // Reporting is not repairing: without --fix, state is read-only.
        expect(await Bun.file(path).text()).toBe(before);
    });

    // T601-A2
    test("clean state reports no drift", async () => {
        const root = await repoWithWork();
        await doneTask(root, "T001");
        await commitWithTrailers(root, "T001");

        let found: (Error & { exitCode?: number }) | null = null;
        await quietly(async () => {
            found = await drift(root);
        });
        expect(found).toBeNull();
    });

    // The command the guards and `status` tell people to run. A core function
    // nothing routes to is the same as not having built it.
    test("is reachable as a command", async () => {
        const root = await repoWithWork();
        await doneTask(root, "T001");

        const cli = join(import.meta.dir, "../../bin/craftpath.ts");
        const p = Bun.spawn(["bun", cli, "reconcile"], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
        });

        expect(await p.exited).toBe(1);
        expect(await new Response(p.stderr).text()).toContain("T001");
    });

    // T601-A3
    test("reports a work directory with no state", async () => {
        const root = await repoWithWork();
        await rm(join(root, STATE, WORK_ID), { recursive: true });

        const found = await drift(root);

        expect(found?.exitCode).toBe(1);
        expect(found?.message).toContain(WORK_ID);
    });

    // T601-A4
    test("reports an interrupted archive", async () => {
        const root = await repoWithWork();
        // What a crash between archive's two renames leaves behind: the work
        // directory already moved, the state directory not yet.
        await mkdir(join(root, ARCHIVE, WORK_ID), { recursive: true });
        await rm(join(root, WORK, WORK_ID), { recursive: true });

        const found = await drift(root);

        expect(found?.exitCode).toBe(1);
        expect(found?.message).toContain(WORK_ID);
        expect(found?.message.toLowerCase()).toContain("archive");
        // Reporting leaves both halves exactly where the crash left them.
        expect(await dirExists(join(root, ARCHIVE, WORK_ID))).toBe(true);
        expect(await Bun.file(join(root, STATE, WORK_ID, "work.json")).exists()).toBe(true);
    });

    // The guards print `craftpath reconcile --fix`. A flag the CLI refuses
    // would make both of them liars.
    test("takes --fix as a command", async () => {
        const root = await repoWithWork();
        await doneWithProof(root, "T001");

        const cli = join(import.meta.dir, "../../bin/craftpath.ts");
        const p = Bun.spawn(["bun", cli, "reconcile", "--fix"], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
        });

        expect(await p.exited).toBe(0);
        const state = await Bun.file(join(root, STATE, WORK_ID, "T001.json")).json();
        expect(state.status).toBe("in_progress");
    });

    // T602-A1
    test("fix reopens a task whose trailer vanished", async () => {
        const root = await repoWithWork();
        const path = await doneWithProof(root, "T001");

        await quietly(() => reconcile(root, { fix: true }));

        const state = await Bun.file(path).json();
        expect(state.status).toBe("in_progress");
        // R2: the proof was about code that still exists. Only the link to the
        // branch is gone, so evidence and acks survive the reopening.
        expect(state.evidence).toHaveLength(1);
        expect(state.acks).toHaveLength(1);

        const changelog = await Bun.file(join(root, WORK, WORK_ID, "changelog.md")).text();
        expect(changelog).toContain("T001");
        expect(changelog).toContain("Task: T001");

        // R3: the plan did not change, so the gates must not reopen.
        const work = await Bun.file(join(root, STATE, WORK_ID, "work.json")).json();
        expect(work.amendments).toHaveLength(0);
    });

    // T602-A2
    test("fix finishes an interrupted archive", async () => {
        const root = await repoWithWork();
        await mkdir(join(root, ARCHIVE, WORK_ID), { recursive: true });
        await rm(join(root, WORK, WORK_ID), { recursive: true });

        await quietly(() => reconcile(root, { fix: true }));

        expect(await Bun.file(join(root, ARCHIVE, WORK_ID, "state/work.json")).exists()).toBe(true);
        expect(await dirExists(join(root, STATE, WORK_ID))).toBe(false);
    });

    // T602-A3
    test("fix leaves a work directory it cannot interpret", async () => {
        const root = await repoWithWork();
        await rm(join(root, STATE, WORK_ID), { recursive: true });

        const found = await fixFailure(root);

        expect(found?.exitCode).toBe(1);
        expect(await dirExists(join(root, WORK, WORK_ID))).toBe(true);
        expect(found?.message.toLowerCase()).toContain("by hand");
    });

    // T602-A4
    test("a fixed repository reconciles clean", async () => {
        const root = await repoWithWork();
        await doneWithProof(root, "T001");

        await quietly(() => reconcile(root, { fix: true }));

        let found: (Error & { exitCode?: number }) | null = null;
        await quietly(async () => {
            found = await drift(root);
        });
        expect(found).toBeNull();
    });
});
