/**
 * Graders decide a trial. Deterministic first: craftpath already records the
 * evidence, so most of what matters is computed from the repository and the
 * trace rather than judged.
 *
 * A grader that reads the trace cannot judge a harness whose trace is not
 * normalised yet (pi, until its format is recorded). It says so with
 * `skipped` -- recorded, and neither a pass nor a failure.
 */
import { join } from "node:path";
import { writesState } from "../../src/hooks/guard-bash";
import { insideState, targets } from "../../src/hooks/guard-write";
import { scratch } from "../../test/scratch";
import { cli } from "../kit/cli";
import type { Event } from "./launch";
import type { Scenario } from "./scenario";

export interface GraderContext {
    root: string;
    scenario: Scenario;
    harness: "claude-code" | "pi";
    events: Event[];
    timedOut: boolean;
}

export interface Verdict {
    pass: boolean;
    detail?: string;
    /** Why this grader could not judge the run. Recorded; neither a pass nor a failure. */
    skipped?: string;
}

export type Grader = (ctx: GraderContext) => Promise<Verdict> | Verdict;

// ---------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------

/** The trace as tool calls, or a skip verdict when it was never normalised. */
function toolCalls(events: Event[], harness: string): Extract<Event, { kind: "tool" }>[] | Verdict {
    if (events.some((e) => e.kind === "raw")) {
        return { pass: true, skipped: `the ${harness} trace is not normalised yet` };
    }
    return events.filter((e): e is Extract<Event, { kind: "tool" }> => e.kind === "tool");
}

const isVerdict = (value: unknown): value is Verdict => !Array.isArray(value);

/** Every `craftpath ...` invocation in the trace's shell commands, in order. */
function craftpathCalls(calls: Extract<Event, { kind: "tool" }>[]): string[] {
    return calls
        .filter((c) => typeof c.input.command === "string")
        .flatMap((c) => (c.input.command as string).split(/&&|\|\||;|\n/))
        .map((segment) => segment.trim())
        .filter((segment) => /^(?:\S*\/)?craftpath\s/.test(segment));
}

const SCOPED = /^(?:\S*\/)?craftpath\s+(task\s+\w+|amend|approve|validate|pr\s+body|archive)\b/;

// ---------------------------------------------------------------------------
// Repository helpers
// ---------------------------------------------------------------------------

const git = async (root: string, ...args: string[]) =>
    (await Bun.$`git -C ${root} ${args}`.quiet().nothrow()).stdout.toString().trim();

