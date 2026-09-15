/**
 * `craftpath archive` -- move a proven work item out of the way.
 *
 * Runs on the work branch as the PR's last commit, once review is done, so the
 * archive lands through the PR and nobody pushes to the default branch. Moves
 * only (D6): living specs are not touched, and nothing is committed -- the agent
 * commits the move.
 *
 * Irreversible in practice, so completion is proven first.
 */
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { proveComplete } from "./validate";
import { ARCHIVE, STATE, WORK } from "./work";

export async function archive(root: string): Promise<void> {
    const { work } = await proveComplete(root);
    const target = join(root, ARCHIVE, work.id);

    // The work directory first: it is what makes an item open. A crash between
    // the two renames leaves orphaned state that nothing reads, while the
    // archived directory already reserves the id -- rather than an open work
    // item whose state has vanished.
    await mkdir(join(root, ARCHIVE), { recursive: true });
    await rename(join(root, WORK, work.id), target);
    await rename(join(root, STATE, work.id), join(target, "state"));

    console.log(`archived  ${work.id} -> ${ARCHIVE}/${work.id}`);
}
