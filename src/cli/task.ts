import { UsageError } from "../exit";
import {
    taskAck,
    taskAdd,
    taskAmend,
    taskDone,
    taskStart,
    taskVerify,
    taskVerifyAll,
    taskResume,
} from "../core/task";
import type { Context } from "./context";

/** `--skills a,b` -> ["a", "b"]; an empty or absent flag stays undefined. */
function list(value: string | undefined): string[] | undefined {
    return value
        ?.split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

export async function add(
    this: Context,
    flags: {
        title: string;
        skills?: string;
        depends?: string;
        design?: string;
        designReason?: string;
        produces?: string;
        reason?: string;
        work?: string;
    },
    id: string,
): Promise<void> {
    await taskAdd(process.cwd(), id, {
        title: flags.title,
        skills: list(flags.skills),
        dependsOn: list(flags.depends),
        design: flags.design,
        designReason: flags.designReason,
        produces: list(flags.produces),
        reason: flags.reason,
        work: flags.work,
    });
}

export async function start(this: Context, flags: { work?: string }, id: string): Promise<void> {
    await taskStart(process.cwd(), id, flags.work);
}

export async function verify(
    this: Context,
    flags: { work?: string; all: boolean },
    id?: string,
): Promise<void> {
    if (flags.all === (id !== undefined)) {
        throw new UsageError("usage: craftpath task verify <id> | craftpath task verify --all");
    }
    if (flags.all) await taskVerifyAll(process.cwd(), flags.work);
    else await taskVerify(process.cwd(), id!, flags.work);
}

export async function done(this: Context, flags: { work?: string }, id: string): Promise<void> {
    await taskDone(process.cwd(), id, flags.work);
}

export async function ack(
    this: Context,
    flags: { work?: string; "harness-approval": boolean },
    id: string,
    criterion: string,
): Promise<void> {
    await taskAck(process.cwd(), id, criterion, flags.work, {
        harnessApproval: flags["harness-approval"],
    });
}

export async function amend(
    this: Context,
    flags: { reason: string; work?: string },
    id: string,
): Promise<void> {
    await taskAmend(process.cwd(), id, flags.reason, flags.work);
}

export async function resume(
    this: Context,
    flags: { reason: string; work?: string },
    id: string,
): Promise<void> {
    await taskResume(process.cwd(), id, flags.reason, flags.work);
}

/** `task next`: the decision, as JSON for the harness to act on. */
export async function next(this: Context, flags: { work?: string }): Promise<void> {
    const { nextTask } = await import("../core/advance");
    const decided = await nextTask(process.cwd(), flags.work);
    console.log(JSON.stringify(decided.status === "idle" ? decided : decided.brief, null, 2));
}

/** `task report`: the worker's final response, validated and recorded. */
export async function report(
    this: Context,
    flags: { work?: string; outcomeFile: string },
    id: string,
): Promise<void> {
    const { reportOutcome } = await import("../core/advance");
    const file = Bun.file(flags.outcomeFile);
    if (!(await file.exists())) {
        throw new UsageError(
            `${flags.outcomeFile} does not exist; write the worker's final response there.`,
        );
    }
    const recorded = await reportOutcome(process.cwd(), id, await file.text(), flags.work);
    console.log(JSON.stringify(recorded, null, 2));
}
