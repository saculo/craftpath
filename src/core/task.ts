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
import { TaskId, TaskProse, TaskState, WorkState } from "../schema";
import { signer } from "./approve";
import { gateState } from "./gates";
import { CONFIG_PATH, commandFor, isConfigured, loadConfig } from "./config";
import { STATE, WORK, openWorkId, readOpenWork, readTasks } from "./work";

export interface TaskAddOptions {
    title: string;
    skills?: string[];
    dependsOn?: string[];
    /** `--design ux|architecture`: makes this a design task. Requires a D id. */
    design?: string;
    /** Why the design is needed. Reviewed at G2; the schema demands substance. */
    designReason?: string;
    /** Artifacts the task writes. Mandatory for a design task; dependents read them. */
    produces?: string[];
    /** Required once the plan is approved: the new task amends it. */
    reason?: string;
}

/**
 * A YAML scalar that survives the round trip.
 *
 * JSON is a subset of YAML 1.2, so quoting through `JSON.stringify` is both
 * valid YAML and total. Interpolating raw was a live corruption bug: a title
 * with a colon (`Reject TIFF: return 415`) is a YAML parse error, and one
 * starting with `#` becomes a comment and parses to null. Either way `task add`
 * wrote a file that every later read rejects, which exits 3 on `status`,
 * `validate` and every task subcommand -- with no CLI path back.
 */
const scalar = (value: string): string => JSON.stringify(value);
const list = (values: string[]): string => `[${values.map(scalar).join(", ")}]`;

/**
 * Frontmatter craftpath owns, plus the template's prose sections.
 *
 * Acceptance criteria are left as the template's placeholder on purpose: code
 * owns ids, status and dependencies; the model owns criterion text (§1). A
 * design task's placeholder is `manual` because the schema requires at least
 * one such criterion -- its output is proven by a person reading it.
 *
 * No `selector:` line: criteria generated here name a command and nothing
 * narrower, so the command runs whole. A criterion that wants to be pinned to
 * one test gets the selector written in by hand.
 */
