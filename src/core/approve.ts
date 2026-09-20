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
import { criteriaHash } from "./criteria";
import { CONFIG_PATH, gatePolicies } from "./config";
import { STATE, openWorkId, readOpenWork, readTasks } from "./work";

export { gateState };

const GATES = GateName.options;

/** git user.email. An unsigned approval or amendment proves nothing. */
export async function signer(root: string): Promise<string> {
    const result = await Bun.$`git -C ${root} config user.email`.quiet().nothrow();
    const email = result.stdout.toString().trim();
    if (result.exitCode !== 0 || email.length === 0) {
        throw new PreconditionError(
            "git user.email is not set, so this cannot be signed. " +
                "Set it with: git config user.email you@example.com",
        );
    }
    return email;
}

export interface ApproveOptions {
    /** `--approver <email>`: names the person, for scripts and CI. */
    approver?: string;
    /** Injectable for tests; production passes `process.stdin.isTTY`. */
    interactive?: boolean;
}

/**
 * Who is allowed to give this approval, and how it gets recorded.
 *
 * Until now `[gates]` had no production reader at all: `plan = "manual"` meant
 * "the agent stops", enforced purely by a sentence in the slash command, while
 * `by` recorded the repo's git email either way -- so nothing in the record
 * could tell an agent's self-approval from a person's.
 *
 * This is a speed bump, not a boundary, and it is worth being precise about
 * which part is which. The DURABLE half is `via`: it is decided here, at
 * approval time, and it survives in the record. The BEST-EFFORT half is the
 * refusal: a TTY is evidence that someone is at a keyboard, not proof, and
 * `--approver` is a name the caller supplies. The boundary that actually holds
 * is guard-bash refusing the agent's shell the command in the first place.
 */
async function signal(
    root: string,
    phase: GateName,
    options: ApproveOptions,
): Promise<{ by: string; via: "auto" | "terminal" | "approver" }> {
    if (options.approver?.trim()) {
        return { by: options.approver.trim(), via: "approver" };
    }

    const policy = (await gatePolicies(root))[phase];
    if (policy === "auto") return { by: await signer(root), via: "auto" };

    if (options.interactive ?? process.stdin.isTTY) {
        return { by: await signer(root), via: "terminal" };
    }

    throw new PreconditionError(
        `The ${phase} gate is \`manual\` in ${CONFIG_PATH}, so it needs a person.\n` +
            `Run \`craftpath approve ${phase}\` in your own terminal, or name the ` +
            `approver explicitly:\n` +
            `  craftpath approve ${phase} --approver you@example.com`,
    );
}

export async function approve(
    root: string,
    phase: string,
    options: ApproveOptions = {},
): Promise<void> {
    if (!GateName.safeParse(phase).success) {
        throw new PreconditionError(`${phase} is not a gate. Valid gates: ${GATES.join(", ")}.`);
    }

    const workId = await openWorkId(root);
    if (workId === null) {
        throw new PreconditionError(
            'No open work item. Start one with `craftpath work new "<title>"`.',
        );
    }

    const state = (await readOpenWork(root))!;

    if (gateState(state.approvals, phase, state.amendments) === "approved") {
        // Idempotent, and deliberately non-destructive: the original approver
        // and timestamp are the record. Overwriting them would quietly rewrite
        // who signed off on what.
        const existing = state.approvals.findLast((a) => a.phase === phase)!;
        console.log(`kept      ${phase} approved by ${existing.by} at ${existing.at}`);
        return;
    }

    // Gates are approved in order. The phase is derived from them (gates.ts),
    // so a plan approved over a pending requirement reads as nonsense.
    const predecessor = GATES[GATES.indexOf(phase as GateName) - 1];
    if (predecessor && gateState(state.approvals, predecessor, state.amendments) === "pending") {
        throw new PreconditionError(
            `${phase} cannot be approved while ${predecessor} is pending. ` +
                `Approve ${predecessor} first.`,
        );
    }

    const tasks = await readTasks(root, workId);
    if (phase === "plan" && tasks.size === 0) {
        throw new PreconditionError(
            "The plan has no tasks, so there is nothing to approve. " +
                "Add them with `craftpath task add` first.",
        );
    }

    const gate = GateName.parse(phase);
    const { by, via } = await signal(root, gate, options);

    const next: WorkState = {
        ...state,
        approvals: [
            ...state.approvals,
            {
                phase: gate,
                by,
                via,
                at: new Date().toISOString(),
                amendments_seen: state.amendments.length,
                // What was approved, not just that something was. Recorded on
                // every gate so the record says what each one saw; only the
                // plan's is checked, in validate --complete.
                criteria_hash: criteriaHash(tasks),
            },
        ],
    };

    await Bun.write(
        join(root, STATE, workId, "work.json"),
        JSON.stringify(WorkState.parse(next), null, 2) + "\n",
    );
    console.log(`approved  ${phase} (${via}, ${by})`);
}
