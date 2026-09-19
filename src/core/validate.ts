/**
 * `craftpath validate` -- structural checks (§6.1).
 *
 * A half-finished work item is structurally valid. This runs on the Stop hook,
 * and a Stop hook that fails on every legitimate pause is noise that teaches
 * people to ignore it. Completion is a different question: `--complete`.
 */
import { join } from "node:path";
import { Exit } from "../exit";
import { GateName, type WorkState } from "../schema";
import { type Task, graphProblems, unsatisfied } from "../transitions";
import { gateState } from "./approve";
import { criteriaHash } from "./criteria";
import { anchorTrailers, configHash, trailerInBranch } from "./task";
import { STATE, WORK, openWorkId, readOpenWork, readTasks } from "./work";

export class ValidationError extends Error {
    readonly exitCode = Exit.VALIDATION_FAILED;
}

export async function validate(root: string): Promise<void> {
    const workId = await openWorkId(root);
    if (workId === null) return;

    const tasks = await readTasks(root, workId);
    const problems = [
        ...graphProblems(tasks),
        ...(await evidenceProblems(root, workId, tasks)),
    ];

    if (problems.length > 0) {
        throw new ValidationError(
            [`${workId} is structurally invalid:`, ...problems.map((p) => `  - ${p}`)].join("\n"),
        );
    }
    console.log(`valid     ${workId}`);
}

/**
 * `craftpath validate --complete` -- completion checks (§6.2).
 *
 * Run before result, PR and archive. Everything must be proven, and "nothing
 * to prove" is not proven: a work item with no tasks refuses.
 *
 * Every gate needs a recorded approval, whatever its config policy. An
 * auto-approved gate still records one, so completion never depends on
 * re-reading the policy that granted it.
 */
export interface Proven {
    work: WorkState;
    tasks: Map<string, Task>;
    hash: string;
}

export async function proveComplete(root: string): Promise<Proven> {
    const work = await readOpenWork(root);
    if (work === null) {
        throw new ValidationError("No open work item, so there is nothing to prove complete.");
    }

    const tasks = await readTasks(root, work.id);
    const hash = await configHash(root);
    const problems = [
        ...graphProblems(tasks),
        ...(await evidenceProblems(root, work.id, tasks)),
    ];

    if (tasks.size === 0) problems.push("there are no tasks, so nothing has been proven");

    for (const task of tasks.values()) {
        if (task.status !== "done") {
            problems.push(`${task.id} is ${task.status}, not done`);
            continue;
        }
        // Done once is not done now: config edits make proof stale, and a
        // rebase can drop the commit that carried the trailer.
        const left = unsatisfied(task, hash);
        if (left.length > 0) {
            problems.push(`${task.id} is done but no longer satisfies: ${left.join(", ")}`);
        }
        if (!(await trailerInBranch(root, work.id, task.id))) {
            const [workTrailer, taskTrailer] = anchorTrailers(work.id, task.id);
            problems.push(
                `${task.id} is done but no commit carrying both \`${workTrailer}\` ` +
                `and \`${taskTrailer}\` is on the branch`,
            );
        }
    }

    const pending = GateName.options.filter((g) => gateState(work.approvals, g, work.amendments) === "pending");
    if (pending.length > 0) {
        problems.push(
            `gates not approved: ${pending.join(", ")} -- record with \`craftpath approve <gate>\``,
        );
    }

    problems.push(...criteriaProblems(work, tasks));
    problems.push(...(await deltaProblems(root, work.id)));

    if (problems.length > 0) {
        throw new ValidationError(
            [`${work.id} is not proven complete:`, ...problems.map((p) => `  - ${p}`)].join("\n"),
        );
    }
    return { work, tasks, hash };
}

/** Prints on success. `pr body` calls proveComplete instead, so stdout stays the body. */
export async function validateComplete(root: string): Promise<void> {
    const { work } = await proveComplete(root);
    console.log(`complete  ${work.id}`);
}

/**
 * The approved plan's criteria, still the criteria being completed against.
 *
 * `amendments_seen` reopens the plan gate for a task amended or added, because
 * both record an amendment. Rewriting an acceptance block in place records
 * nothing, so this is the half that record cannot see -- and the cheapest one
 * to perform, since criteria are model space by design.
 *
 * An approval with no hash predates the field. Nothing to compare is not a
 * mismatch: refusing there would strand every work item approved by an older
 * craftpath short of completion, with no honest repair.
 */
function criteriaProblems(work: WorkState, tasks: Map<string, Task>): string[] {
    const approval = work.approvals.findLast((a) => a.phase === "plan");
    if (approval?.criteria_hash === undefined) return [];
    if (approval.criteria_hash === criteriaHash(tasks)) return [];
    return [
        "the acceptance criteria changed after the plan was approved, and no " +
        'amendment records it -- run `craftpath amend <id> --reason "<why>"` ' +
        "for the task whose criteria changed, then re-approve the plan",
    ];
}

/**
 * `work new` always scaffolds spec-delta.md, so the common failure is not an
 * absent file but the untouched template.
 */
async function deltaProblems(root: string, workId: string): Promise<string[]> {
    const file = Bun.file(join(root, WORK, workId, "spec-delta.md"));
    if (!(await file.exists())) {
        return ["spec-delta.md does not exist; write how this work changes the living specs"];
    }
    if ((await file.text()).includes("<PREFIX>")) {
        return ["spec-delta.md still holds the template placeholder <PREFIX>-Rn"];
    }
    return [];
}

/**
 * Mechanism M3: every evidence record must have its log, and the log must agree
 * with the recorded exit code. Without this, flipping `exit: 1` to `exit: 0` in
 * a state file is free.
 */
async function evidenceProblems(
    root: string,
    workId: string,
    tasks: Map<string, Task>,
): Promise<string[]> {
    const problems: string[] = [];
    for (const task of tasks.values()) {
        for (const evidence of task.evidence) {
            const file = Bun.file(join(root, STATE, workId, evidence.log));
            if (!(await file.exists())) {
                problems.push(
                    `${task.id}: evidence for ${evidence.cmd} points at ${evidence.log}, which does not exist`,
                );
                continue;
            }
            const logged = loggedExit(await file.text());
            if (logged !== evidence.exit) {
                problems.push(
                    `${task.id}: ${evidence.log} shows exit ${logged ?? "(none)"} ` +
                    `but the evidence records exit ${evidence.exit}`,
                );
            }
        }
    }
    return problems;
}

/**
 * The `exit: N` line `task verify` appends. The last one, because the command's
 * own output comes first and may contain the same text.
 */
function loggedExit(log: string): number | null {
    const matches = [...log.matchAll(/^exit: (-?\d+)$/gm)];
    const last = matches.at(-1);
    return last ? Number.parseInt(last[1]!, 10) : null;
}