function taskFile(id: string, options: TaskAddOptions, skills: string[]): string {
    const design = options.design
        ? [
              "design:",
              `  kind: ${scalar(options.design)}`,
              `  reason: ${scalar(options.designReason ?? "")}`,
          ]
        : [];

    const criterion = options.design
        ? [
              "    text: <what a reader must be able to decide from this document>",
              "    verified_by:",
              "      - cmd: manual",
          ]
        : [
              "    text: <observable outcome, mapped to a requirement scenario>",
              "    verified_by:",
              "      - cmd: <config.toml command key>",
          ];

    return [
        "---",
        `id: ${id}`,
        `title: ${scalar(options.title)}`,
        `depends_on: ${list(options.dependsOn ?? [])}`,
        `skills: ${list(skills)}`,
        ...design,
        `produces: ${list(options.produces ?? [])}`,
        "acceptance:",
        "  - id: A1",
        ...criterion,
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

/**
 * Renders the task file and proves it parses, before anything is written.
 *
 * `task add` used to check only the id and interpolate the rest raw, so
 * `--title "ab"` (under the schema minimum) or `--skills Backend` (wrong case)
 * produced a file that bricked the work item. Validating the RENDERED text --
 * rather than the options -- is what makes this airtight: it is the exact input
 * `readTasks` will parse, so anything that gets past here is readable by
 * definition.
 */
function renderTask(id: string, options: TaskAddOptions): string {
    // The schema requires a design task to bind the skill matching its kind.
    // There is exactly one right answer, so derive it rather than refuse.
    const declared = options.skills ?? [];
    const skills =
        options.design && !declared.includes(options.design)
            ? [...declared, options.design]
            : declared;

    const body = taskFile(id, options, skills);
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(body)![1]!;

    let raw: unknown;
    try {
        raw = Bun.YAML.parse(frontmatter);
    } catch (cause) {
        throw new PreconditionError(
            `${id} would not be valid YAML: ${(cause as Error).message}`,
        );
    }

    const parsed = TaskProse.safeParse(raw);
    if (!parsed.success) {
        throw new PreconditionError(
            `${id} would not be a valid task, so nothing was written:\n` +
            parsed.error.issues
                .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
                .join("\n"),
        );
    }
    return body;
}

export async function taskAdd(
    root: string,
    id: string,
    options: TaskAddOptions,
): Promise<void> {
    if (!TaskId.safeParse(id).success) {
        throw new PreconditionError(`${id} is not a task id; expected the form T004`);
    }

    // The schema makes a D id and a design block imply each other, but its
    // message talks about the file. Name the flags instead: a bare
    // `task add D001` is the one operation that could brick a work item.
    if (id.startsWith("D") && options.design === undefined) {
        throw new PreconditionError(
            `${id} is a design task id, so it needs a design block:\n` +
            `  craftpath task add ${id} --title "<imperative>" \\\n` +
            `    --design <ux|architecture> --design-reason "<why it is needed>" \\\n` +
            `    --produces <path>\n` +
            `For an implementation task, use a T id instead.`,
        );
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

    // Render and validate before ANY record is written. Signing an amendment
    // first would leave a signed change to the plan pointing at a task the next
    // line then refused to create.
    const body = renderTask(id, options);

    // After plan approval a new task changes the approved plan, so it is an
    // amendment: it needs a reason and reopens the plan and result gates.
    // Refusing outright would break review fixes, which add tasks late.
    const work = (await readOpenWork(root))!;
    const amending = gateState(work.approvals, "plan", work.amendments) === "approved";
    const reason = options.reason?.trim() ?? "";
    if (amending && reason.length === 0) {
        throw new PreconditionError(
            `The plan is approved, so adding ${id} amends it. ` +
            `Add it with --reason "<why>"; the plan and result gates will reopen.`,
        );
    }
    // Signed before anything is written: with no signer, no task appears
    // that bypassed the gate.
    if (amending) {
        await recordAmendment(root, workId, id, reason, "added after plan approval");
    }

    // Prose first, state second -- same reasoning as workNew: a crash between
    // them leaves a file status ignores rather than state pointing at nothing.
    const suffix = options.skills?.[0] ?? options.design ?? "task";
    await mkdir(join(root, WORK, workId, "tasks"), { recursive: true });
    await Bun.write(join(root, WORK, workId, "tasks", `${id}-${suffix}.md`), body);

    const [workTrailer, trailer] = anchorTrailers(workId, id);
    await mkdir(join(root, STATE, workId), { recursive: true });
    await writeState(root, workId, {
        id,
        status: "pending",
        evidence: [],
        acks: [],
        git: { trailer, work_trailer: workTrailer, commits_hint: [] },
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
        const [work, trailer] = anchorTrailers(workId, id);
        return {
            id,
            status: "pending",
            evidence: [],
            acks: [],
            git: { trailer, work_trailer: work, commits_hint: [] },
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
 * A command key as a filename component.
 *
 * Command keys are arbitrary TOML keys -- `test:unit` and `a/b` are both legal
 * -- and this one lands in a path.
 */
const safe = (value: string): string => value.replace(/[^\w.-]+/g, "_");

/** A template placeholder the model never replaced: the whole value is `<...>`. */
const PLACEHOLDER = /^<.*>$/;

/**
 * Refuses a criterion still holding the task template's placeholder.
 *
 * Not pedantry about unfilled forms. A placeholder selector is a selector that
 * matches no test, and runners disagree about what that means: `bun test -t`
 * exits 1, but `go test -run` exits 0 with "no tests to run" -- which records
 * green evidence for a run that tested nothing, which is precisely the kind of
 * real-evidence-fake-confidence this harness exists to prevent.
 *
 * Checked before the config lookup, because "you did not fill this in" is a
 * more specific answer than "that command is not defined".
 */
function refusePlaceholders(id: string, task: Task): void {
    for (const criterion of task.acceptance) {
        for (const { cmd, selector } of criterion.verified_by) {
            const left = [cmd, selector].filter(
                (value): value is string => value !== undefined && PLACEHOLDER.test(value),
            );
            if (left.length > 0) {
                throw new PreconditionError(
                    `${id} ${criterion.id} still carries the task template's ` +
                    `placeholder: ${left.join(", ")}. Replace it with the ` +
                    `${CONFIG_PATH} command key and the test that proves this ` +
                    `criterion -- a criterion nothing can run proves nothing.`,
                );
            }
        }
    }
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
    refusePlaceholders(id, task);

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
        commandFor(spec, selector, cmd);
    }

    const state = await readState(root, workId, id);
    const evidence = [...state.evidence];
    const failed: string[] = [];

    for (const { cmd, selector } of wanted.values()) {
        const line = commandFor(config.commands[cmd]!, selector, cmd);
        const result = await Bun.$`sh -c ${line}`.cwd(root).quiet().nothrow();
        const at = new Date().toISOString();

        // One log per evidence record, never overwritten: a red run followed by a
        // green one must keep both, or the red record points at the green log.
        //
        // Named by the run's own timestamp rather than a counter over the
        // evidence array, because `amend` resets that array to []: the counter
        // restarted at 1 and clobbered the pre-amendment log -- the exact loss
        // this comment guards against, one path further out, and a rewrite of
        // history in git, since logs are committed. The index keeps two runs of
        // one command inside a single verify apart when they land in the same
        // millisecond.
        //
        // Log first: `validate` re-reads it against the recorded exit code
        // (M3), which only works if a log exists for every evidence entry.
        const stamp = at.replace(/[-:.]/g, "");
        const log = join("logs", `${id}-${safe(cmd)}-${stamp}-${evidence.length + 1}.log`);
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
            at,
        });

        const verdict = result.exitCode === 0 ? "passed" : "FAILED";
        console.log(`${verdict}    ${cmd} (exit ${result.exitCode})`);
        if (result.exitCode !== 0) {
            failed.push(selector === undefined ? cmd : `${cmd} [${selector}]`);
        }
    }

    // Recorded BEFORE the refusal below: the red run is the record, and the
    // comment above is only true if a failing run survives the failure.
    await writeState(root, workId, { ...state, evidence });

    const left = unsatisfied({ ...task, evidence }, hash);
    console.log(
        left.length === 0
            ? `${id} is fully verified`
            : `unsatisfied: ${left.join(", ")}`,
    );

    // Exit codes are the contract hooks and CI branch on, so printing FAILED
    // and exiting 0 made `craftpath task verify <id> && git commit` proceed on
    // red. `task done` caught it, one step later than it should have.
    //
    // The condition is a FAILING RUN, not an unsatisfied criterion: a manual
    // criterion is `task ack`'s business, and refusing here for one would make
    // the ordinary verify -> ack -> done sequence refuse in the middle of
    // itself. Every command-verified criterion is satisfied exactly when its
    // run passes, so nothing else is lost by the narrower rule.
    if (failed.length > 0) {
        throw new PreconditionError(
            `${id} is not verified: ${failed.join(", ")} failed. ` +
            `Unsatisfied criteria: ${left.join(", ")}. The evidence is recorded, ` +
            `failing run included -- fix what it reports, then run ` +
            `\`craftpath task verify ${id}\` again.`,
        );
    }
}

/** The trailer pair that anchors a task's commit to its work item. */
export function anchorTrailers(workId: string, id: string): [string, string] {
    return [`Work: ${workId}`, `Task: ${id}`];
}

/**
 * Whether ONE commit carrying both `Work: <workId>` and `Task: <id>` is
 * reachable from HEAD.
 *
 * Both halves are load-bearing. Task ids restart at T001 in every work item and
 * `git log` walks all of HEAD's history, so `Task: T001` alone is satisfied by
 * the first work item a repo ever completed -- from item 0002 onward the check
 * passed with no commit for the task at all, which is half of M1's exit
 * criterion holding only once per repository.
 *
 * `--all-match` is what makes it a pair: git ORs multiple `--grep` patterns by
 * default, so without it the two patterns are *weaker* than the single one they
 * replaced.
 */
export async function trailerInBranch(
    root: string,
    workId: string,
    id: string,
): Promise<boolean> {
    // --fixed-strings: the patterns are data, and a regex match here would be a
    // different question than "does this trailer appear".
    const [work, task] = anchorTrailers(workId, id);
    const found =
        await Bun.$`git -C ${root} log --fixed-strings --all-match --grep=${work} --grep=${task} --format=%H`
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
 * The trailer PAIR is the anchor rather than a commit SHA because it survives
 * squash, rebase and amend (D11). Recording a SHA would mean a rebase silently
 * detaches completed work from the commit that proves it. Both trailers are
 * required: task ids restart per work item, so `Task: T001` alone is satisfied
 * by any earlier work item's first task.
 */
export async function taskDone(root: string, id: string): Promise<void> {
    const { workId, task } = await loadTask(root, id);
    const [work, trailer] = anchorTrailers(workId, id);

    const status = done(
        task,
        await configHash(root),
        await trailerInBranch(root, workId, id),
        `both \`${work}\` and \`${trailer}\``,
    );

    const state = await readState(root, workId, id);
    await writeState(root, workId, {
        ...state,
        status,
        git: { ...state.git, trailer, work_trailer: work },
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
