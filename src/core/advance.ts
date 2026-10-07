import { join } from "node:path";
import { PreconditionError, isBlocked, type Task, unanswered } from "../transitions";
import { TaskState } from "../schema";
import { startTask, type TaskInput } from "./task";
import { STATE, openWorkId, readTaskProse, readTaskState, readTasks, taskFile } from "./work";

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

export interface Held {
    taskId: string;
    status: "completed" | "blocked" | "failed";
    reason?: string;
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
    const state = (await readTaskState(root, workId, taskId))!;
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

/** What a worker must end its final response with. */
export const OUTCOME_CONTRACT =
    'End your final response with <craftpath-outcome>{"status":"completed" | "blocked" | "failed",' +
    '"summary":"<factual result>","blocker":"<required unless completed>"}</craftpath-outcome>.';

/** What `task next` hands the harness: everything a worker needs, by path. */
export interface Brief {
    status: "started";
    workId: string;
    taskId: string;
    skills: string[];
    taskFile: string;
    requirement: string;
    inputs: string[];
    outcome: string;
}

export type Next =
    | { status: "idle"; held?: Held[] }
    | { status: "started"; brief: Brief; worker: WorkerInput };

/**
 * `task next`: decide which task runs, start it, and describe it.
 *
 * The CLI decides and records; it never runs a worker. This picks the first
 * eligible task -- not done, not blocked by a dependency, not held by an
 * unanswered outcome -- starts it under the plan gate, and returns the brief
 * the harness's own agent hands to its subagent. An interrupted in_progress
 * task with no outcome is eligible again: starting it is a resume.
 */
export async function nextTask(root: string, selectedWork?: string): Promise<Next> {
    const workId = await openWorkId(root, selectedWork);
    if (workId === null) throw new PreconditionError("No open work item to advance.");

    const tasks = await readTasks(root, workId);
    const held: Held[] = [];
    let task: Task | undefined;
    for (const item of [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id))) {
        if (item.status === "done" || isBlocked(item, tasks)) continue;
        const state = await readTaskState(root, workId, item.id);
        const outcome = state === null ? null : unanswered(state);
        if (outcome !== null) {
            held.push({
                taskId: item.id,
                status: outcome.status,
                reason: outcome.blocker ?? outcome.reason,
            });
            continue;
        }
        task = item;
        break;
    }
    // Idle, and saying why: a held task is waiting on a person, not finished.
    if (task === undefined) return held.length > 0 ? { status: "idle", held } : { status: "idle" };

    const { inputs } = await startTask(root, task.id, workId);
    const prose = await readTaskProse(root, workId, task.id);
    const requirement = `.craftpath/work/${workId}/requirement.md`;
    return {
        status: "started",
        brief: {
            status: "started",
            workId,
            taskId: task.id,
            skills: prose.skills,
            taskFile: await taskFile(root, workId, task.id),
            requirement,
            inputs: inputs.map((input) => input.path),
            outcome: OUTCOME_CONTRACT,
        },
        worker: {
            workId,
            taskId: task.id,
            task,
            skills: prose.skills,
            requirement: await Bun.file(join(root, requirement)).text(),
            inputs,
        },
    };
}

export interface Reported {
    status: "completed" | "blocked" | "failed";
    taskId: string;
    reason?: string;
}

/**
 * `task report`: validate a worker's final response and record it.
 *
 * A malformed or generic response is recorded as a failed attempt, not
 * refused: it is a real outcome, and it holds the task like any other. What is
 * refused is reporting a task that was never started, or one whose last
 * outcome nobody has answered -- that would be a second answer to one run.
 */
export async function reportOutcome(
    root: string,
    taskId: string,
    text: string,
    selectedWork?: string,
): Promise<Reported> {
    const workId = await openWorkId(root, selectedWork);
    if (workId === null) throw new PreconditionError("No open work item to report on.");
    const state = await readTaskState(root, workId, taskId);
    if (state?.status !== "in_progress") {
        throw new PreconditionError(
            `${taskId} is not in progress, so no worker run is waiting to be reported. ` +
                `Get the task to run from \`craftpath task next --work ${workId}\`.`,
        );
    }
    const open = unanswered(state);
    if (open !== null) {
        throw new PreconditionError(
            `${taskId} already has an unanswered ${open.status} outcome. Answer it ` +
                `(\`craftpath task resume ${taskId} --reason "<why>" --work ${workId}\`) ` +
                "before reporting another run.",
        );
    }
    return record(root, workId, taskId, parseOutcome(text));
}

async function record(
    root: string,
    workId: string,
    taskId: string,
    outcome: Outcome,
): Promise<Reported> {
    if (!outcome.ok) {
        await appendAttempt(root, workId, taskId, {
            status: "failed",
            summary: outcome.summary,
            reason: outcome.reason,
        });
        return { status: "failed", taskId, reason: outcome.reason };
    }
    await appendAttempt(root, workId, taskId, {
        status: outcome.status,
        summary: outcome.summary,
        blocker: outcome.blocker,
    });
    return { status: outcome.status, taskId, reason: outcome.blocker };
}

/**
 * `next`, a worker, then `report` -- for a caller that holds a worker.
 *
 * The CLI never does: it exposes `next` and `report`, and the harness's agent
 * runs the worker between them. This composition is what both halves are
 * tested through, with a scripted worker in place of an agent.
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
    held?: Held[];
}> {
    const next = await nextTask(root, selectedWork);
    if (next.status === "idle") return next;
    const { workId, taskId } = next.brief;

    let output: string;
    try {
        output = await execute(next.worker);
    } catch (error) {
        const reason = `worker execution failed: ${error instanceof Error ? error.message : String(error)}`;
        await appendAttempt(root, workId, taskId, { status: "failed", summary: reason, reason });
        return { status: "failed", taskId, reason };
    }
    return record(root, workId, taskId, parseOutcome(output));
}
