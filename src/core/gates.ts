/**
 * Gate state and phase, derived from recorded approvals and task status.
 *
 * Pure and type-only in its imports, so `status`, `approve` and `validate`
 * share one answer and none of them pays for loading Zod to get it.
 */
import type { GateState, Phase } from "../schema";
import type { Task } from "../transitions";

/** The fields gate state reads. Loose, so fixtures need not spell out defaults. */
type ApprovalRecord = { phase: string; amendments_seen?: number };

/**
 * Gate state, derived from the approval record rather than stored alongside it.
 *
 * Storing both would create two things that can disagree, and the stored
 * boolean is the one that goes stale.
 *
 * An amendment reopens the plan and result gates: an approval given before
 * it approved a different plan. The requirement gate ignores amendments, since
 * changing a task does not change what was asked for. Counted rather than
 * timed, so an approval and an amendment in the same millisecond -- or signed
 * on machines with skewed clocks -- still order correctly.
 */
export function gateState(
    approvals: ApprovalRecord[],
    phase: string,
    amendments: readonly unknown[] = [],
): GateState {
    const needed = phase === "requirement" ? 0 : amendments.length;
    return approvals.some((a) => a.phase === phase && (a.amendments_seen ?? 0) >= needed)
        ? "approved"
        : "pending";
}

/**
 * Where a work item stands, from what is recorded -- never stored.
 *
 * Nothing could honestly write a stored phase: a command the agent calls to
 * advance it is a claim nothing checks. Gates are checked in order, so an
 * approved result with an unfinished task still reads as `execute`.
 */
export function derivePhase(
    work: { approvals: ApprovalRecord[]; amendments?: readonly unknown[] },
    tasks: Map<string, Task>,
): Phase {
    const gate = (phase: string) => gateState(work.approvals, phase, work.amendments);
    if (gate("requirement") === "pending") return "requirement";
    if (gate("plan") === "pending") return "plan";

    const finished = tasks.size > 0 && [...tasks.values()].every((t) => t.status === "done");
    if (!finished) return "execute";

    if (gate("result") === "pending") return "result";
    return "pr";
}
