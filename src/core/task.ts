/**
 * Task subcommands.
 *
 * The derived logic all lives in `transitions.ts` and is tested there; this is
 * the I/O layer around it. If something here needs a change to a transition,
 * that is a signal to stop -- the logic was settled in M0.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fingerprint, Task } from "../transitions";
import {
    PreconditionError,
    ack,
    amend as reopen,
    done,
    start,
    unsatisfied,
    verify as verifyAllowed,
} from "../transitions";
import { type Config, TaskId, TaskProse, TaskState, WorkState } from "../schema";
import { signer } from "./approve";
import { gateState } from "./gates";
import { CONFIG_PATH, loadConfig } from "./config";
import { affectedModules, changedFiles } from "./modules";
import { withoutStamp } from "./stamp";
import { STATE, WORK, openWorkId, readOpenWork, readTasks, readWork } from "./work";

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
    /** Explicit work selection when more than one work item is open. */
    work?: string;
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
 * A criterion names a command and nothing narrower: the command runs whole and
 * its exit code is the evidence.
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
              "      - cmd: test",
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
        throw new PreconditionError(`${id} would not be valid YAML: ${(cause as Error).message}`);
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

export async function taskAdd(root: string, id: string, options: TaskAddOptions): Promise<void> {
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

    const workId = await openWorkId(root, options.work);
    if (workId === null) {
        throw new PreconditionError(
            'No open work item. Start one with `craftpath work new "<title>"`.',
        );
    }

    const existing = await readTasks(root, workId);
    if (existing.has(id)) {
        throw new PreconditionError(`${id} already exists in ${workId}. Pick a different id.`);
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
    const work = (await readOpenWork(root, options.work))!;
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
        attempts: [],
        acks: [],
        git: { trailer, work_trailer: workTrailer, commits_hint: [] },
    });

    console.log(`created   ${WORK}/${workId}/tasks/${id}-${suffix}.md`);
}

