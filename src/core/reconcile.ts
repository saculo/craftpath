/**
 * `craftpath reconcile` -- drift between recorded state and the repository.
 *
 * Both guards refuse hand-edits of `.craftpath/state/` and point here for the
 * case where the state is genuinely wrong (§6.3). A trusted kernel with no
 * supported repair gets bypassed the first time `validate` reports something
 * nobody can fix, so this is the supported way to be wrong.
 *
 * Reporting and repairing are the same command with a flag, but never the same
 * act: plain `reconcile` writes nothing at all, because repair is a decision.
 */
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { TaskState } from "../schema";
import { anchorTrailers, trailerCommits, trailerInBranch } from "./task";
import { ValidationError } from "./validate";
import { ARCHIVE, STATE, WORK, sortedEntries } from "./work";

/**
 * One kind of drift, carrying what a repair would need.
 *
 * Typed rather than a string so `--fix` acts on the same list the report
 * prints, instead of re-deriving it and risking a different answer.
 */
export type Finding =
    | { kind: "scaffold"; workId: string; text: string }
    | { kind: "trailer"; workId: string; taskId: string; text: string }
    | { kind: "archive"; workId: string; text: string };

/** Every kind of drift found, in a stable order. */
export async function drift(root: string): Promise<Finding[]> {
    return [
        ...(await scaffoldDrift(root)),
        ...(await trailerDrift(root)),
        ...(await archiveDrift(root)),
    ];
}

