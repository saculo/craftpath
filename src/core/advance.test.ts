import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TaskState } from "../schema";
import { approvePlan } from "../../test/gates";
import { cleanScratch, scratch } from "../../test/scratch";
import { advance } from "./advance";
import { init } from "./init";
import { taskAdd, taskAmend, taskResume } from "./task";
import { workNew } from "./work";

afterAll(cleanScratch);

const WORK = "W-0001-avatar-upload";

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
    }
}

async function repoWithTask(): Promise<string> {
    const root = await scratch("craftpath-advance-");
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await quietly(() =>
        taskAdd(root, "T001", { title: "Add avatar upload", produces: ["design.md"] }),
    );
    return root;
}

describe("task advance", () => {
    test("generic worker output is a recorded failed attempt", async () => {
        const root = await repoWithTask();

        await approvePlan(root);
        const result = await advance(root, async () => "How can I help?");

        expect(result).toEqual({
            status: "failed",
            taskId: "T001",
            reason: "missing <craftpath-outcome> envelope",
        });
        const state = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "T001.json")).json(),
        );
        expect(state.status).toBe("in_progress");
        expect(state.attempts).toHaveLength(1);
        expect(state.attempts[0]).toMatchObject({
            status: "failed",
            summary: "How can I help?",
            reason: "missing <craftpath-outcome> envelope",
        });
    });

    test("leaves worktree selection and concurrent invocation to the operator", async () => {
        const root = await repoWithTask();
        const statePath = join(root, ".craftpath/state", WORK, "work.json");
        const state = (await Bun.file(statePath).json()) as Record<string, unknown>;
        // Old experimental ownership metadata is not a runtime restriction.
        await Bun.write(
            statePath,
            JSON.stringify({
                ...state,
                worktree: {
                    path: join(root, "another-worktree"),
                    branch: "work/W-0001-avatar-upload",
                },
            }),
        );

        let entered!: () => void;
        const running = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let release!: () => void;
        const finish = new Promise<void>((resolve) => {
            release = resolve;
        });
        await approvePlan(root);
        const first = advance(root, async () => {
            entered();
            await finish;
            return '<craftpath-outcome>{"status":"blocked","summary":"Waiting for review.","blocker":"Review the design."}</craftpath-outcome>';
        });
        await running;

        await expect(
            advance(
                root,
                async () =>
                    '<craftpath-outcome>{"status":"completed","summary":"Second invocation ran."}</craftpath-outcome>',
            ),
        ).resolves.toMatchObject({ status: "completed" });

        release();
        await first;
    });

    test("never advances a different selected work id", async () => {
        const root = await repoWithTask();
        await quietly(() => workNew(root, "Billing", "light"));
        await quietly(() => taskAdd(root, "T001", { title: "Add billing", work: "W-0002" }));

        await approvePlan(root, "W-0002");
        const result = await advance(
            root,
            async () =>
                '<craftpath-outcome>{"status":"blocked","summary":"Need a decision.","blocker":"Choose the billing provider."}</craftpath-outcome>',
            "W-0002",
        );

        expect(result).toEqual({
            status: "blocked",
            taskId: "T001",
            reason: "Choose the billing provider.",
        });
        const first = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "T001.json")).json(),
        );
        expect(first.status).toBe("pending");
        const second = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", "W-0002-billing", "T001.json")).json(),
        );
        expect(second.status).toBe("in_progress");
        expect(second.attempts[0]).toMatchObject({ status: "blocked" });
    });

    test("passes only declared dependency artifacts and still requires verification", async () => {
        const root = await repoWithTask();
        await quietly(() =>
            taskAdd(root, "T002", {
                title: "Use the design",
                skills: ["frontend"],
                dependsOn: ["T001"],
            }),
        );
        const first = join(root, ".craftpath/state", WORK, "T001.json");
        const state = TaskState.parse(await Bun.file(first).json());
        await Bun.write(first, JSON.stringify({ ...state, status: "done" }));
        await Bun.write(join(root, "design.md"), "chosen design\n");
        await Bun.write(join(root, "unrelated.md"), "do not preload\n");

        let input: unknown;
        let skills: unknown;
        await approvePlan(root);
        const result = await advance(root, async (brief) => {
            input = brief.inputs;
            skills = brief.skills;
            return '<craftpath-outcome>{"status":"completed","summary":"Implemented the selected task."}</craftpath-outcome>';
        });

        expect(result).toEqual({ status: "completed", taskId: "T002", reason: undefined });
        expect(input).toEqual([{ path: "design.md", content: "chosen design\n" }]);
        expect(skills).toEqual(["frontend"]);
        const second = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "T002.json")).json(),
        );
        expect(second.status).toBe("in_progress");
        expect(second.attempts).toHaveLength(1);
        expect(second.attempts[0]).toMatchObject({ status: "completed" });
    });
});

