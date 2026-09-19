/**
 * `craftpath archive` -- move a proven work item out of the way.
 *
 * Runs on the work branch as the PR's last commit, once review is done, so the
 * archive lands through the PR and nobody pushes to the default branch. Moves
 * only: the agent edits the living specs and commits both.
 *
 * Irreversible in practice, so completion is proven first.
 */
import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { ValidationError, proveComplete } from "./validate";
import { ARCHIVE, STATE, WORK } from "./work";

/**
 * A stable requirement id: `AVATAR-R3`.
 *
 * Deliberately narrow. The delta is prose, and a loose pattern would drag
 * ordinary words into a check that refuses the archive.
 */
const REQUIREMENT_ID = /\b[A-Z][A-Z0-9]*-R\d+\b/g;

/** The ids named under one `## SECTION` heading of the spec delta. */
function idsUnder(delta: string, section: string): string[] {
    // `(?![\s\S])` rather than `\z`, which JS does not support: with the `m`
    // flag `$` is a line end, so the last section needs an explicit end-of-input.
    const body = new RegExp(`^## ${section}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(
        delta,
    );
    return body ? [...new Set(body[1]!.match(REQUIREMENT_ID) ?? [])] : [];
}

/** Everything under `.craftpath/specs/`, concatenated. */
async function livingSpecs(root: string): Promise<string> {
    const dir = join(root, ".craftpath/specs");
    let entries: string[];
    try {
        entries = await readdir(dir);
    } catch {
        return "";
    }
    const files = entries.filter((name) => name.endsWith(".md"));
    const texts = await Promise.all(files.map((f) => Bun.file(join(dir, f)).text()));
    return texts.join("\n");
}

/**
 * Whether the living specs actually reflect the delta this work item declares.
 *
 * `.craftpath/specs/` had no writer at all. The delta template claimed archive
 * applied it, archive's own comment said it did not, and phase 9 told the agent
 * to edit the specs by hand -- so the agent believed the template, skipped the
 * edit, and specs/ stayed empty forever while phase 2 told every later run to
 * read it first.
 *
 * The owner is the agent: merging a MODIFIED requirement into existing prose has
 * no safe automatic answer, and §1 gives prose to the model. What was missing
 * was a mechanism, so this is it -- archive refuses a delta the specs do not
 * reflect, which is exact, derives from files rather than assertion, and lands
 * at the one point where the edit is still cheap to make.
 */
async function specProblems(root: string, workId: string): Promise<string[]> {
    const delta = await Bun.file(join(root, WORK, workId, "spec-delta.md")).text();
    const specs = await livingSpecs(root);
    const problems: string[] = [];

    for (const section of ["ADDED", "MODIFIED"]) {
        for (const id of idsUnder(delta, section)) {
            if (!specs.includes(id)) {
                problems.push(
                    `spec-delta.md ${section} ${id}, but no file in .craftpath/specs/ ` +
                    `mentions it -- write the requirement into the living spec`,
                );
            }
        }
    }

    for (const id of idsUnder(delta, "REMOVED")) {
        if (specs.includes(id)) {
            problems.push(
                `spec-delta.md REMOVES ${id}, but .craftpath/specs/ still carries it ` +
                `-- delete the requirement from the living spec`,
            );
        }
    }

    return problems;
}

export async function archive(root: string): Promise<void> {
    const { work } = await proveComplete(root);

    const problems = await specProblems(root, work.id);
    if (problems.length > 0) {
        throw new ValidationError(
            [
                `${work.id} is proven, but the living specs do not reflect its delta:`,
                ...problems.map((p) => `  - ${p}`),
                "",
                "Edit .craftpath/specs/ in this same PR, then archive again.",
            ].join("\n"),
        );
    }

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
