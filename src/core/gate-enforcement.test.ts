/**
 * Gates enforced by the kernel rather than by the workflow's prose.
 *
 * G2 is the highest-leverage gate: implementation starts only against an
 * approved plan. G3 reviews finished work: it cannot be given while a task is
 * still open, or the result is approved before it exists.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TaskState } from "../schema";
import { cleanScratch, scratch } from "../../test/scratch";
import { advance } from "./advance";
import { approve } from "./approve";
import { init } from "./init";
import { taskAdd, taskAmend, taskDone, taskStart } from "./task";
import type { Mode } from "../schema";
import { workNew } from "./work";

afterAll(cleanScratch);

const WORK = "W-0001-avatar-upload";
const BOSS = { approver: "boss@example.com" };

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
    }
}

/** Rejection of fn, or null if it resolved. */
async function refusal(
    fn: () => Promise<unknown>,
): Promise<(Error & { exitCode?: number }) | null> {
    return quietly(fn).then(
        () => null,
        (error: Error & { exitCode?: number }) => error,
    );
}

async function repo(mode: Mode = "light"): Promise<string> {
    const root = await scratch("craftpath-gates-");
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", mode));
    await quietly(() => taskAdd(root, "T001", { title: "Add the endpoint" }));
    await quietly(() => taskAdd(root, "T002", { title: "Wire the UI" }));
    await quietly(() => approve(root, "requirement"));
    return root;
}

const statePath = (root: string, id: string) => join(root, ".craftpath/state", WORK, `${id}.json`);

async function status(root: string, id: string): Promise<string> {
    return TaskState.parse(await Bun.file(statePath(root, id)).json()).status;
}

async function setStatus(root: string, id: string, value: "in_progress" | "done"): Promise<void> {
    const state = TaskState.parse(await Bun.file(statePath(root, id)).json());
    await Bun.write(statePath(root, id), JSON.stringify({ ...state, status: value }, null, 2));
}

describe("execution waits for an approved plan", () => {
    test("task start refuses while the plan gate is pending", async () => {
        const root = await repo();

        const error = await refusal(() => taskStart(root, "T001"));

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("plan");
        expect(await status(root, "T001")).toBe("pending");
    });

    test("task start proceeds once the plan is approved", async () => {
        const root = await repo();
        await quietly(() => approve(root, "plan", BOSS));

        await quietly(() => taskStart(root, "T001"));

        expect(await status(root, "T001")).toBe("in_progress");
    });

    test("an amendment reopens the plan, and starting waits for re-approval", async () => {
        const root = await repo();
        await quietly(() => approve(root, "plan", BOSS));
        await quietly(() => taskAmend(root, "T001", "criteria were wrong"));

        const error = await refusal(() => taskStart(root, "T002"));

        expect(error?.exitCode).toBe(2);
        expect(await status(root, "T002")).toBe("pending");
    });

    test("task done refuses while the plan gate is pending, even for a started task", async () => {
        // A work item started under an older craftpath can hold in_progress
        // tasks that were never gated. They do not complete around the gate.
        const root = await repo();
        await setStatus(root, "T001", "in_progress");

        const error = await refusal(() => taskDone(root, "T001"));

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("plan");
        expect(await status(root, "T001")).toBe("in_progress");
    });

    test("advance runs no worker while the plan gate is pending", async () => {
        const root = await repo();
        let called = false;

        const error = await refusal(() =>
            advance(root, async () => {
                called = true;
                return "";
            }),
        );

        expect(error?.exitCode).toBe(2);
        expect(called).toBe(false);
        expect(await status(root, "T001")).toBe("pending");
    });
});

describe("the result gate reviews finished work", () => {
    test("result cannot be approved while a task is not done", async () => {
        const root = await repo();
        await quietly(() => approve(root, "plan", BOSS));
        await setStatus(root, "T001", "done");

        const error = await refusal(() => approve(root, "result", BOSS));

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("T002");
    });

    test("in standard mode, result cannot be approved over an untouched result.md", async () => {
        const root = await repo("standard");
        await quietly(() => approve(root, "plan", BOSS));
        await setStatus(root, "T001", "done");
        await setStatus(root, "T002", "done");

        const error = await refusal(() => approve(root, "result", BOSS));

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("result.md");
    });

    test("result is approved once every task is done and the result is written", async () => {
        const root = await repo("standard");
        await quietly(() => approve(root, "plan", BOSS));
        await setStatus(root, "T001", "done");
        await setStatus(root, "T002", "done");
        await Bun.write(
            join(root, ".craftpath/work", WORK, "result.md"),
            "# Result\n\nAvatars upload; TIFF is refused with 415.\n",
        );

        expect(await refusal(() => approve(root, "result", BOSS))).toBeNull();
    });
});
