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