/** sha256 of config.toml. Evidence recorded under a different hash is stale. */
export async function configHash(root: string): Promise<string> {
    // Without the stamp, so an update that moves it stales nothing (V2).
    const text = withoutStamp(await Bun.file(join(root, CONFIG_PATH)).text());
    return "sha256:" + new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/**
 * The source as it is now: a git tree of the working tree, `.craftpath/` left out.
 *
 * Content, not a commit. The documented flow verifies, then commits, then
 * completes, and a fingerprint keyed on HEAD would stale valid evidence at the
 * commit. A tree built from the working tree is the same before and after
 * committing that content, respects .gitignore, and is git's own hash of it.
 *
 * Built in a throwaway index seeded from the real one, so the real index is
 * never touched and unchanged files are not rehashed. `.craftpath/` is dropped
 * from it: evidence, logs and state are craftpath's own writes, not the code
 * under test, and including them would stale every proof the moment it is
 * recorded.
 */
export async function sourceTree(root: string): Promise<string | null> {
    const inside = await Bun.$`git -C ${root} rev-parse --is-inside-work-tree`.quiet().nothrow();
    if (inside.exitCode !== 0) return null;

    const dir = await mkdtemp(join(tmpdir(), "craftpath-index-"));
    const index = join(dir, "index");
    try {
        const real = (await Bun.$`git -C ${root} rev-parse --git-path index`.quiet().nothrow())
            .text()
            .trim();
        const seed = Bun.file(real.startsWith("/") ? real : join(root, real));
        if (real !== "" && (await seed.exists())) await Bun.write(index, seed);

        const env = { ...process.env, GIT_INDEX_FILE: index };
        const add = await Bun.$`git -C ${root} add -A`.env(env).quiet().nothrow();
        if (add.exitCode !== 0) {
            throw new PreconditionError(
                `Cannot fingerprint the source for evidence: ${add.stderr.toString().trim()}`,
            );
        }
        await Bun.$`git -C ${root} rm -r -q --cached --ignore-unmatch .craftpath`
            .env(env)
            .quiet()
            .nothrow();
        return (await Bun.$`git -C ${root} write-tree`.env(env).quiet().text()).trim();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/** What evidence must agree with now: config and source. */
export async function fingerprint(root: string): Promise<Fingerprint> {
    return { config: await configHash(root), tree: await sourceTree(root) };
}

/** The task as the CLI sees it: prose joined to trusted state. */
async function loadTask(root: string, id: string, work?: string) {
    const workId = await openWorkId(root, work);
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

async function writeState(root: string, workId: string, state: TaskState): Promise<void> {
    await Bun.write(
        join(root, STATE, workId, `${state.id}.json`),
        JSON.stringify(TaskState.parse(state), null, 2) + "\n",
    );
}

async function readState(root: string, workId: string, id: string): Promise<TaskState> {
    const file = Bun.file(join(root, STATE, workId, `${id}.json`));
    if (!(await file.exists())) {
        // A hand-written task file with no state reads as pending, not as
        // corruption -- `task add` writes both, but people write files too.
        const [work, trailer] = anchorTrailers(workId, id);
        return {
            id,
            status: "pending",
            evidence: [],
            attempts: [],
            acks: [],
            git: { trailer, work_trailer: work, commits_hint: [] },
        };
    }
    return TaskState.parse(await file.json());
}

/** Criterion ids not yet satisfied. Exported so tests assert the real rule. */
export async function unsatisfiedFor(root: string, id: string): Promise<string[]> {
    const { task } = await loadTask(root, id);
    return unsatisfied(task, await fingerprint(root));
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
        // A missing dependency and an unfinished one mean the same thing here:
        // nothing to resolve from it. Dangling ids are validate's job to report.
        if (dep?.status !== "done") continue;

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

/**
 * Implementation runs against an approved plan, or not at all.
 *
 * Enforced here rather than in the workflow's prose, which is the only place
 * it used to live: an agent that skipped the sentence could start, verify and
 * complete every task with G2 pending. Checked at `done` as well as `start`,
 * so a task started before this check existed does not complete around it.
 */
async function requireApprovedPlan(root: string, workId: string, id: string, verb: string) {
    const work = await readWork(root, workId);
    if (gateState(work.approvals, "plan", work.amendments) === "approved") return;
    throw new PreconditionError(
        `${id} cannot ${verb}: the plan gate of ${workId} is pending` +
            (work.amendments.length > 0 ? " (an amendment reopened it)" : "") +
            ". Implementation waits for an approved plan -- " +
            `\`craftpath approve plan --work ${workId}\`.`,
    );
}

export async function taskStart(root: string, id: string, work?: string): Promise<void> {
    const { workId, task, tasks } = await loadTask(root, id, work);
    await requireApprovedPlan(root, workId, id, "start");
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
 * Refuses a criterion still holding the task template's placeholder text.
 *
 * The template's \`cmd: test\` is a real command, so an untouched criterion
 * would otherwise run the suite and record green evidence for a sentence
 * nobody wrote -- proof of nothing, filed as proof.
 */
function refusePlaceholders(id: string, task: Task): void {
    for (const criterion of task.acceptance) {
        if (PLACEHOLDER.test(criterion.text.trim())) {
            throw new PreconditionError(
                `${id} ${criterion.id} still carries the task template's placeholder: ` +
                    `${criterion.text.trim()}. Replace it with the observable outcome this ` +
                    "criterion proves -- a criterion nobody wrote proves nothing.",
            );
        }
    }
}

/** One command line to run per module, from the module's directory. */
type Run = { module: string; dir: string; line: string }[];

/**
 * The modules this task's change affects, refusing when there are none.
 *
 * Craftpath's own files are left out: a root module owns every path, and a
 * work item note is not a change to the code it describes.
 */
async function affected(
    root: string,
    id: string,
    config: Config,
    wanted: Set<string>,
): Promise<string[]> {
    if (wanted.size === 0) return [];
    if (Object.keys(config.modules).length === 0) {
        throw new PreconditionError(
            `${id}: ${CONFIG_PATH} declares no modules, so there is nowhere to run its ` +
                'criteria. Add a [modules.app] table with path = "./" and its test command.',
        );
    }
    const changed = (await changedFiles(root, config.git.base_branch)).filter(
        (file) => !file.startsWith(".craftpath/"),
    );
    const modules = affectedModules(config.modules, changed);
    if (modules.length === 0) {
        throw new PreconditionError(
            `${id}: no module is affected -- none of the files changed since ` +
                `${config.git.base_branch} is under a module's path in ${CONFIG_PATH}, so ` +
                "there is nothing to run its criteria in. A criterion that runs no tests " +
                "proves nothing.",
        );
    }
    return modules;
}

/** `cmd` in each affected module, refusing if any of them does not declare it. */
function moduleRuns(root: string, config: Config, modules: string[], cmd: string): Run {
    return modules.map((name) => {
        const module = config.modules[name]!;
        const line = cmd === "test" || cmd === "build" ? module[cmd] : undefined;
        if (line === undefined || line.trim() === "") {
            throw new PreconditionError(
                `Module "${name}" is affected by this change but does not declare "${cmd}" in ` +
                    `${CONFIG_PATH}. Nothing was run: proving it everywhere else would make ` +
                    `"${cmd} passed" mean "passed where it happened to be configured".`,
            );
        }
        return { module: name, dir: join(root, module.path), line };
    });
}

/**
 * Runs every step, even after one fails, so the log shows each module's
 * result. Across modules the log has a section per module with its own exit
 * line; the caller appends the overall exit last, which is the line validate
 * reads (M3). The overall exit is the first non-zero one.
 */
async function runSteps(steps: Run): Promise<{ exitCode: number; log: string }> {
    let exitCode = 0;
    let log = "";
    for (const step of steps) {
        const result = await Bun.$`sh -c ${step.line}`.cwd(step.dir).quiet().nothrow();
        log += `## ${step.module}\n`;
        log += [`$ ${step.line}`, "", result.stdout.toString(), result.stderr.toString(), ""].join(
            "\n",
        );
        log += `exit: ${result.exitCode}\n\n`;
        if (exitCode === 0) exitCode = result.exitCode;
    }
    return { exitCode, log };
}

/**
 * The runs a task's criteria need, resolved before any of them executes.
 *
 * A criterion naming a command the config does not define is a plan defect,
 * and discovering it after a ten minute suite has already run helps nobody.
 * Grouped by command -- exactly what `proves()` matches on -- so five
 * criteria sharing one command produce one run.
 */
async function planRuns(
    root: string,
    id: string,
    task: Task,
    config: Config,
): Promise<{ runs: Map<string, Run>; modules: string[] }> {
    verifyAllowed(task);
    refusePlaceholders(id, task);

    const wanted = new Set<string>();
    for (const criterion of task.acceptance) {
        for (const { cmd } of criterion.verified_by) {
            if (cmd !== "manual") wanted.add(cmd);
        }
    }

    const runs = new Map<string, Run>();
    const modules = await affected(root, id, config, wanted);
    for (const cmd of wanted) runs.set(cmd, moduleRuns(root, config, modules, cmd));
    return { runs, modules };
}

/**
 * Runs one command and writes its log, never overwriting an earlier one.
 *
 * A red run followed by a green one must keep both, or the red record points
 * at the green log. Named by the run's own timestamp rather than a counter
 * over the evidence array, because `amend` resets that array to []: a counter
 * restarted at 1 and clobbered the pre-amendment log -- a rewrite of history
 * in git, since logs are committed. `label` and `seq` keep two runs inside one
 * verify apart when they land in the same millisecond.
 *
 * Log first: `validate` re-reads it against the recorded exit code (M3), which
 * only works if a log exists for every evidence entry.
 */
async function execute(
    root: string,
    workId: string,
    label: string,
    cmd: string,
    steps: Run,
    seq: number,
): Promise<{ exit: number; log: string; at: string }> {
    const result = await runSteps(steps);
    const at = new Date().toISOString();
    const stamp = at.replace(/[-:.]/g, "");
    const log = join("logs", `${label}-${safe(cmd)}-${stamp}-${seq}.log`);
    await mkdir(join(root, STATE, workId, "logs"), { recursive: true });
    await Bun.write(join(root, STATE, workId, log), `${result.log}exit: ${result.exitCode}\n`);
    return { exit: result.exitCode, log, at };
}

/**
 * Runs the commands the criteria name and records what happened.
 *
 * Each record carries the source fingerprint taken BEFORE the run: that is
 * the code the command was handed. A suite that writes untracked files outside
 * .gitignore moves the tree and stales its own proof -- which is a real
 * difference between what was tested and what is there.
 */
export async function taskVerify(root: string, id: string, work?: string): Promise<void> {
    const { workId, task } = await loadTask(root, id, work);
    const config = await loadConfig(root);
    const { runs, modules } = await planRuns(root, id, task, config);
    const current = await fingerprint(root);

    const state = await readState(root, workId, id);
    const evidence = [...state.evidence];
    const failed: string[] = [];

    for (const [cmd, steps] of runs) {
        const run = await execute(root, workId, id, cmd, steps, evidence.length + 1);
        evidence.push({
            cmd,
            exit: run.exit,
            log: run.log,
            config_hash: current.config,
            tree: current.tree ?? undefined,
            at: run.at,
            modules,
        });

        const verdict = run.exit === 0 ? "passed" : "FAILED";
        console.log(`${verdict}    ${cmd} (exit ${run.exit})`);
        if (run.exit !== 0) failed.push(cmd);
    }

    // Recorded BEFORE the refusal below: the red run is the record, and the
    // comment above is only true if a failing run survives the failure.
    await writeState(root, workId, { ...state, evidence });

    const left = unsatisfied({ ...task, evidence }, current);
    console.log(left.length === 0 ? `${id} is fully verified` : `unsatisfied: ${left.join(", ")}`);

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

/**
 * `task verify --all`: re-prove every started task against the code as it is.
 *
 * Evidence is bound to the source it ran against, so a later task's change
 * stales an earlier task's proof, and completion asks for the final code to be
 * proven. Each command runs ONCE and its record is filed on every task whose
 * criteria name it: the affected modules come from the whole branch's change,
 * not the task, so per-task runs would be the same run repeated -- a ten
 * minute suite across eight tasks is not eighty minutes of new information.
 */
export async function taskVerifyAll(root: string, work?: string): Promise<void> {
    const workId = await openWorkId(root, work);
    if (workId === null) {
        throw new PreconditionError(
            'No open work item. Start one with `craftpath work new "<title>"`.',
        );
    }
    const tasks = [...(await readTasks(root, workId)).values()]
        .filter((task) => task.status !== "pending")
        .sort((a, b) => a.id.localeCompare(b.id));
    const config = await loadConfig(root);

    // Every plan before any run, for the same reason planRuns resolves first.
    const planned = [];
    for (const task of tasks)
        planned.push({ task, ...(await planRuns(root, task.id, task, config)) });
    const current = await fingerprint(root);

    const results = new Map<string, { exit: number; log: string; at: string; modules: string[] }>();
    let seq = 0;
    for (const { runs, modules } of planned) {
        for (const [cmd, steps] of runs) {
            if (results.has(cmd)) continue;
            const run = await execute(root, workId, "all", cmd, steps, ++seq);
            results.set(cmd, { ...run, modules });
            console.log(`${run.exit === 0 ? "passed" : "FAILED"}    ${cmd} (exit ${run.exit})`);
        }
    }

    const failed: string[] = [];
    for (const { task, runs } of planned) {
        const state = await readState(root, workId, task.id);
        const evidence = [...state.evidence];
        for (const cmd of runs.keys()) {
            const run = results.get(cmd)!;
            evidence.push({
                cmd,
                exit: run.exit,
                log: run.log,
                config_hash: current.config,
                tree: current.tree ?? undefined,
                at: run.at,
                modules: run.modules,
            });
        }
        await writeState(root, workId, { ...state, evidence });
        const left = unsatisfied({ ...task, evidence }, current);
        console.log(
            left.length === 0
                ? `${task.id} is fully verified`
                : `${task.id} unsatisfied: ${left.join(", ")}`,
        );
        if ([...runs.keys()].some((cmd) => results.get(cmd)!.exit !== 0)) failed.push(task.id);
    }

    if (failed.length > 0) {
        throw new PreconditionError(
            `Not verified: ${failed.join(", ")}. The evidence is recorded, failing runs ` +
                "included -- fix what they report, then run `craftpath task verify --all` again.",
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
export async function trailerInBranch(root: string, workId: string, id: string): Promise<boolean> {
    return (await trailerCommits(root, workId, id)).length > 0;
}

/**
 * The short SHAs of the commits carrying the trailer pair, newest first.
 *
 * These are what `commits_hint` records: a convenience for a human reading
 * state, never semantic (D-R4). The trailer stays the anchor precisely because
 * these go stale on every rebase, which is why `reconcile --fix` refreshes them
 * and a plain `reconcile` has no opinion about them.
 */
export async function trailerCommits(root: string, workId: string, id: string): Promise<string[]> {
    // --fixed-strings: the patterns are data, and a regex match here would be a
    // different question than "does this trailer appear".
    const [work, task] = anchorTrailers(workId, id);
    const found =
        await Bun.$`git -C ${root} log --fixed-strings --all-match --grep=${work} --grep=${task} --format=%h`
            .quiet()
            .nothrow();
    if (found.exitCode !== 0) return [];
    return found.stdout
        .toString()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
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
export async function taskDone(root: string, id: string, selectedWork?: string): Promise<void> {
    const { workId, task } = await loadTask(root, id, selectedWork);
    if (task.status === "in_progress") await requireApprovedPlan(root, workId, id, "complete");
    const [work, trailer] = anchorTrailers(workId, id);

    // One git call for both questions: whether the anchor is on the branch, and
    // which commits carry it. Asking twice could answer differently.
    const commits = await trailerCommits(root, workId, id);
    const status = done(
        task,
        await fingerprint(root),
        commits.length > 0,
        `both \`${work}\` and \`${trailer}\``,
    );

    const state = await readState(root, workId, id);
    await writeState(root, workId, {
        ...state,
        status,
        git: { ...state.git, trailer, work_trailer: work, commits_hint: commits },
    });
    console.log(`done      ${id}`);
}

export async function taskAck(
    root: string,
    id: string,
    criterionId: string,
    work?: string,
): Promise<void> {
    const { workId, task } = await loadTask(root, id, work);
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
    const work = await readWork(root, workId);
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
export async function taskAmend(
    root: string,
    id: string,
    reason: string,
    selectedWork?: string,
): Promise<void> {
    if (reason.trim().length === 0) {
        throw new PreconditionError(
            `An amendment needs a reason: craftpath amend ${id} --reason "<why>"`,
        );
    }
    const { workId } = await loadTask(root, id, selectedWork);
    const reopened = reopen();

    // Signed record before task state: with no signer nothing changes at all.
    await recordAmendment(
        root,
        workId,
        id,
        reason.trim(),
        "returned to pending, evidence and acks cleared",
    );

    const state = await readState(root, workId, id);
    await writeState(root, workId, { ...state, ...reopened });
    console.log(`amended   ${id} -> pending; plan and result gates reopened`);
}
