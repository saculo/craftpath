/**
 * Work items: allocation, scaffolding, and reporting.
 *
 * Code owns id allocation and status; the model owns the prose inside the
 * artifacts this creates (§1). Everything here writes `.craftpath/state/`,
 * which the guards deny to the agent -- that asymmetry is the trust boundary.
 */
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
    CorruptStateError,
    PreconditionError,
    type Task,
    graphProblems,
    isBlocked,
    waves,
} from "../transitions";
import { type Mode, TaskProse, TaskState, WorkState } from "../schema";
import { derivePhase, gateState } from "./gates";

export const WORK = ".craftpath/work";
export const STATE = ".craftpath/state";
export const ARCHIVE = ".craftpath/archive";
export const TEMPLATES = ".craftpath/templates";

/**
 * Artifacts per mode (§9.1).
 *
 * `design.md` is deliberately in neither: §9.1 says "when needed", and a
 * scaffolded empty file is an invitation to fill it in. It is copied from
 * templates on demand, by whoever decides design work is warranted.
 */
const ARTIFACTS: Record<Mode, string[]> = {
    light: ["requirement.md", "spec-delta.md", "changelog.md"],
    standard: [
        "requirement.md",
        "context.md",
        "plan.md",
        "result.md",
        "spec-delta.md",
        "changelog.md",
    ],
};

/**
 * Next free 4-digit id.
 *
 * The `Number.isInteger` filter is load-bearing, not defensive clutter: `init`
 * writes a `.gitkeep` into both work/ and archive/, so this reads it on every
 * call, and `Number.parseInt(".git")` is NaN. Drop the filter and the first
 * `work new` in a fresh repo allocates NaN.
 */
export function nextId(existing: string[]): string {
    const highest = existing
        .map((name) => /^(?:W-)?(\d{4})-/.exec(name)?.[1])
        .map((number) => (number === undefined ? Number.NaN : Number.parseInt(number, 10)))
        .filter((n) => Number.isInteger(n))
        .reduce((a, b) => Math.max(a, b), 0);
    return `W-${String(highest + 1).padStart(4, "0")}`;
}

/** Title -> url-safe slug. NFKD so accented characters fold rather than vanish. */
export function slugify(title: string): string {
    return title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/[\s-]+/g, "-")
        .slice(0, 48)
        .replace(/^-|-$/g, "");
}

/**
 * Directory entries, minus the `.gitkeep` that keeps empty dirs in git.
 *
 * Sorted, because `readdir` returns filesystem order: with `open[0]` over an
 * unsorted listing, "the current work item" was whichever one the filesystem
 * happened to hand back first, so two readers could name different items. The
 * sibling `readTasks` already sorts; this was the same call three lines away
 * that did not.
 */
export async function sortedEntries(dir: string): Promise<string[]> {
    try {
        return (await readdir(dir)).filter((name) => name !== ".gitkeep").sort();
    } catch {
        return [];
    }
}

/** All work directories that are currently open. */
export async function openWorkIds(root: string): Promise<string[]> {
    return sortedEntries(join(root, WORK));
}

/**
 * Resolve an explicitly requested work item, or retain the one-item shortcut.
 * A shared repository has no durable "current work": callers must select when
 * more than one is open.
 */
export async function resolveWorkId(root: string, requested?: string): Promise<string | null> {
    const open = await openWorkIds(root);
    if (requested !== undefined) {
        if (open.includes(requested)) return requested;
        const canonical = open.find((id) => id.startsWith(`${requested}-`));
        if (canonical !== undefined && /^W-\d{4}$/.test(requested)) return canonical;
        const migrated = open.find((id) => id === `W-${requested}`);
        if (migrated !== undefined && /^\d{4}-/.test(requested)) return migrated;
        throw new PreconditionError(
            `${requested} is not an open work item. Open work items: ${open.join(", ") || "none"}.`,
        );
    }
    if (open.length === 0) return null;
    if (open.length === 1) return open[0]!;
    throw new PreconditionError(
        `More than one work item is open: ${open.join(", ")}. ` +
            "Pass --work <id> to select the work item to operate on.",
    );
}

/**
 * Creates a work item: allocates the id, scaffolds its artifacts, writes state.
 *
 * Kernel state is written LAST. Neither order is atomic, so the question is
 * which failure is kinder: a crash before state leaves a stray directory that
 * `status` ignores, while a crash after it would leave `status` reporting a
 * work item whose artifacts do not exist.
 */
