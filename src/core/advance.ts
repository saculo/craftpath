import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { PreconditionError, isBlocked, type Task } from "../transitions";
import { TaskState } from "../schema";
import { resolveInputs, taskStart, type TaskInput } from "./task";
import { STATE, openWorkId, readTaskProse, readTasks, readWork } from "./work";

export interface WorkerInput {
    workId: string;
    taskId: string;
    task: Task;
    skills: string[];
    requirement: string;
    inputs: TaskInput[];
}

export type WorkerExecutor = (input: WorkerInput) => Promise<string>;

type Outcome =
    | { ok: true; status: "completed" | "blocked" | "failed"; summary: string; blocker?: string }
    | { ok: false; summary: string; reason: string };

function parseOutcome(text: string): Outcome {
    const summary = text.trim() || "Worker returned no output.";
    const match = text.match(/<craftpath-outcome>\s*([\s\S]*?)\s*<\/craftpath-outcome>/i);
    if (match === null)
        return { ok: false, summary, reason: "missing <craftpath-outcome> envelope" };

    let value: unknown;
    try {
        value = JSON.parse(match[1] ?? "");
    } catch {
        return { ok: false, summary, reason: "outcome is not valid JSON" };
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, summary, reason: "outcome must be an object" };
    }
    const outcome = value as Record<string, unknown>;
    if (!Object.keys(outcome).every((key) => ["status", "summary", "blocker"].includes(key))) {
        return { ok: false, summary, reason: "outcome has unknown fields" };
    }
    if (!["completed", "blocked", "failed"].includes(String(outcome.status))) {
        return { ok: false, summary, reason: "outcome has an invalid status" };
    }
    if (typeof outcome.summary !== "string" || outcome.summary.trim() === "") {
        return { ok: false, summary, reason: "outcome needs a factual summary" };
    }
    const factual = outcome.summary.trim();
    const normalized = factual.toLowerCase().replace(/[.!?]/g, "");
    if (
        ["how can i help", "how may i help", "i am ready", "i'm ready", "ready to assist"].includes(
            normalized,
        )
    ) {
        return { ok: false, summary: factual, reason: "generic or no-op outcome" };
    }
    const status = outcome.status as "completed" | "blocked" | "failed";
    if (status === "completed" && "blocker" in outcome) {
        return { ok: false, summary: factual, reason: "completed outcome cannot have a blocker" };
    }
    if (
        status !== "completed" &&
        (typeof outcome.blocker !== "string" || outcome.blocker.trim() === "")
    ) {
        return { ok: false, summary: factual, reason: "blocked or failed outcome needs a blocker" };
    }
    return { ok: true, status, summary: factual, blocker: outcome.blocker as string | undefined };
}

async function appendAttempt(
    root: string,
    workId: string,
    taskId: string,
    attempt: {
        status: "completed" | "blocked" | "failed";
        summary: string;
        blocker?: string;
        reason?: string;
    },
): Promise<void> {
    const path = join(root, STATE, workId, `${taskId}.json`);
    const state = TaskState.parse(await Bun.file(path).json());
    await Bun.write(
        path,
        JSON.stringify(
            TaskState.parse({
                ...state,
                attempts: [...state.attempts, { ...attempt, at: new Date().toISOString() }],
            }),
            null,
            2,
        ) + "\n",
    );
}

async function assertBoundWorktree(root: string, workId: string): Promise<void> {
    const binding = (await readWork(root, workId)).worktree;
    if (binding === undefined) return; // Work created before worktree ownership was introduced.

    if (binding.path !== root) {
        throw new PreconditionError(
            `${workId} is bound to worktree ${binding.path}; advance it from that worktree.`,
        );
    }

    const result = await Bun.$`git -C ${root} branch --show-current`.quiet().nothrow();
    if (result.exitCode !== 0 || result.stdout.toString().trim() !== binding.branch) {
        throw new PreconditionError(
            `${workId} is bound to branch ${binding.branch}; check it out before advancing.`,
        );
    }
}

/** A directory creation is atomic, so it serializes one work item's advancement. */
async function withWorkLock<T>(root: string, workId: string, action: () => Promise<T>): Promise<T> {
    const lock = join(root, STATE, workId, ".advance.lock");
    try {
        await mkdir(lock);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            throw new PreconditionError(`${workId} is already being advanced by another harness.`);
        }
        throw error;
    }

    try {
        return await action();
    } finally {
        await rm(lock, { recursive: true, force: true });
    }
}

/**
 * Start one selected, unblocked task and record the worker's declared outcome.
 *
 * A completed worker response is deliberately not task completion: evidence,
 * a commit trailer, and `task done` remain the proof boundary.
 */
export async function advance(
    root: string,
    execute: WorkerExecutor,
    selectedWork?: string,
): Promise<{
    status: "completed" | "blocked" | "failed" | "idle";
    taskId?: string;
    reason?: string;
}> {
    const workId = await openWorkId(root, selectedWork);
    if (workId === null) throw new PreconditionError("No open work item to advance.");

    await assertBoundWorktree(root, workId);
    return withWorkLock(root, workId, async () => {
        const tasks = await readTasks(root, workId);
        const task = [...tasks.values()]
            .sort((a, b) => a.id.localeCompare(b.id))
            .find((item) => item.status !== "done" && !isBlocked(item, tasks));
        if (task === undefined) return { status: "idle" } as const;

        const inputs = await resolveInputs(root, task, tasks);
        const prose = await readTaskProse(root, workId, task.id);
        const requirement = await Bun.file(
            join(root, ".craftpath/work", workId, "requirement.md"),
        ).text();
        await taskStart(root, task.id, workId);

        let output: string;
        try {
            output = await execute({
                workId,
                taskId: task.id,
                task,
                skills: prose.skills,
                requirement,
                inputs,
            });
        } catch (error) {
            const reason = `worker execution failed: ${error instanceof Error ? error.message : String(error)}`;
            await appendAttempt(root, workId, task.id, {
                status: "failed",
                summary: reason,
                reason,
            });
            return { status: "failed", taskId: task.id, reason } as const;
        }

        const outcome = parseOutcome(output);
        if (!outcome.ok) {
            await appendAttempt(root, workId, task.id, {
                status: "failed",
                summary: outcome.summary,
                reason: outcome.reason,
            });
            return { status: "failed", taskId: task.id, reason: outcome.reason } as const;
        }

        await appendAttempt(root, workId, task.id, {
            status: outcome.status,
            summary: outcome.summary,
            blocker: outcome.blocker,
        });
        return { status: outcome.status, taskId: task.id, reason: outcome.blocker } as const;
    });
}
