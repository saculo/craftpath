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
    await refuseDirtyTree(root);
    const open = await openWorkIds(root);

    const slug = slugify(title);
    if (slug.length === 0) {
        throw new PreconditionError(
            `"${title}" contains no characters usable in a work item name.`,
        );
    }

    const archived = await sortedEntries(join(root, ARCHIVE));
    const id = `${nextId([...open, ...archived])}-${slug}`;

    // Every template read before anything is made: a missing one used to
    // throw after the work directory existed, leaving a stateless directory
    // that every later command refused as an interrupted scaffold.
    const scaffold = new Map<string, string>();
    for (const artifact of ARTIFACTS[mode]) {
        const template = Bun.file(join(root, TEMPLATES, artifact));
        if (!(await template.exists())) {
            throw new CorruptStateError(
                `missing template ${artifact}; run \`craftpath init\` to restore it`,
            );
        }
        scaffold.set(artifact, await template.text());
    }

    const workDir = join(root, WORK, id);
    await mkdir(join(workDir, "tasks"), { recursive: true });
    // Kept, not just made: git does not track an empty directory, so an empty
    // tasks/ or logs/ outlived a checkout of another branch and read there as
    // a work item interrupted mid-scaffold.
    await Bun.write(join(workDir, "tasks", ".gitkeep"), "");

    for (const [artifact, text] of scaffold) await Bun.write(join(workDir, artifact), text);

    await mkdir(join(root, STATE, id, "logs"), { recursive: true });
    await Bun.write(join(root, STATE, id, "logs", ".gitkeep"), "");

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
 * Uncommitted changes to tracked files, refused before anything is written.
 *
 * `work new` switches to a branch made from the base branch. Uncommitted work
 * would either be carried silently into the new item's branch or make the
 * switch fail halfway, after the work item was already scaffolded. Untracked
 * files are not counted: they follow any checkout untouched, and a freshly
 * initialised project is mostly untracked files.
 *
 * Outside a git repository there is no branch to make, so nothing to refuse.
 */
async function refuseDirtyTree(root: string): Promise<void> {
    const status = await Bun.$`git -C ${root} status --porcelain --untracked-files=no`
        .quiet()
        .nothrow();
    if (status.exitCode !== 0) return;
    const dirty = status.stdout.toString().trim().split("\n").filter(Boolean);
    if (dirty.length === 0) return;
    throw new PreconditionError(
        "The working tree has uncommitted changes, so a new work branch cannot start " +
            `cleanly from the base branch:\n${dirty
                .slice(0, 5)
                .map((l) => `  ${l}`)
                .join("\n")}` +
            (dirty.length > 5 ? `\n  ... and ${dirty.length - 5} more` : "") +
            "\nCommit or stash them, then run `craftpath work new` again.",
    );
}

/**
 * The work branch, made from `git.base_branch` -- never from the current HEAD.
 *
 * Branching from HEAD stacked a new item on whatever branch was checked out:
 * run from another work item's branch, the new branch carried that item's
 * commits and its committed state, which read as a second open work item.
 *
 * Runs last so a failure here leaves a complete work item rather than a
 * partial one, and it does not throw: the work item exists either way, and
 * trailers rather than the branch name are the durable anchor. But a branch
 * that was not made is now said out loud instead of leaving work to happen on
 * whatever branch was checked out.
 */
async function createBranch(root: string, workId: string): Promise<void> {
    const repo = await Bun.$`git -C ${root} rev-parse --is-inside-work-tree`.quiet().nothrow();
    if (repo.exitCode !== 0) return;

    const git = await readGitConfig(root);
    const branch = branchName(git.prefix, workId);
    const base = await Bun.$`git -C ${root} rev-parse --verify --quiet ${`${git.base}^{commit}`}`
        .quiet()
        .nothrow();
    if (base.exitCode !== 0) {
        console.error(
            `warning   no branch created: the base branch "${git.base}" does not exist. ` +
                "Set `base_branch` under [git] in .craftpath/config.toml, then create " +
                `${branch} from it yourself.`,
        );
        return;
    }
    const made = await Bun.$`git -C ${root} checkout -q -b ${branch} ${git.base}`.quiet().nothrow();
    if (made.exitCode !== 0) {
        console.error(
            `warning   could not create ${branch} from ${git.base}: ` +
                made.stderr.toString().trim(),
        );
    }
}

