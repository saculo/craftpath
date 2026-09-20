import { taskAck, taskAdd, taskAmend, taskDone, taskStart, taskVerify } from "../core/task";
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
    });
}

export async function start(this: Context, _flags: {}, id: string): Promise<void> {
    await taskStart(process.cwd(), id);
}

export async function verify(this: Context, _flags: {}, id: string): Promise<void> {
    await taskVerify(process.cwd(), id);
}

export async function done(this: Context, _flags: {}, id: string): Promise<void> {
    await taskDone(process.cwd(), id);
}

export async function ack(
    this: Context,
    _flags: {},
    id: string,
    criterion: string,
): Promise<void> {
    await taskAck(process.cwd(), id, criterion);
}

export async function amend(
    this: Context,
    flags: { reason: string },
    id: string,
): Promise<void> {
    await taskAmend(process.cwd(), id, flags.reason);
}
