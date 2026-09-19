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
const TEMPLATES = ".craftpath/templates";

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
        .map((name) => Number.parseInt(name.slice(0, 4), 10))
        .filter((n) => Number.isInteger(n))
        .reduce((a, b) => Math.max(a, b), 0);
    return String(highest + 1).padStart(4, "0");
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

/** Directory entries, minus the `.gitkeep` that keeps empty dirs in git. */
async function entries(dir: string): Promise<string[]> {
    try {
        return (await readdir(dir)).filter((name) => name !== ".gitkeep");
    } catch {
        return [];
    }
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
    const open = await entries(join(root, WORK));
    if (open.length > 0) {
        throw new PreconditionError(
            `${open[0]} is already open. Finish or archive it before starting another, ` +
            `or run \`craftpath status\` to see where it stands.`,
        );
    }

    const slug = slugify(title);
    if (slug.length === 0) {
        throw new PreconditionError(
            `"${title}" contains no characters usable in a work item name.`,
        );
    }

    const archived = await entries(join(root, ARCHIVE));
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

/** The id of the open work item, or null when there is none. */
export async function openWorkId(root: string): Promise<string | null> {
    const open = await entries(join(root, WORK));
    return open.length === 0 ? null : open[0]!;
}

/** The open work item's kernel state, or null when there is none. */
export async function readOpenWork(root: string): Promise<WorkState | null> {
    const open = await entries(join(root, WORK));
    if (open.length === 0) return null;

    const id = open[0]!;
    const path = join(root, STATE, id, "work.json");
    const file = Bun.file(path);
    if (!(await file.exists())) {
        // A work directory with no state is the crash-mid-scaffold case. Say so
        // rather than reporting the repo as empty, which would hide the work.
        throw new CorruptStateError(
            `${WORK}/${id} exists but ${STATE}/${id}/work.json does not. ` +
            `Run \`craftpath reconcile\` once it exists, or remove the directory.`,
        );
    }
    try {
        // Work state written before the phase was derived still carries it.
        // Drop it rather than let .strict() brick an existing work item.
        const { phase: _legacy, ...raw } = (await file.json()) as Record<string, unknown>;
        return WorkState.parse(raw);
    } catch (cause) {
        throw new CorruptStateError(
            `${STATE}/${id}/work.json is not valid work state: ${(cause as Error).message}`,
        );
    }
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
export async function status(root: string, brief: boolean): Promise<void> {
    const state = await readOpenWork(root);

    if (!state) {
        console.log(brief ? "no open work item" : NOTHING_OPEN);
        return;
    }

    const tasks = await readTasks(root, state.id);
    const phase = derivePhase(state, tasks);

    if (brief) {
        console.log(
            `${state.id}  ${state.mode}  phase=${phase}  ${gateSummary(state)}`,
        );
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
    const files = (await entries(dir)).filter((f) => f.endsWith(".md")).sort();
    const tasks = new Map<string, Task>();

    for (const file of files) {
        const raw = frontmatter(await Bun.file(join(dir, file)).text(), file);
        const parsed = TaskProse.safeParse(raw);
        if (!parsed.success) {
            throw new CorruptStateError(
                `${file} is not a valid task: ${parsed.error.issues
                    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
                    .join("; ")}`,
            );
        }
        const prose = parsed.data;

        const statePath = join(root, STATE, workId, `${prose.id}.json`);
        const stateFile = Bun.file(statePath);
        const state = (await stateFile.exists())
            ? TaskState.parse(await stateFile.json())
            : null;

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
