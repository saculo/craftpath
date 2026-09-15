/**
 * `craftpath validate` -- structural checks (§6.1).
 *
 * A half-finished work item is structurally valid. This runs on the Stop hook,
 * and a Stop hook that fails on every legitimate pause is noise that teaches
 * people to ignore it. Completion is a different question: `--complete`.
 */
import { join } from "node:path";
import { Exit } from "../exit";
import { CorruptStateError, type Task, waves } from "../transitions";
import { STATE, openWorkId, readTasks } from "./work";

export class ValidationError extends Error {
    readonly exitCode = Exit.VALIDATION_FAILED;
}

export async function validate(root: string): Promise<void> {
    const workId = await openWorkId(root);
    if (workId === null) return;

    const tasks = await readTasks(root, workId);
    const problems = [
        ...dependencyProblems(tasks),
        ...(await evidenceProblems(root, workId, tasks)),
    ];

    if (problems.length > 0) {
        throw new ValidationError(
            [`${workId} is structurally invalid:`, ...problems.map((p) => `  - ${p}`)].join("\n"),
        );
    }
    console.log(`valid     ${workId}`);
}

function dependencyProblems(tasks: Map<string, Task>): string[] {
    const dangling = [...tasks.values()].flatMap((task) =>
        task.depends_on
            .filter((dep) => !tasks.has(dep))
            .map((dep) => `${task.id} depends on ${dep}, which does not exist`),
    );
    // waves() reports a dangling edge as a cycle -- the missing task is never
    // done -- so it only gets a graph whose edges all resolve.
    if (dangling.length > 0) return dangling;

    try {
        waves(tasks);
        return [];
    } catch (error) {
        if (!(error instanceof CorruptStateError)) throw error;
        return [error.message];
    }
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
