/**
 * Task subcommands.
 *
 * The derived logic all lives in `transitions.ts` and is tested there; this is
 * the I/O layer around it. If something here needs a change to a transition,
 * that is a signal to stop -- the logic was settled in M0.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
    PreconditionError,
    ack,
    start,
    unsatisfied,
    verify as verifyAllowed,
} from "../transitions";
import { TaskId, TaskState } from "../schema";
import { CONFIG_PATH, commandFor, isConfigured, loadConfig } from "./config";
import { STATE, WORK, openWorkId, readTasks } from "./work";

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

    await mkdir(join(root, STATE, workId), { recursive: true });
    await writeState(root, workId, {
        id,
        status: "pending",
        evidence: [],
        acks: [],
        git: { trailer: `Task: ${id}`, commits_hint: [] },
    });

    console.log(`created   ${WORK}/${workId}/tasks/${id}-${suffix}.md`);
}

/** sha256 of config.toml. Evidence recorded under a different hash is stale. */
export async function configHash(root: string): Promise<string> {
    const text = await Bun.file(join(root, CONFIG_PATH)).text();
    return "sha256:" + new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** The task as the CLI sees it: prose joined to trusted state. */
async function loadTask(root: string, id: string) {
    const workId = await openWorkId(root);
    if (workId === null) {
        throw new PreconditionError(
            'No open work item. Start one with `craftpath work new "<title>"`.',
        );
    }
    const tasks = await readTasks(root, workId);
    const task = tasks.get(id);
    if (!task) {
        throw new PreconditionError(`${id} does not exist in ${workId}.`);
    }
    return { workId, task, tasks };
}

async function writeState(
    root: string,
    workId: string,
    state: TaskState,
): Promise<void> {
    await Bun.write(
        join(root, STATE, workId, `${state.id}.json`),
        JSON.stringify(TaskState.parse(state), null, 2) + "\n",
    );
}

async function readState(
    root: string,
    workId: string,
    id: string,
): Promise<TaskState> {
    const file = Bun.file(join(root, STATE, workId, `${id}.json`));
    if (!(await file.exists())) {
        // A hand-written task file with no state reads as pending, not as
        // corruption -- `task add` writes both, but people write files too.
        return {
            id,
            status: "pending",
            evidence: [],
            acks: [],
            git: { trailer: `Task: ${id}`, commits_hint: [] },
        };
    }
    return TaskState.parse(await file.json());
}

/** Criterion ids not yet satisfied. Exported so tests assert the real rule. */
export async function unsatisfiedFor(root: string, id: string): Promise<string[]> {
    const { task } = await loadTask(root, id);
    return unsatisfied(task, await configHash(root));
}

export async function taskStart(root: string, id: string): Promise<void> {
    const { workId, task, tasks } = await loadTask(root, id);
    const status = start(task, tasks);
    const state = await readState(root, workId, id);
    await writeState(root, workId, { ...state, status });
    console.log(`started   ${id}`);
}

/**
 * Runs the commands the criteria name and records what happened.
 *
 * Grouped by (cmd, selector) -- exactly what `proves()` matches on -- so five
 * criteria sharing one command produce one run and one evidence record rather
 * than running the same suite five times to record the same fact.
 */
export async function taskVerify(root: string, id: string): Promise<void> {
    const { workId, task } = await loadTask(root, id);
    verifyAllowed(task);

    const config = await loadConfig(root);
    const hash = await configHash(root);

    const wanted = new Map<string, { cmd: string; selector?: string }>();
    for (const criterion of task.acceptance) {
        for (const { cmd, selector } of criterion.verified_by) {
            if (cmd === "manual") continue;
            wanted.set(`${cmd} ${selector ?? ""}`, { cmd, selector });
        }
    }

    // Resolve every command before running any of them. A criterion naming a
    // command the config does not define is a plan defect, and discovering it
    // after a ten minute suite has already run helps nobody.
    for (const { cmd, selector } of wanted.values()) {
        const spec = config.commands[cmd];
        if (!spec || !isConfigured(spec)) {
            throw new PreconditionError(
                `${id} names command "${cmd}", which ${CONFIG_PATH} does not ` +
                `define (or defines with an empty run).`,
            );
        }
        // Throws when a selector is named that this runner cannot express.
        commandFor(spec, selector);
    }

    const state = await readState(root, workId, id);
    const evidence = [...state.evidence];

    for (const { cmd, selector } of wanted.values()) {
        const line = commandFor(config.commands[cmd]!, selector);
        const result = await Bun.$`sh -c ${line}`.cwd(root).quiet().nothrow();

        // Log first: `validate` re-reads it against the recorded exit code
        // (M3), which only works if a log exists for every evidence entry.
        const log = join("logs", `${id}-${cmd}.log`);
        await mkdir(join(root, STATE, workId, "logs"), { recursive: true });
        await Bun.write(
            join(root, STATE, workId, log),
            [
                `$ ${line}`,
                "",
                result.stdout.toString(),
                result.stderr.toString(),
                `exit: ${result.exitCode}`,
                "",
            ].join("\n"),
        );

        evidence.push({
            cmd,
            selector: selector ?? null,
            exit: result.exitCode,
            log,
            config_hash: hash,
            at: new Date().toISOString(),
        });

        const verdict = result.exitCode === 0 ? "passed" : "FAILED";
        console.log(`${verdict}    ${cmd} (exit ${result.exitCode})`);
    }

    await writeState(root, workId, { ...state, evidence });

    const left = unsatisfied({ ...task, evidence }, hash);
    console.log(
        left.length === 0
            ? `${id} is fully verified`
            : `unsatisfied: ${left.join(", ")}`,
    );
}

export async function taskAck(
    root: string,
    id: string,
    criterionId: string,
): Promise<void> {
    const { workId, task } = await loadTask(root, id);
    ack(task, criterionId);

    const result = await Bun.$`git -C ${root} config user.email`.quiet().nothrow();
    const by = result.stdout.toString().trim();
    if (result.exitCode !== 0 || by.length === 0) {
        throw new PreconditionError(
            "git user.email is not set, so an acknowledgement cannot be signed.",
        );
    }

    const state = await readState(root, workId, id);
    await writeState(root, workId, {
        ...state,
        acks: [
            ...state.acks,
            {
                criterion_id: criterionId,
                by,
                at: new Date().toISOString(),
                config_hash: await configHash(root),
            },
        ],
    });
    console.log(`acked     ${id} ${criterionId} (${by})`);
}
