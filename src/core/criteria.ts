/**
 * The fingerprint of what was approved.
 *
 * Acceptance criteria live in model space, in the task `.md` under
 * `.craftpath/work/` -- by design (§1): code owns ids and status, the model owns
 * criterion text. `amendments_seen` reopens the plan gate when a task is amended
 * or added, because both record an amendment. Editing an acceptance block in
 * place records nothing, so the gate went on reading `approved` and
 * `validate --complete` passed against criteria nobody had approved.
 *
 * This pins them: the hash is recorded with the approval, so "were these the
 * criteria that were approved?" is answerable from the record rather than from
 * trust.
 *
 * No Zod: `approve` and `validate` both load it anyway, and there is no schema
 * here to be a source of truth for.
 */
import type { Task } from "../transitions";

/**
 * Canonical form: ids, text and verification, sorted, and nothing else.
 *
 * Sorted at every level so a reordering -- which changes no criterion -- does
 * not read as a change. Status, evidence and acks are deliberately absent: they
 * are what gets PROVEN about the criteria, not part of what was approved, and
 * including them would make every verification reopen the gate.
 */
function canonical(tasks: Map<string, Task>): unknown {
    return [...tasks.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((task) => [
            task.id,
            [...task.acceptance]
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((criterion) => [
                    criterion.id,
                    criterion.text,
                    criterion.verified_by.map((v) => v.cmd).sort(),
                ]),
        ]);
}

export function criteriaHash(tasks: Map<string, Task>): string {
    return (
        "sha256:" +
        new Bun.CryptoHasher("sha256").update(JSON.stringify(canonical(tasks))).digest("hex")
    );
}
