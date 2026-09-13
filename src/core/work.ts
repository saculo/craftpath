/**
 * Work items: allocation, scaffolding, and reporting.
 *
 * Code owns id allocation and status; the model owns the prose inside the
 * artifacts this creates (§1). Everything here writes `.craftpath/state/`,
 * which the guards deny to the agent -- that asymmetry is the trust boundary.
 */
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CorruptStateError, PreconditionError } from "../transitions";
import { type Mode, WorkState } from "../schema";

const WORK = ".craftpath/work";
const STATE = ".craftpath/state";
const ARCHIVE = ".craftpath/archive";
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
        phase: "requirement",
        gates: { requirement: "pending", plan: "pending", result: "pending" },
        created_at: new Date().toISOString(),
    };
    await Bun.write(
        join(root, STATE, id, "work.json"),
        JSON.stringify(WorkState.parse(state), null, 2) + "\n",
    );

    console.log(`created   ${WORK}/${id} (${mode})`);
}

const NOTHING_OPEN = [
    "No open work item.",
    "",
    'Start one with:  craftpath work new "<title>"',
].join("\n");

/** The open work item's kernel state, or null when there is none. */
async function readOpenWork(root: string): Promise<WorkState | null> {
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
        return WorkState.parse(await file.json());
    } catch (cause) {
        throw new CorruptStateError(
            `${STATE}/${id}/work.json is not valid work state: ${(cause as Error).message}`,
        );
    }
}

const GATE_LABEL = { requirement: "req", plan: "plan", result: "result" } as const;

function gateSummary(gates: WorkState["gates"]): string {
    return (Object.keys(GATE_LABEL) as (keyof typeof GATE_LABEL)[])
        .map((g) => `${GATE_LABEL[g]}=${gates[g] === "approved" ? "ok" : "pending"}`)
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

    if (brief) {
        console.log(
            `${state.id}  ${state.mode}  phase=${state.phase}  ${gateSummary(state.gates)}`,
        );
        return;
    }

    console.log(`Work      ${state.id}`);
    console.log(`Title     ${state.title}`);
    console.log(`Mode      ${state.mode}`);
    console.log(`Phase     ${state.phase}`);
    console.log(`Gates     ${gateSummary(state.gates)}`);
}
