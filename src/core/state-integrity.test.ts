/**
 * Trusted state that cannot be read is reported, never crashed on and never
 * silently reinterpreted.
 *
 * Corrupt state is exit 3 with the file named -- the same answer `readWork`
 * already gave -- so a person can find what to repair, and a hook receives a
 * result it can relay rather than a stack dump. Two prose files never map to
 * one task, and an interrupted `work new` leaves nothing behind.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { cleanScratch, scratch } from "../../test/scratch";
import { init } from "./init";
import { taskAdd } from "./task";
import { STATE, WORK, workNew } from "./work";

afterAll(cleanScratch);

const CLI = new URL("../../bin/craftpath.ts", import.meta.url).pathname;
const ID = "W-0001-avatar-upload";
const TASK_STATE = `${STATE}/${ID}/T001.json`;

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

async function repo(): Promise<string> {
    const root = await scratch("craftpath-integrity-");
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await quietly(() => taskAdd(root, "T001", { title: "Add the endpoint", skills: ["backend"] }));
    return root;
}

async function cli(
    root: string,
    args: string[],
    stdin = "",
): Promise<{ exit: number; out: string }> {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const key of ["CRAFTPATH_PROJECT_DIR", "CLAUDE_PROJECT_DIR", "PI_PROJECT_DIR"]) {
        delete env[key];
    }
    const p = Bun.spawn([process.execPath, CLI, ...args], {
        cwd: root,
        env,
        stdin: new Blob([stdin]),
        stdout: "pipe",
        stderr: "pipe",
    });
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { exit: await p.exited, out };
}

describe("corrupt task state is reported, not crashed on", () => {
    test("a state value outside the schema is exit 3 naming the file", async () => {
        const root = await repo();
        await Bun.write(join(root, TASK_STATE), '{"id":"T001","status":"donee"}');

        const { exit, out } = await cli(root, ["status"]);

        expect(exit).toBe(3);
        expect(out).toContain(TASK_STATE);
    });

    test("a state file that is not JSON is exit 3 naming the file", async () => {
        const root = await repo();
        await Bun.write(join(root, TASK_STATE), "not json");

        const { exit, out } = await cli(root, ["task", "start", "T001"]);

        expect(exit).toBe(3);
        expect(out).toContain(TASK_STATE);
        expect(out).not.toContain("SyntaxError");
    });

    test("reconcile reports corrupt state instead of skipping or crashing", async () => {
        const root = await repo();
        await Bun.write(join(root, TASK_STATE), "not json");

        const { exit, out } = await cli(root, ["reconcile"]);

        expect(exit).toBe(3);
        expect(out).toContain(TASK_STATE);
    });

    test("the Stop hook relays corrupt state as a finding, not a hook error", async () => {
        const root = await repo();
        await Bun.write(join(root, TASK_STATE), "not json");

        const { exit, out } = await cli(root, ["hook", "validate"], "{}");

        expect(exit).toBe(2);
        expect(out).toContain(TASK_STATE);
    });
});

describe("one task file per task id", () => {
    test("two task files carrying the same id are refused, naming both", async () => {
        const root = await repo();
        const tasks = join(root, WORK, ID, "tasks");
        const body = await Bun.file(join(tasks, "T001-backend.md")).text();
        await Bun.write(
            join(tasks, "T001-frontend.md"),
            body.replace("Add the endpoint", "A shadow copy"),
        );

        const { exit, out } = await cli(root, ["validate"]);

        expect(exit).toBe(3);
        expect(out).toContain("T001-backend.md");
        expect(out).toContain("T001-frontend.md");
    });

    test("a task file whose name disagrees with its id is refused", async () => {
        const root = await repo();
        const tasks = join(root, WORK, ID, "tasks");
        const body = await Bun.file(join(tasks, "T001-backend.md")).text();
        await rm(join(tasks, "T001-backend.md"));
        await Bun.write(join(tasks, "T009-backend.md"), body);

        const { exit, out } = await cli(root, ["status"]);

        expect(exit).toBe(3);
        expect(out).toContain("T009-backend.md");
        expect(out).toContain("T001");
    });
});

describe("work new is all or nothing", () => {
    test("a missing template leaves no work directory and no state behind", async () => {
        const root = await scratch("craftpath-integrity-");
        await quietly(() => init(root));
        await rm(join(root, ".craftpath/templates/plan.md"));

        const error = await quietly(() => workNew(root, "Avatar upload", "standard")).then(
            () => null,
            (e: Error & { exitCode?: number }) => e,
        );

        expect(error?.exitCode).toBe(3);
        expect(error?.message).toContain("plan.md");
        const left = async (dir: string) =>
            (await readdir(join(root, dir))).filter((name) => name !== ".gitkeep");
        expect(await left(WORK)).toEqual([]);
        expect(await left(STATE)).toEqual([]);
    });
});