export async function workNew(root: string, title: string, mode: Mode): Promise<void> {
    const open = await openWorkIds(root);

    const slug = slugify(title);
    if (slug.length === 0) {
        throw new PreconditionError(
            `"${title}" contains no characters usable in a work item name.`,
        );
    }

    const archived = await sortedEntries(join(root, ARCHIVE));
    const id = `${nextId([...open, ...archived])}-${slug}`;

    const workDir = join(root, WORK, id);
    await mkdir(join(workDir, "tasks"), { recursive: true });

    for (const artifact of ARTIFACTS[mode]) {
        const template = Bun.file(join(root, TEMPLATES, artifact));
        if (!(await template.exists())) {
            throw new CorruptStateError(
                `missing template ${artifact}; run \`craftpath init\` to restore it`,
            );
        }
        await Bun.write(join(workDir, artifact), await template.text());
    }

    await mkdir(join(root, STATE, id, "logs"), { recursive: true });

    const state: WorkState = {
        id,
        title,
        mode,
        approvals: [],
        amendments: [],
        created_at: new Date().toISOString(),
    };
    await Bun.write(
        join(root, STATE, id, "work.json"),
        JSON.stringify(WorkState.parse(state), null, 2) + "\n",
    );

    console.log(`created   ${WORK}/${id} (${mode})`);

    await createBranch(root, id);
}

/** Branch name from config; the prefix is the only configurable part. */
export function branchName(prefix: string, workId: string): string {
    return prefix.endsWith("/") ? prefix + workId : `${prefix}/${workId}`;
}

/**
 * Best effort, by decision: no preconditions, no failure handling.
 *
 * A dirty tree, an existing branch, or no git repository at all -- none of them
 * stop `work new`. The consequence is that when the branch is not created,
 * nothing says so and work happens on whatever branch you were already on;
 * `reconcile` is where that surfaces, since trailers are the durable anchor
 * rather than the branch name.
 *
 * Runs last so a failure here leaves a complete work item rather than a partial
 * one. `.nothrow()` is the decision in one call.
 */
async function createBranch(root: string, workId: string): Promise<void> {
    const prefix = (await readConfigPrefix(root)) ?? "work/";
    const branch = branchName(prefix, workId);
    await Bun.$`git -C ${root} checkout -b ${branch}`.quiet().nothrow();
}

/**
 * `git.work_branch_prefix` from config.toml, or null if it cannot be read.
 *
 * Parsed rather than imported: a dynamic import is module-cached, and config is
 * a file that changes -- caching it would make a later read return a value that
 * is no longer on disk.
 */
async function readConfigPrefix(root: string): Promise<string | null> {
    try {
        const text = await Bun.file(join(root, ".craftpath/config.toml")).text();
        const parsed = Bun.TOML.parse(text) as { git?: { work_branch_prefix?: string } };
        return parsed.git?.work_branch_prefix ?? null;
    } catch {
        return null;
    }
}

const NOTHING_OPEN = [
    "No open work item.",
    "",
    'Start one with:  craftpath work new "<title>"',
].join("\n");

/** The selected work id, or the sole open work item for compatibility. */
export async function openWorkId(root: string, requested?: string): Promise<string | null> {
    return resolveWorkId(root, requested);
}

/** Read kernel state for a known open work item. */
export async function readWork(root: string, id: string): Promise<WorkState> {
    const path = join(root, STATE, id, "work.json");
    const file = Bun.file(path);
    if (!(await file.exists())) {
        // A work directory with no state is the crash-mid-scaffold case. Say so
        // rather than reporting the repo as empty, which would hide the work.
        throw new CorruptStateError(
            `${WORK}/${id} exists but ${STATE}/${id}/work.json does not. ` +
                "An interrupted `craftpath work new` leaves this, and nothing records " +
                `what it was meant to be. Remove ${WORK}/${id}, then run \`craftpath work new\` again.`,
        );
    }
    try {
        // Fields older craftpaths wrote and this one retired: the stored phase
        // (now derived) and the worktree binding (8a70b80, removed in 156ca7b).
        // Drop them rather than let .strict() brick an existing work item.
        const {
            phase: _phase,
            worktree: _worktree,
            ...raw
        } = (await file.json()) as Record<string, unknown>;
        return WorkState.parse(raw);
    } catch (cause) {
        throw new CorruptStateError(
            `${STATE}/${id}/work.json is not valid work state: ${(cause as Error).message}`,
        );
    }
}

/** The selected work item's kernel state, or null when no work is open. */
export async function readOpenWork(root: string, requested?: string): Promise<WorkState | null> {
    const id = await resolveWorkId(root, requested);
    return id === null ? null : readWork(root, id);
}

const GATE_LABEL = { requirement: "req", plan: "plan", result: "result" } as const;

/** Derived from the approval record, never stored beside it. */
function gateSummary(work: WorkState): string {
    return (Object.keys(GATE_LABEL) as (keyof typeof GATE_LABEL)[])
        .map((g) => {
            const approved = gateState(work.approvals, g, work.amendments) === "approved";
            return `${GATE_LABEL[g]}=${approved ? "ok" : "pending"}`;
        })
        .join(" ");
}

/**
 * Reports where the open work item stands.
 *
 * No work item is a normal state, not an error: this is the first thing
 * `/craftpath:work` runs, in a repo that may have nothing yet.
 */