/**
 * The `[git]` table from config.toml, with craftpath's defaults.
 *
 * Parsed rather than imported: a dynamic import is module-cached, and config is
 * a file that changes -- caching it would make a later read return a value that
 * is no longer on disk.
 */
async function readGitConfig(root: string): Promise<{ prefix: string; base: string }> {
    try {
        const text = await Bun.file(join(root, ".craftpath/config.toml")).text();
        const parsed = Bun.TOML.parse(text) as {
            git?: { work_branch_prefix?: string; base_branch?: string };
        };
        return {
            prefix: parsed.git?.work_branch_prefix ?? "work/",
            base: parsed.git?.base_branch ?? "master",
        };
    } catch {
        return { prefix: "work/", base: "master" };
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

    const fileFor = new Map<string, string>();

    for (const file of files) {
        const prose = await readTaskProseFile(join(dir, file), file);

        // One task, one file. A second file with the same id was silently
        // shadowed -- readTasks kept the last, readTaskProse found the first --
        // so a worker could get one brief while the other's criteria were
        // checked. A file named for a different id is the same hazard.
        if (!namedFor(file, prose.id)) {
            throw new CorruptStateError(
                `${WORK}/${workId}/tasks/${file} declares id ${prose.id}, but a task file is ` +
                    `named after its id (${prose.id}-<name>.md). Rename the file or fix its id.`,
            );
        }
        const earlier = fileFor.get(prose.id);
        if (earlier !== undefined) {
            throw new CorruptStateError(
                `${earlier} and ${file} in ${WORK}/${workId}/tasks/ both declare ${prose.id}. ` +
                    "One task is one file: remove one, or give it its own id.",
            );
        }
        fileFor.set(prose.id, file);

        const state = await readTaskState(root, workId, prose.id);

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

/** Whether a task file's name belongs to `id`: `T001.md` or `T001-<anything>.md`. */
function namedFor(file: string, id: string): boolean {
    return file === `${id}.md` || (file.startsWith(`${id}-`) && file.endsWith(".md"));
}

/**
 * A task's trusted state, or null when it has none yet.
 *
 * The one reader for task state, so every command gives the same answer about
 * the same bytes: unreadable state is corrupt state, exit 3, with the file
 * named -- what `readWork` already said. A raw JSON or Zod failure was exit 1
 * with a stack dump, which on the Stop hook is an error nobody sees.
 */
export async function readTaskState(
    root: string,
    workId: string,
    id: string,
): Promise<TaskState | null> {
    const rel = `${STATE}/${workId}/${id}.json`;
    const file = Bun.file(join(root, rel));
    if (!(await file.exists())) return null;

    let raw: unknown;
    try {
        raw = await file.json();
    } catch (cause) {
        throw new CorruptStateError(`${rel} is not valid JSON: ${(cause as Error).message}`);
    }
    const parsed = TaskState.safeParse(raw);
    if (!parsed.success) {
        throw new CorruptStateError(
            `${rel} is not valid task state: ${parsed.error.issues
                .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
                .join("; ")}`,
        );
    }
    return parsed.data;
}

/** Full declared task brief, including skills omitted from transition state. */
export async function readTaskProse(root: string, workId: string, id: string): Promise<TaskProse> {
    const dir = join(root, WORK, workId, "tasks");
    const file = (await sortedEntries(dir)).find((name) => namedFor(name, id));
    if (file === undefined) throw new PreconditionError(`${id} does not exist in ${workId}.`);
    return readTaskProseFile(join(dir, file), file);
}
