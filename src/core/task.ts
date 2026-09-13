/**
 * Task subcommands.
 *
 * The derived logic all lives in `transitions.ts` and is tested there; this is
 * the I/O layer around it. If something here needs a change to a transition,
 * that is a signal to stop -- the logic was settled in M0.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CorruptStateError, PreconditionError } from "../transitions";
import { TaskId, type TaskState } from "../schema";
import { WORK, STATE, openWorkId, readTasks } from "./work";

export interface TaskAddOptions {
    title: string;
    skills?: string[];
    dependsOn?: string[];
}

/**
 * Frontmatter craftpath owns, plus the template's prose sections.
 *
 * Acceptance criteria are left as the template's placeholder on purpose: code
 * owns ids, status and dependencies; the model owns criterion text (§1).
 */
function taskFile(id: string, options: TaskAddOptions): string {
    const skills = options.skills ?? [];
    const dependsOn = options.dependsOn ?? [];
    return [
        "---",
        `id: ${id}`,
        `title: ${options.title}`,
        `depends_on: [${dependsOn.join(", ")}]`,
        `skills: [${skills.join(", ")}]`,
        "acceptance:",
        "  - id: A1",
        "    text: <observable outcome, mapped to a requirement scenario>",
        "    verified_by:",
        "      - cmd: <config.toml command key>",
        "        selector: <specific test — a green suite proves nothing about A1>",
        "---",
        "",
        "## Context",
        "<!-- guidance: 3 sentences max. What the implementer needs that is not",
        "     already in the code. -->",
        "",
        "## Notes",
        "<!-- guidance: appended during execution. Friction, surprises, dead ends. -->",
        "",
    ].join("\n");
}

export async function taskAdd(
    root: string,
    id: string,
    options: TaskAddOptions,
): Promise<void> {
    if (!TaskId.safeParse(id).success) {
        throw new PreconditionError(`${id} is not a task id; expected the form T004`);
    }

    const workId = await openWorkId(root);
    if (workId === null) {
        throw new PreconditionError(
            'No open work item. Start one with `craftpath work new "<title>"`.',
        );
    }

    const existing = await readTasks(root, workId);
    if (existing.has(id)) {
        throw new PreconditionError(
            `${id} already exists in ${workId}. Pick a different id.`,
        );
    }

    for (const dep of options.dependsOn ?? []) {
        if (!existing.has(dep)) {
            throw new PreconditionError(
                `${id} depends on ${dep}, which does not exist. ` +
                `Add ${dep} first, or drop the dependency.`,
            );
        }
    }

    // Prose first, state second -- same reasoning as workNew: a crash between
    // them leaves a file status ignores rather than state pointing at nothing.
    const suffix = options.skills?.[0] ?? "task";
    await mkdir(join(root, WORK, workId, "tasks"), { recursive: true });
    await Bun.write(
        join(root, WORK, workId, "tasks", `${id}-${suffix}.md`),
        taskFile(id, options),
    );

    const state: TaskState = {
        id,
        status: "pending",
        evidence: [],
        acks: [],
        git: { trailer: `Task: ${id}`, commits_hint: [] },
    };
    await mkdir(join(root, STATE, workId), { recursive: true });
    await Bun.write(
        join(root, STATE, workId, `${id}.json`),
        JSON.stringify(state, null, 2) + "\n",
    );

    console.log(`created   ${WORK}/${workId}/tasks/${id}-${suffix}.md`);
}