/** Two independent planned tasks, plan approved. */
async function repoWithTwo(): Promise<string> {
    const root = await scratch("craftpath-advance-");
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await quietly(() => taskAdd(root, "T001", { title: "Add avatar upload" }));
    await quietly(() => taskAdd(root, "T002", { title: "Add avatar removal" }));
    await approvePlan(root);
    return root;
}

const outcome =
    (status: string, extra: Record<string, string> = {}) =>
    async () =>
        `<craftpath-outcome>${JSON.stringify({ status, summary: `Worker ${status}.`, ...extra })}</craftpath-outcome>`;
const BLOCKED = outcome("blocked", { blocker: "no API key" });
const COMPLETED = outcome("completed");

async function refusal(
    fn: () => Promise<unknown>,
): Promise<(Error & { exitCode?: number }) | null> {
    return quietly(fn).then(
        () => null,
        (error: Error & { exitCode?: number }) => error,
    );
}

describe("advance holds a task with an unanswered outcome", () => {
    test("a blocked task is held, and advance moves on to the next independent task", async () => {
        const root = await repoWithTwo();
        await quietly(() => advance(root, BLOCKED));

        const next = await quietly(() => advance(root, COMPLETED));

        expect(next).toMatchObject({ status: "completed", taskId: "T002" });
    });

    test("a completed outcome holds the task until it is proven done", async () => {
        const root = await repoWithTwo();
        await quietly(() => advance(root, COMPLETED));

        const next = await quietly(() => advance(root, COMPLETED));

        expect(next).toMatchObject({ taskId: "T002" });
    });

    test("with every eligible task held, advance is idle and names what holds them", async () => {
        const root = await repoWithTwo();
        await quietly(() => advance(root, BLOCKED));
        await quietly(() => advance(root, COMPLETED));

        const next = await quietly(() => advance(root, COMPLETED));

        expect(next).toEqual({
            status: "idle",
            held: [
                { taskId: "T001", status: "blocked", reason: "no API key" },
                { taskId: "T002", status: "completed", reason: undefined },
            ],
        });
    });

    test("task resume answers a blocked outcome and makes the task eligible again", async () => {
        const root = await repoWithTwo();
        await quietly(() => advance(root, BLOCKED));
        await quietly(() => taskResume(root, "T001", "API key added to .env"));

        const next = await quietly(() => advance(root, COMPLETED));

        expect(next).toMatchObject({ taskId: "T001" });
        const state = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "T001.json")).json(),
        );
        expect(state.resumes.at(-1)).toMatchObject({ reason: "API key added to .env" });
    });

    test("task resume refuses a task with nothing to answer, or one awaiting proof", async () => {
        const root = await repoWithTwo();
        const fresh = await refusal(() => taskResume(root, "T001", "why not"));
        await quietly(() => advance(root, COMPLETED));
        const completed = await refusal(() => taskResume(root, "T001", "again"));

        expect(fresh?.exitCode).toBe(2);
        expect(completed?.exitCode).toBe(2);
        expect(completed?.message).toContain("verify");
    });

    test("an amendment answers a held task", async () => {
        const root = await repoWithTwo();
        await quietly(() => advance(root, BLOCKED));
        await quietly(() => taskAmend(root, "T001", "the criterion asked for the wrong thing"));
        await approvePlan(root);

        const next = await quietly(() => advance(root, COMPLETED));

        expect(next).toMatchObject({ taskId: "T001" });
    });

    test("craftpath task resume runs from the command line", async () => {
        const root = await repoWithTwo();
        await quietly(() => advance(root, BLOCKED));

        const p = Bun.spawn(
            [
                process.execPath,
                join(import.meta.dir, "../../bin/craftpath.ts"),
                "task",
                "resume",
                "T001",
                "--reason",
                "key added",
            ],
            { cwd: root, stdout: "pipe", stderr: "pipe" },
        );

        expect(await p.exited).toBe(0);
    });
});