/** A work directory whose state never arrived: `work new` interrupted. */
async function scaffoldDrift(root: string): Promise<Finding[]> {
    const found: Finding[] = [];
    for (const id of await sortedEntries(join(root, WORK))) {
        if (!(await Bun.file(join(root, STATE, id, "work.json")).exists())) {
            found.push({
                kind: "scaffold",
                workId: id,
                text:
                    `${WORK}/${id} exists but ${STATE}/${id}/work.json does not; ` +
                    `nothing records what it meant`,
            });
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
async function trailerDrift(root: string): Promise<Finding[]> {
    const found: Finding[] = [];
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
            found.push({
                kind: "trailer",
                workId,
                taskId: id,
                text:
                    `${id} is done but no commit carrying both \`${workTrailer}\` and ` +
                    `\`${taskTrailer}\` is on the branch`,
            });
        }
    }
    return found;
}

/** An archive that moved the work directory but not the state directory. */
async function archiveDrift(root: string): Promise<Finding[]> {
    const found: Finding[] = [];
    for (const id of await sortedEntries(join(root, ARCHIVE))) {
        if (await Bun.file(join(root, STATE, id, "work.json")).exists()) {
            found.push({
                kind: "archive",
                workId: id,
                text:
                    `${ARCHIVE}/${id} exists while ${STATE}/${id} is still in place; ` +
                    `an archive was interrupted between its two moves`,
            });
        }
    }
    return found;
}

/**
 * Reopens a task whose trailer vanished, keeping what it proved.
 *
 * R2: the evidence was about code that still exists; only the link to the
 * branch is gone. Recommitting with the trailer and running `task done`
 * completes it again.
 *
 * R3: this is not an amendment. The plan did not change, so `work.json` is
 * untouched and the plan and result gates stay where they are -- the repair is
 * recorded in changelog.md, where prose belongs.
 */
async function reopen(root: string, workId: string, taskId: string, text: string): Promise<void> {
    const path = join(root, STATE, workId, `${taskId}.json`);
    const state = TaskState.parse(await Bun.file(path).json());
    await Bun.write(
        path,
        JSON.stringify(TaskState.parse({ ...state, status: "in_progress" }), null, 2) + "\n",
    );

    const changelog = join(root, WORK, workId, "changelog.md");
    const file = Bun.file(changelog);
    const before = (await file.exists()) ? await file.text() : "";
    const at = new Date().toISOString().slice(0, 10);
    await Bun.write(
        changelog,
        before +
            [
                "",
                `## ${at} — ${taskId}: reopened by reconcile --fix`,
                "",
                `**Why:** ${text}`,
                "**Effect:** evidence and acks kept; recommit with the trailer, then `craftpath task done`.",
                "",
            ].join("\n"),
    );
}

/**
 * Rewrites `commits_hint` for every done task whose anchor still reaches HEAD.
 *
 * R4: a stale hint is not drift, so this is housekeeping `--fix` does rather
 * than something the report has an opinion about. A task whose trailer is gone
 * is skipped -- that is drift, and `reopen` has already dealt with it.
 */
async function refreshHints(root: string): Promise<string[]> {
    const refreshed: string[] = [];
    for (const workId of await sortedEntries(join(root, STATE))) {
        const dir = join(root, STATE, workId);
        const files = (await sortedEntries(dir)).filter(
            (name) => name.endsWith(".json") && name !== "work.json",
        );
        for (const file of files) {
            const path = join(dir, file);
            const parsed = TaskState.safeParse(await Bun.file(path).json());
            if (!parsed.success || parsed.data.status !== "done") continue;

            const state = parsed.data;
            const commits = await trailerCommits(root, workId, state.id);
            if (commits.length === 0) continue;
            if (commits.join() === state.git.commits_hint.join()) continue;

            await Bun.write(
                path,
                JSON.stringify(
                    TaskState.parse({ ...state, git: { ...state.git, commits_hint: commits } }),
                    null,
                    2,
                ) + "\n",
            );
            refreshed.push(state.id);
        }
    }
    return refreshed;
}

/** Finishes the rename an interrupted archive left half done. */
async function finishArchive(root: string, workId: string): Promise<void> {
    await rename(join(root, STATE, workId), join(root, ARCHIVE, workId, "state"));
}

export interface ReconcileOptions {
    /** Repair what can be repaired. Without it, nothing is written. */
    fix?: boolean;
}

/**
 * Reports drift, and repairs it only when asked.
 *
 * Exits 1 on drift that remains and 0 when nothing is left, the same contract
 * as `validate`, so CI and the agent can branch on it.
 */
export async function reconcile(root: string, options: ReconcileOptions = {}): Promise<void> {
    const found = await drift(root);

    if (!options.fix) {
        if (found.length === 0) {
            console.log("no drift  state matches the repository");
            return;
        }
        throw new ValidationError(
            [
                "Recorded state and the repository disagree:",
                ...found.map((f) => `  - ${f.text}`),
                "",
                "Repair what can be repaired with:  craftpath reconcile --fix",
            ].join("\n"),
        );
    }

    const stuck: Finding[] = [];
    for (const finding of found) {
        switch (finding.kind) {
            case "trailer":
                await reopen(root, finding.workId, finding.taskId, finding.text);
                console.log(`reopened  ${finding.taskId} (trailer not on the branch)`);
                break;
            case "archive":
                await finishArchive(root, finding.workId);
                console.log(`archived  ${finding.workId} (finished an interrupted archive)`);
                break;
            // A work directory with no state is the one kind nothing can
            // repair: nothing records what it meant, and inventing a work.json
            // would be fabricating the thing the guards exist to protect.
            case "scaffold":
                stuck.push(finding);
                break;
        }
    }

    const refreshed = await refreshHints(root);
    for (const id of refreshed) console.log(`hints     ${id} (commits refreshed)`);

    if (stuck.length > 0) {
        throw new ValidationError(
            [
                "Repaired what could be repaired. These need a decision:",
                ...stuck.map((f) => `  - ${f.text}`),
                "",
                `Remove the directory by hand once you know it is not wanted.`,
            ].join("\n"),
        );
    }
    const touched = found.length + refreshed.length;
    console.log(touched === 0 ? "no drift  nothing to repair" : "fixed     state reconciled");
}
