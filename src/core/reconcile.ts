/**
 * `craftpath reconcile` -- drift between recorded state and the repository.
 *
 * Both guards refuse hand-edits of `.craftpath/state/` and point here for the
 * case where the state is genuinely wrong (§6.3). A trusted kernel with no
 * supported repair gets bypassed the first time `validate` reports something
 * nobody can fix, so this is the supported way to be wrong.
 *
 * Reporting and repairing are separate commands on purpose: repair is a
 * decision, so plain `reconcile` writes nothing at all.
 */
import { join } from "node:path";
import { TaskState } from "../schema";
import { anchorTrailers, trailerInBranch } from "./task";
import { ValidationError } from "./validate";
import { ARCHIVE, STATE, WORK, sortedEntries } from "./work";

/**
 * Every kind of drift found, one line each, in a stable order.
 *
 * Returned rather than printed so `--fix` can act on the same list the report
 * shows, instead of re-deriving it and risking a different answer.
 */
export async function drift(root: string): Promise<string[]> {
    return [
        ...(await scaffoldDrift(root)),
        ...(await trailerDrift(root)),
        ...(await archiveDrift(root)),
    ];
}

/** A work directory whose state never arrived: `work new` interrupted. */
async function scaffoldDrift(root: string): Promise<string[]> {
    const found: string[] = [];
    for (const id of await sortedEntries(join(root, WORK))) {
        if (!(await Bun.file(join(root, STATE, id, "work.json")).exists())) {
            found.push(
                `${WORK}/${id} exists but ${STATE}/${id}/work.json does not; ` +
                    `nothing records what it meant`,
            );
        }
    }
    return found;
}

/**
 * A done task whose trailer no longer reaches HEAD.
 *
 * Read from `state/` rather than from the task prose, because this is the one
 * command that has to work when the two disagree.
 */
async function trailerDrift(root: string): Promise<string[]> {
    const found: string[] = [];
    for (const workId of await sortedEntries(join(root, STATE))) {
        const dir = join(root, STATE, workId);
        const files = (await sortedEntries(dir)).filter(
            (name) => name.endsWith(".json") && name !== "work.json",
        );
        for (const file of files) {
            const parsed = TaskState.safeParse(await Bun.file(join(dir, file)).json());
            if (!parsed.success || parsed.data.status !== "done") continue;

            const id = parsed.data.id;
            if (await trailerInBranch(root, workId, id)) continue;

            const [workTrailer, taskTrailer] = anchorTrailers(workId, id);
            found.push(
                `${id} is done but no commit carrying both \`${workTrailer}\` and ` +
                    `\`${taskTrailer}\` is on the branch`,
            );
        }
    }
    return found;
}

/** An archive that moved the work directory but not the state directory. */
async function archiveDrift(root: string): Promise<string[]> {
    const found: string[] = [];
    for (const id of await sortedEntries(join(root, ARCHIVE))) {
        if (await Bun.file(join(root, STATE, id, "work.json")).exists()) {
            found.push(
                `${ARCHIVE}/${id} exists while ${STATE}/${id} is still in place; ` +
                    `an archive was interrupted between its two moves`,
            );
        }
    }
    return found;
}

/**
 * Reports drift, and writes nothing.
 *
 * Exits 1 on drift and 0 without, the same contract as `validate`, so CI and
 * the agent can branch on it.
 */
export async function reconcile(root: string): Promise<void> {
    const found = await drift(root);
    if (found.length > 0) {
        throw new ValidationError(
            [
                "Recorded state and the repository disagree:",
                ...found.map((f) => `  - ${f}`),
                "",
                "Repair what can be repaired with:  craftpath reconcile --fix",
            ].join("\n"),
        );
    }
    console.log("no drift  state matches the repository");
}
