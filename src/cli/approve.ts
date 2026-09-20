import { approve as record } from "../core/approve";
import type { Context } from "./context";

export async function approve(
    this: Context,
    flags: { approver?: string },
    phase: string,
): Promise<void> {
    await record(process.cwd(), phase, { approver: flags.approver });
}
