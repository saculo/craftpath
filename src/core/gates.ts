/**
 * Gate state and phase, derived from recorded approvals and task status.
 *
 * Pure and type-only in its imports, so `status`, `approve` and `validate`
 * share one answer and none of them pays for loading Zod to get it.
 */
import type { Approval, GateState, Phase } from "../schema";
import type { Task } from "../transitions";

/**
 * Gate state, derived from the approval record rather than stored alongside it.
 *
 * Storing both would create two things that can disagree, and the stored
 * boolean is the one that goes stale.
 */
export function gateState(approvals: Approval[], phase: string): GateState {
    return approvals.some((a) => a.phase === phase) ? "approved" : "pending";
}

/**
 * Where a work item stands, from what is recorded -- never stored (D1).
 *
 * Nothing could honestly write a stored phase: a command the agent calls to
 * advance it is a claim nothing checks. Gates are checked in order, so an
 * approved result with an unfinished task still reads as `execute`.
 */
export function derivePhase(work: { approvals: Approval[] }, tasks: Map<string, Task>): Phase {
    if (gateState(work.approvals, "requirement") === "pending") return "requirement";
    if (gateState(work.approvals, "plan") === "pending") return "plan";

    const finished = tasks.size > 0 && [...tasks.values()].every((t) => t.status === "done");
    if (!finished) return "execute";

    if (gateState(work.approvals, "result") === "pending") return "result";
    return "pr";
}