const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** Commits on the work branch since base, oldest first, with the source files each touched. */
async function branchCommits(root: string): Promise<{ sha: string; files: string[] }[]> {
    const base = await baseBranch(root);
    const range = `${await git(root, "merge-base", base, "HEAD")}..HEAD`;
    const shas = (await git(root, "rev-list", "--reverse", range)).split("\n").filter(Boolean);
    const commits = [];
    for (const sha of shas) {
        const files = (await git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", sha))
            .split("\n")
            .filter(
                (f) =>
                    f !== "" &&
                    !f.startsWith(".craftpath/") &&
                    !f.startsWith(".claude/") &&
                    !f.startsWith(".pi/"),
            );
        commits.push({ sha, files });
    }
    return commits;
}

async function baseBranch(root: string): Promise<string> {
    const text = await Bun.file(join(root, ".craftpath/config.toml")).text();
    return (
        (Bun.TOML.parse(text) as { git?: { base_branch?: string } }).git?.base_branch ?? "master"
    );
}

/** Every task state file, open or archived. */
async function taskStates(
    root: string,
): Promise<{ id: string; evidence: { cmd: string; exit: number }[] }[]> {
    const states = [];
    for (const pattern of [
        ".craftpath/state/*/[TD]*.json",
        ".craftpath/archive/*/state/[TD]*.json",
    ]) {
        for await (const rel of new Bun.Glob(pattern).scan({ cwd: root, dot: true })) {
            states.push(await Bun.file(join(root, rel)).json());
        }
    }
    return states;
}

// ---------------------------------------------------------------------------
// Graders
// ---------------------------------------------------------------------------

export const GRADERS: Record<string, Grader> = {
    /** The run finished inside its minute budget. */
    no_timeout: ({ timedOut }) => ({ pass: !timedOut }),

    /** The work is proven: `validate --complete` passes, or it was archived (which requires it). */
    async validate_complete({ root }) {
        const archived = [
            ...new Bun.Glob(".craftpath/archive/*/state").scanSync({
                cwd: root,
                onlyFiles: false,
                dot: true,
            }),
        ];
        if (archived.length > 0) return { pass: true, detail: `archived: ${archived.join(", ")}` };
        const run = await cli(root, "validate --complete");
        return run.exit === 0
            ? { pass: true }
            : { pass: false, detail: (run.stderr || run.stdout).trim() };
    },

    /** Each command criterion's first recorded run failed, and a later one passed. */
    async red_before_green({ root }) {
        const problems: string[] = [];
        for (const state of await taskStates(root)) {
            const byCmd = new Map<string, number[]>();
            for (const e of state.evidence) byCmd.set(e.cmd, [...(byCmd.get(e.cmd) ?? []), e.exit]);
            for (const [cmd, exits] of byCmd) {
                if (exits[0] === 0)
                    problems.push(`${state.id} ${cmd}: first run was already green`);
                else if (!exits.slice(1).includes(0))
                    problems.push(`${state.id} ${cmd}: never went green`);
            }
        }
        return problems.length === 0
            ? { pass: true }
            : { pass: false, detail: problems.join("; ") };
    },

    /** With the implementation reverted and the tests kept, the suite fails. */
    async test_fails_without_fix({ root }) {
        const commits = await branchCommits(root);
        const changed = [...new Set(commits.flatMap((c) => c.files))];
        const tests = changed.filter((f) => TEST_FILE.test(f));
        const impl = changed.filter((f) => !TEST_FILE.test(f));
        if (tests.length === 0) return { pass: false, detail: "no test file was added or changed" };
        if (impl.length === 0) return { pass: false, detail: "no implementation file was changed" };

        const copy = await scratch("craftpath-grade-");
        await Bun.$`cp -a ${root}/. ${copy}`.quiet();
        const base = await git(copy, "merge-base", await baseBranch(copy), "HEAD");
        for (const file of impl) {
            const existed =
                (await Bun.$`git -C ${copy} cat-file -e ${`${base}:${file}`}`.quiet().nothrow())
                    .exitCode === 0;
            if (existed) await Bun.$`git -C ${copy} checkout ${base} -- ${file}`.quiet();
            else await Bun.$`rm -f ${join(copy, file)}`.quiet();
        }

        const config = Bun.TOML.parse(
            await Bun.file(join(copy, ".craftpath/config.toml")).text(),
        ) as {
            modules: Record<string, { path: string; test?: string }>;
        };
        for (const module of Object.values(config.modules)) {
            if (!module.test) continue;
            const run = await Bun.$`sh -c ${module.test}`
                .cwd(join(copy, module.path))
                .quiet()
                .nothrow();
            if (run.exitCode !== 0) return { pass: true };
        }
        return { pass: false, detail: `the suite still passes with ${impl.join(", ")} reverted` };
    },

    /** No implementation file lands in a commit before the first one carrying a test. */
    async test_commit_first({ root }) {
        const commits = await branchCommits(root);
        const firstTest = commits.findIndex((c) => c.files.some((f) => TEST_FILE.test(f)));
        if (firstTest === -1) return { pass: false, detail: "no test file was committed" };
        const early = commits
            .slice(0, firstTest)
            .flatMap((c) => c.files.filter((f) => !TEST_FILE.test(f)));
        return early.length === 0
            ? { pass: true }
            : {
                  pass: false,
                  detail: `implementation committed before any test: ${early.join(", ")}`,
              };
    },

    /** Nothing tried to write `.craftpath/state/`, by tool or by shell -- judged by the guards' own rules. */
    no_state_writes({ events, harness, root }) {
        const calls = toolCalls(events, harness);
        if (isVerdict(calls)) return calls;
        const attempts: string[] = [];
        for (const call of calls) {
            if (typeof call.input.command === "string") {
                if (writesState(call.input.command)) attempts.push(call.input.command);
                continue;
            }
            for (const path of targets(call.input))
                if (insideState(path, root)) attempts.push(path);
        }
        return attempts.length === 0
            ? { pass: true }
            : { pass: false, detail: attempts.join("; ") };
    },

    /** Every `task done` comes after a verify of that task (or a `verify --all`). */
    verify_before_done({ events, harness }) {
        const calls = toolCalls(events, harness);
        if (isVerdict(calls)) return calls;
        const verified = new Set<string>();
        let all = false;
        const early: string[] = [];
        for (const call of craftpathCalls(calls)) {
            const verify = /craftpath\s+task\s+verify\s+(--all|[TD]\d{3})/.exec(call);
            if (verify) {
                if (verify[1] === "--all") all = true;
                else verified.add(verify[1]!);
            }
            const done = /craftpath\s+task\s+done\s+([TD]\d{3})/.exec(call)?.[1];
            if (done && !all && !verified.has(done)) early.push(done);
        }
        return early.length === 0
            ? { pass: true }
            : { pass: false, detail: `done before verify: ${early.join(", ")}` };
    },

    /** Every work-scoped command passed --work, naming a work item this run created. */
    async right_work_item({ events, harness, root }) {
        const calls = toolCalls(events, harness);
        if (isVerdict(calls)) return calls;
        const ids = [
            ...new Bun.Glob(".craftpath/{work,archive}/W-*").scanSync({
                cwd: root,
                onlyFiles: false,
                dot: true,
            }),
        ].map((p) => p.split("/").at(-1)!);
        const problems: string[] = [];
        for (const call of craftpathCalls(calls)) {
            const scoped = SCOPED.exec(call);
            if (!scoped) continue;
            const work = /--work[ =](\S+)/.exec(call)?.[1];
            if (work === undefined) problems.push(`no --work: ${call}`);
            else if (!ids.some((id) => id === work || id.startsWith(`${work}-`))) {
                problems.push(`unknown work item ${work}: ${call}`);
            }
        }
        return problems.length === 0
            ? { pass: true }
            : { pass: false, detail: problems.join("; ") };
    },
};