export async function status(root: string, brief: boolean, requested?: string): Promise<void> {
    if (requested !== undefined) {
        const state = await readWork(root, (await resolveWorkId(root, requested))!);
        await reportStatus(root, state, brief);
        return;
    }

    const ids = await openWorkIds(root);
    if (ids.length === 0) {
        console.log(brief ? "no open work item" : NOTHING_OPEN);
        return;
    }
    if (ids.length > 1) {
        if (!brief) console.log("Open work items");
        for (const id of ids) {
            const state = await readWork(root, id);
            const phase = derivePhase(state, await readTasks(root, id));
            console.log(`${id}  ${state.mode}  phase=${phase}  ${gateSummary(state)}`);
        }
        return;
    }

    await reportStatus(root, await readWork(root, ids[0]!), brief);
}

async function reportStatus(root: string, state: WorkState, brief: boolean): Promise<void> {
    const tasks = await readTasks(root, state.id);
    const phase = derivePhase(state, tasks);

    if (brief) {
        console.log(`${state.id}  ${state.mode}  phase=${phase}  ${gateSummary(state)}`);
        return;
    }

    console.log(`Work      ${state.id}`);
    console.log(`Title     ${state.title}`);
    console.log(`Mode      ${state.mode}`);
    console.log(`Phase     ${phase}`);
    console.log(`Gates     ${gateSummary(state)}`);

    if (tasks.size === 0) {
        // Normal until planning: a new work item has no tasks.
        console.log("Tasks     no tasks yet");
        return;
    }

    // A broken graph has no wave order, so ask what is wrong BEFORE asking for
    // one. The same resolver validate uses, so the two cannot give different
    // answers about the same tasks.
    const problems = graphProblems(tasks);
    const order = problems.length === 0 ? waves(tasks).flat() : [...tasks.keys()].sort();

    console.log("Tasks");
    for (const id of order) {
        const task = tasks.get(id)!;
        // `?.` because a dangling dependency resolves to nothing: this line
        // threw a raw TypeError with a source dump for anyone who got past the
        // wave ordering above.
        const blockers = task.depends_on.filter((d) => tasks.get(d)?.status !== "done");
        const suffix = blockers.length > 0 ? `  blocked by ${blockers.join(", ")}` : "";
        console.log(`  ${id}  ${task.status.padEnd(11)}${suffix}`);
    }

    if (problems.length > 0) {
        // Reported, not refused. This is the first thing `/craftpath:work`
        // runs and it is a report; `validate` is the thing that refuses, and it
        // now says the same sentence.
        console.log("Problems");
        for (const problem of problems) console.log(`  - ${problem}`);
        console.log("Next      nothing, until the problems above are fixed");
        return;
    }

    const next = order.find((id) => {
        const t = tasks.get(id)!;
        return t.status !== "done" && !isBlocked(t, tasks);
    });
    console.log(next ? `Next      ${next}` : "Next      nothing unblocked");
}

/** Frontmatter between the first two `---` fences. */
function frontmatter(source: string, file: string): unknown {
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!match) {
        throw new CorruptStateError(`${file} has no frontmatter block`);
    }
    try {
        return Bun.YAML.parse(match[1]!);
    } catch (cause) {
        throw new CorruptStateError(`${file}: ${(cause as Error).message}`);
    }
}

/**
 * Task prose joined to task state.
 *
 * A prose file with no state file reads as `pending` with no evidence rather
 * than as corruption: `task add` writes both, but a hand-written task file is
 * still a task.
 */
export async function readTasks(root: string, workId: string): Promise<Map<string, Task>> {
    const dir = join(root, WORK, workId, "tasks");
    const files = (await sortedEntries(dir)).filter((f) => f.endsWith(".md")).sort();
    const tasks = new Map<string, Task>();

    for (const file of files) {
        const prose = await readTaskProseFile(join(dir, file), file);

        const statePath = join(root, STATE, workId, `${prose.id}.json`);
        const stateFile = Bun.file(statePath);
        const state = (await stateFile.exists()) ? TaskState.parse(await stateFile.json()) : null;

        tasks.set(prose.id, {
            id: prose.id,
            status: state?.status ?? "pending",
            depends_on: prose.depends_on,
            acceptance: prose.acceptance,
            evidence: state?.evidence ?? [],
            acks: state?.acks ?? [],
            produces: prose.produces,
        });
    }
    return tasks;
}

async function readTaskProseFile(path: string, name: string): Promise<TaskProse> {
    const raw = frontmatter(await Bun.file(path).text(), name);
    const parsed = TaskProse.safeParse(raw);
    if (parsed.success) return parsed.data;
    throw new CorruptStateError(
        `${name} is not a valid task: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ")}`,
    );
}

/** Full declared task brief, including skills omitted from transition state. */
export async function readTaskProse(root: string, workId: string, id: string): Promise<TaskProse> {
    const dir = join(root, WORK, workId, "tasks");
    const file = (await sortedEntries(dir)).find(
        (name) => name.startsWith(`${id}-`) && name.endsWith(".md"),
    );
    if (file === undefined) throw new PreconditionError(`${id} does not exist in ${workId}.`);
    return readTaskProseFile(join(dir, file), file);
}
