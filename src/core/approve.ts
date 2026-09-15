/**
 * `craftpath approve <phase>` -- record a gate approval.
 *
 * §9: "an approval that lives only in the conversation is gone when the session
 * dies." That is the whole reason this is a command rather than a nod.
 */
import { join } from "node:path";
import { PreconditionError } from "../transitions";
import { GateName, WorkState } from "../schema";
import { gateState } from "./gates";
import { STATE, openWorkId, readOpenWork } from "./work";

export { gateState };

const GATES = GateName.options;

/** git user.email. An unsigned approval proves nothing, so refuse without it. */
async function signer(root: string): Promise<string> {
    const result = await Bun.$`git -C ${root} config user.email`.quiet().nothrow();
    const email = result.stdout.toString().trim();
    if (result.exitCode !== 0 || email.length === 0) {
        throw new PreconditionError(
            "git user.email is not set, so an approval cannot be signed. " +
            "Set it with: git config user.email you@example.com",
        );
    }
    return email;
}

export async function approve(root: string, phase: string): Promise<void> {
    if (!GateName.safeParse(phase).success) {
        throw new PreconditionError(
            `${phase} is not a gate. Valid gates: ${GATES.join(", ")}.`,
        );
    }

    const workId = await openWorkId(root);
    if (workId === null) {
        throw new PreconditionError(
            'No open work item. Start one with `craftpath work new "<title>"`.',
        );
    }

    const state = (await readOpenWork(root))!;

    if (gateState(state.approvals, phase) === "approved") {
        // Idempotent, and deliberately non-destructive: the original approver
        // and timestamp are the record. Overwriting them would quietly rewrite
        // who signed off on what.
        const existing = state.approvals.find((a) => a.phase === phase)!;
        console.log(`kept      ${phase} approved by ${existing.by} at ${existing.at}`);
        return;
    }

    const next: WorkState = {
        ...state,
        approvals: [
            ...state.approvals,
            { phase: GateName.parse(phase), by: await signer(root), at: new Date().toISOString() },
        ],
    };

    await Bun.write(
        join(root, STATE, workId, "work.json"),
        JSON.stringify(WorkState.parse(next), null, 2) + "\n",
    );
    console.log(`approved  ${phase}`);
}
