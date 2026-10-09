/**
 * Fixtures for the step tests: a repository with craftpath installed, and the
 * step scripts run exactly as the harnesses run them.
 */
import { join } from "node:path";
import { init } from "../../src/init";
import { scratch } from "../scratch";

export const git = (cwd: string, ...args: string[]) =>
    Bun.$`git -C ${cwd} -c user.email=t@e.c -c user.name=T ${args}`.quiet();

export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
    }
}

/** A repo `app` on main with craftpath installed (and committed, by default). */
export async function project(
    options: { commit?: boolean; harness?: string } = {},
): Promise<string> {
    const parent = await scratch("craftpath-step-");
    const root = join(parent, "app");
    await Bun.write(join(root, "package.json"), '{"name":"app","scripts":{"test":"bun test"}}\n');
    await git(root, "init", "-q", "-b", "main");
    await git(root, "commit", "-q", "--allow-empty", "-m", "base");
    await quietly(() => init(root, ["--harness", options.harness ?? "claude-code"]));
    if (options.commit ?? true) {
        await git(root, "add", "-A");
        await git(root, "commit", "-q", "-m", "chore: install craftpath");
    }
    return root;
}

export async function python(cwd: string, args: string[], stdin = "") {
    const p = Bun.spawn(["python3", ...args], {
        cwd,
        stdin: new Blob([stdin]),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
    ]);
    return { exit: await p.exited, out, err };
}

/**
 * The guard, given what a PreToolUse hook hands it when the agent runs a step's
 * script -- Claude Code's shape by default, pi's (`bash`) when asked.
 *
 * It refuses with the JSON both harnesses read; anything else lets the call
 * through.
 */
export async function guard(
    cwd: string,
    step: string,
    args: string,
    options: { tool?: string; command?: string } = {},
): Promise<{ blocked: boolean; reason: string; exit: number }> {
    const command = options.command ?? `python3 .craftpath/scripts/${step}.py ${args}`;
    const { exit, out } = await python(
        cwd,
        [".craftpath/scripts/guard.py"],
        JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: options.tool ?? "Bash",
            tool_input: { command },
            cwd,
        }),
    );
    if (out.trim() === "") return { blocked: false, reason: "", exit };
    const decision = JSON.parse(out).hookSpecificOutput;
    return {
        blocked: decision.permissionDecision === "deny",
        reason: decision.permissionDecisionReason,
        exit,
    };
}

/** A step script, given the command's arguments as one string. */
export const script = (cwd: string, name: string, ...args: string[]) =>
    python(cwd, [`.craftpath/scripts/${name}.py`, ...args]);

/** The worktree of a work item created in `root` (repo `app`). */
export const worktree = (root: string, name: string) => join(root, "..", "app.craftpath", name);

export const ID = "C-00001";
export const TREE = "C-00001-health-endpoint";
export const work = (root: string) => join(worktree(root, TREE), ".craftpath/work", ID);

export const COMPLETE_SPEC = `# C-00001 — Health endpoint

## Problem

Load balancers cannot tell whether the API is up.

## Scenarios

### S1 — Health check succeeds

- **Given** the API is running
- **When** a client sends GET /health
- **Then** it answers 200 with the JSON body {"ok":true}

## Out of scope

Checking the database.

## Open questions

None
`;

export const completeTask = (
    id: string,
    wave: number,
    depends = "none",
    touches = "src/app.ts, test/health.test.ts",
) => `# ${id} — Add GET /health

- **Work:** C-00001
- **Type:** feat
- **Wave:** ${wave}
- **Depends on:** ${depends}
- **Touches:** ${touches}
- **Scenarios:** S1

## Acceptance criteria

- **A1** GET /health answers 200 with {"ok":true} and needs no token — proven by integration test \`GET /health returns ok\`

## Notes
`;

/** A project with work item C-00001 created, its SPEC.md as given. */
export async function withSpec(spec = COMPLETE_SPEC): Promise<string> {
    const root = await project();
    await script(root, "spec", "Health endpoint");
    await Bun.write(join(work(root), "SPEC.md"), spec);
    return root;
}

/**
 * A plan with goal and approach written and the given tasks added and filled:
 * each as [wave, depends on, touches].
 */
export async function planned(tasks: [number, string | null, string?][]): Promise<string> {
    const root = await withSpec();
    await script(root, "plan", ID);
    const path = join(work(root), "PLAN.md");
    // Goal and Approach written, guidance comments gone; task.py adds the tasks.
    const plan = [
        "# C-00001 — Health endpoint: plan",
        "",
        "## Goal",
        "",
        "GET /health tells load balancers the API is up.",
        "",
        "## Approach",
        "",
        "One route, tested end to end.",
        "",
        "## Tasks",
        "",
    ].join("\n");
    await Bun.write(path, plan);
    for (const [i, [wave, depends, touches]] of tasks.entries()) {
        const id = `T-000${i + 1}`;
        await script(root, "task", ID, "--wave", String(wave), "Add GET /health");
        await Bun.write(
            join(work(root), "tasks", `${id}.md`),
            completeTask(id, wave, depends ?? "none", touches),
        );
    }
    return root;
}

/** The commits after `since`, oldest first: each subject and the files it changed. */
export async function commitsSince(
    cwd: string,
    since: string,
): Promise<{ subject: string; files: string[] }[]> {
    const shas = (await git(cwd, "rev-list", "--reverse", `${since}..HEAD`)).text().trim();
    const out = [];
    for (const sha of shas ? shas.split("\n") : []) {
        const subject = (await git(cwd, "log", "-1", "--format=%s", sha)).text().trim();
        const files = (await git(cwd, "show", "--name-only", "--format=", sha)).text().trim();
        out.push({ subject, files: files.split("\n").sort() });
    }
    return out;
}
