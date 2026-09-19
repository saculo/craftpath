/**
 * Task state machine -- the single place transitions are defined.
 *
 * Executable rather than a table in a document, so the two cannot drift.
 * Every precondition here is checkable from disk; nothing depends on model
 * assertion.
 *
 * Sessions are deliberately absent (D20). In sequential single-agent mode
 * `in_progress` means "started, not proven finished", and resume re-runs
 * verification rather than trusting partial state. Session claiming returns
 * with parallel execution (M5) if that milestone ever happens.
 */
import { Exit } from "./exit";
import type { Acceptance, Ack, Evidence, Status } from "./schema";

export class PreconditionError extends Error {
    readonly exitCode = Exit.PRECONDITION_FAILED;
}

export class CorruptStateError extends Error {
    readonly exitCode = Exit.CORRUPT_STATE;
}

/** A task as the CLI sees it: prose definition plus trusted state. */
export interface Task {
    id: string;
    status: Status;
    depends_on: string[];
    acceptance: Acceptance[];
    evidence: Evidence[];
    acks: Ack[];
    /** Declared outputs. Read by dependents at start; never derived from disk. */
    produces: string[];
}

// ---------------------------------------------------------------------------
// Derived quantities -- never stored, always computed (D4, §5.3)
// ---------------------------------------------------------------------------

function proves(e: Evidence, cmd: string, selector?: string): boolean {
    if (e.cmd !== cmd || e.exit !== 0) return false;
    // Suite-wide evidence does not prove a selector-scoped criterion.
    return selector === undefined || e.selector === selector;
}

export function isStale(
    item: { config_hash: string },
    currentHash: string,
): boolean {
    return item.config_hash !== currentHash;
}

export function criterionSatisfied(
    task: Task,
    criterion: Acceptance,
    currentHash: string,
): boolean {
    // A criterion with no verified_by cannot be satisfied by anything.
    if (criterion.verified_by.length === 0) return false;

    return criterion.verified_by.every(({ cmd, selector }) => {
        if (cmd === "manual") {
            return task.acks.some(
                (a) => a.criterion_id === criterion.id && !isStale(a, currentHash),
            );
        }
        return task.evidence.some(
            (e) => proves(e, cmd, selector) && !isStale(e, currentHash),
        );
    });
}

export function unsatisfied(task: Task, currentHash: string): string[] {
    return task.acceptance
        .filter((c) => !criterionSatisfied(task, c, currentHash))
        .map((c) => c.id);
}

/** Blocked is derived from dependencies, never stored. */
export function isBlocked(task: Task, all: Map<string, Task>): boolean {
    return task.depends_on.some((depId) => {
        const dep = all.get(depId);
        if (!dep) {
            throw new CorruptStateError(
                `${task.id} depends on unknown task ${depId}`,
            );
        }
        return dep.status !== "done";
    });
}

/** Topological grouping. A wave is a view over the graph, not stored state. */
export function waves(all: Map<string, Task>): string[][] {
    const done = new Set<string>();
    const out: string[][] = [];
    const remaining = new Set(all.keys());

    while (remaining.size > 0) {
        const wave = [...remaining].filter((id) =>
            all.get(id)!.depends_on.every((d) => done.has(d)),
        );
        if (wave.length === 0) {
            throw new CorruptStateError(
                `dependency cycle among: ${[...remaining].sort().join(", ")}`,
            );
        }
        wave.sort();
        out.push(wave);
        for (const id of wave) {
            done.add(id);
            remaining.delete(id);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/** pending -> in_progress. Repeat on in_progress is resume (no-op). */
export function start(task: Task, all: Map<string, Task>): Status {
    if (task.status === "done") {
        throw new PreconditionError(
            `${task.id} is already done. Use \`craftpath amend ${task.id} --reason "<why>"\` to reopen it.`,
        );
    }
    if (isBlocked(task, all)) {
        const pending = task.depends_on.filter(
            (d) => all.get(d)!.status !== "done",
        );
        throw new PreconditionError(
            `${task.id} is blocked by: ${pending.join(", ")}`,
        );
    }
    return "in_progress";
}

/**
 * Appends evidence. Never changes status, never un-completes a task.
 * Legal on `done` so re-verification after a rebase is possible.
 */
export function verify(task: Task): Status {
    if (task.status === "pending") {
        throw new PreconditionError(
            `${task.id} has not been started. Run \`craftpath task start ${task.id}\`.`,
        );
    }
    return task.status;
}

/** Records a signed manual acknowledgement for a `manual` criterion. */
export function ack(task: Task, criterionId: string): Status {
    if (task.status === "pending") {
        throw new PreconditionError(`${task.id} has not been started.`);
    }
    const criterion = task.acceptance.find((c) => c.id === criterionId);
    if (!criterion) {
        throw new PreconditionError(`${task.id} has no criterion ${criterionId}`);
    }
    if (!criterion.verified_by.some((v) => v.cmd === "manual")) {
        throw new PreconditionError(
            `${criterionId} is verified by command, not manually. ` +
            `Run \`craftpath task verify ${task.id}\`.`,
        );
    }
    return task.status;
}

/**
 * in_progress -> done. Every criterion must be satisfied.
 *
 * `inBranch` is the result of grepping the work branch for this task's trailer.
 * The trailer is the anchor, not a commit hash, so this survives rebase,
 * squash and amend (D11).
 */
export function done(
    task: Task,
    currentHash: string,
    inBranch: boolean,
    /**
     * What the commit must carry, for the refusal message. The caller owns the
     * phrasing because it owns the query: since M1's exit criterion is a commit
     * anchored to THIS work item, the real anchor is a trailer pair.
     */
    anchor = `\`Task: ${task.id}\``,
): Status {
    if (task.status === "done") return "done";
    if (task.status === "pending") {
        throw new PreconditionError(`${task.id} has not been started.`);
    }

    const missing = unsatisfied(task, currentHash);
    if (missing.length > 0) {
        throw new PreconditionError(
            `${task.id} cannot complete. Unsatisfied criteria: ${missing.join(", ")}. ` +
            `Run \`craftpath task verify ${task.id}\` or ` +
            `\`craftpath task ack ${task.id} <id>\` for manual criteria.`,
        );
    }

    if (!inBranch) {
        throw new PreconditionError(
            `No commit carrying ${anchor} found on the work branch. ` +
            `Commit the work with the trailers before completing the task.`,
        );
    }

    return "done";
}

/** Any -> pending. Clears evidence; the requirement changed underneath it. */
export function amend(task: Task): Status {
    task.evidence = [];
    task.acks = [];
    return "pending";
}
