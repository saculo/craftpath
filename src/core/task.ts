/**
 * Task subcommands.
 *
 * The derived logic all lives in `transitions.ts` and is tested there; this is
 * the I/O layer around it. If something here needs a change to a transition,
 * that is a signal to stop -- the logic was settled in M0.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Task } from "../transitions";
import {
    PreconditionError,
    ack,
    amend as reopen,
    done,
    start,
    unsatisfied,
    verify as verifyAllowed,
} from "../transitions";
import { TaskId, TaskState, WorkState } from "../schema";
import { signer } from "./approve";
import { CONFIG_PATH, commandFor, isConfigured, loadConfig } from "./config";
import { STATE, WORK, openWorkId, readOpenWork, readTasks } from "./work";

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

/** A declared artifact of a done dependency, preloaded for the executing task. */
export interface TaskInput {
    path: string;
    content: string;
}

/**
 * The artifacts a task inherits from its dependencies.
 *
 * Without this the design block is decorative: D001 writes a UX spec, T001
 * launches in a fresh subagent, and that subagent sees the task file and its
 * `skills:` -- not the design it exists to implement.
 *
 * Three rules, each load-bearing:
 *
 * - **Only from `done` dependencies.** A half-finished design is worse input
 *   than none. `isBlocked` already prevents starting before they are done, so
 *   this falls out -- but it is asserted here, because a future parallel mode
 *   could change that and this must not silently start reading drafts.
 * - **Declared paths only.** Never glob the work directory. The contract is what
 *   the plan said at G2, so an artifact nobody declared does not become context.
 * - **A missing declared file is a hard failure.** If D001 claims an artboard
 *   and it is absent, the dependent must refuse to start rather than implement
 *   against a spec that is not there.
 *
 * One hop only. If T002 depends on T001 which depends on D001, T002 does not
 * inherit D001's artifacts -- it declares the dependency itself if it needs
 * them. Deep inheritance is how a subagent ends up holding the whole work item.
 */
export async function resolveInputs(
    root: string,
    task: Task,
    tasks: Map<string, Task>,
): Promise<TaskInput[]> {
    const inputs: TaskInput[] = [];

    for (const id of task.depends_on) {
        const dep = tasks.get(id);
        if (!dep || dep.status !== "done") continue;

        for (const path of dep.produces) {
            const file = Bun.file(join(root, path));
            if (!(await file.exists())) {
                throw new PreconditionError(
                    `${id} declares it produces ${path}, which does not exist. ` +
                    `${task.id} cannot be built against a design that is not there.`,
                );
            }
            inputs.push({ path, content: await file.text() });
        }
    }
    return inputs;
}

export async function taskStart(root: string, id: string): Promise<void> {
    const { workId, task, tasks } = await loadTask(root, id);
    const status = start(task, tasks);

    // Before the status is written: a task whose declared inputs are missing
    // must stay pending rather than start against a design that is not there.
    const inputs = await resolveInputs(root, task, tasks);

    const state = await readState(root, workId, id);
    await writeState(root, workId, { ...state, status });
    console.log(`started   ${id}`);
    for (const { path } of inputs) console.log(`input     ${path}`);
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

        // One log per evidence record, never overwritten: a red run followed by a
        // green one must keep both, or the red record points at the green log.
        //
        // Log first: `validate` re-reads it against the recorded exit code
        // (M3), which only works if a log exists for every evidence entry.
        const log = join("logs", `${id}-${cmd}-${evidence.length + 1}.log`);
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

/** Whether a commit carrying `Task: <id>` is reachable from HEAD. */
export async function trailerInBranch(root: string, id: string): Promise<boolean> {
    // --fixed-strings: the pattern is data, and a regex match here would be a
    // different question than "does this trailer appear".
    const found = await Bun.$`git -C ${root} log --fixed-strings --grep=${`Task: ${id}`} --format=%H`
        .quiet()
        .nothrow();
    return found.exitCode === 0 && found.stdout.toString().trim().length > 0;
}

/**
 * Completes a task, or refuses with the reason.
 *
 * `done()` enforces both halves of M1's exit criterion -- every criterion
 * satisfied by non-stale evidence or a signed ack, and a commit carrying the
 * task trailer on the branch. This function's only real job is supplying
 * `inBranch` honestly.
 *
 * The trailer is the anchor rather than a commit SHA because it survives
 * squash, rebase and amend (D11). Recording a SHA would mean a rebase silently
 * detaches completed work from the commit that proves it.
 */
export async function taskDone(root: string, id: string): Promise<void> {
    const { workId, task } = await loadTask(root, id);

    const status = done(task, await configHash(root), await trailerInBranch(root, id));

    const state = await readState(root, workId, id);
    await writeState(root, workId, {
        ...state,
        status,
        git: { ...state.git, trailer: `Task: ${id}` },
    });
    console.log(`done      ${id}`);
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

/**
 * Records a signed amendment in work.json and appends it to changelog.md.
 *
 * Kernel record first: it is the one gate state is derived from, so a crash
 * before the changelog line loses prose, not the reopened gates.
 */
export async function recordAmendment(
    root: string,
    workId: string,
    taskId: string,
    reason: string,
    effect: string,
): Promise<void> {
    const work = (await readOpenWork(root))!;
    const by = await signer(root);
    const at = new Date().toISOString();

    await Bun.write(
        join(root, STATE, workId, "work.json"),
        JSON.stringify(
            WorkState.parse({
                ...work,
                amendments: [...work.amendments, { task: taskId, reason, by, at }],
            }),
            null,
            2,
        ) + "\n",
    );

    const path = join(root, WORK, workId, "changelog.md");
    const file = Bun.file(path);
    const before = (await file.exists()) ? await file.text() : "";
    await Bun.write(
        path,
        before +
            [
                "",
                `## ${at.slice(0, 10)} — ${taskId}: ${reason}`,
                "",
                `**Affected tasks:** ${taskId} — ${effect}`,
                `**By:** ${by}`,
                "",
            ].join("\n"),
    );
}

/**
 * `craftpath amend <id> --reason` -- the supported way to change approved work.
 *
 * Without it the agent edits the approved plan quietly and the gate may as well
 * not exist. What was proven was proven about the old criteria, so evidence and
 * acks go; the plan and result gates reopen (gates.ts).
 */
export async function taskAmend(root: string, id: string, reason: string): Promise<void> {
    if (reason.trim().length === 0) {
        throw new PreconditionError(
            `An amendment needs a reason: craftpath amend ${id} --reason "<why>"`,
        );
    }
    const { workId, task } = await loadTask(root, id);
    const status = reopen(task);

    // Signed record before task state: with no signer nothing changes at all.
    await recordAmendment(
        root,
        workId,
        id,
        reason.trim(),
        "returned to pending, evidence and acks cleared",
    );

    const state = await readState(root, workId, id);
    await writeState(root, workId, { ...state, status, evidence: [], acks: [] });
    console.log(`amended   ${id} -> pending; plan and result gates reopened`);
}
