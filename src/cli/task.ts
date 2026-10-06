import { UsageError } from "../exit";
import {
    taskAck,
    taskAdd,
    taskAmend,
    taskDone,
    taskStart,
    taskVerify,
    taskVerifyAll,
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
    flags: { work?: string },
    id: string,
    criterion: string,
): Promise<void> {
    await taskAck(process.cwd(), id, criterion, flags.work);
}

export async function amend(
    this: Context,
    flags: { reason: string; work?: string },
    id: string,
): Promise<void> {
    await taskAmend(process.cwd(), id, flags.reason, flags.work);
}
