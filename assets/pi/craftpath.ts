// @ts-nocheck -- installed into a project with no node_modules to check against.
/**
 * craftpath's guard on pi. Installed by `craftpath init`; re-running it replaces
 * this file.
 *
 * pi's `tool_call` event is the PreToolUse hook: before a shell call that runs a
 * craftpath step's script (`python3 .craftpath/scripts/plan.py C-00001`), this
 * hands the call to `.craftpath/scripts/guard.py` -- the same guard Claude
 * Code's PreToolUse hook runs, given the same JSON -- and blocks the call when
 * it refuses. Every other tool call passes without starting a process.
 *
 * Imports node builtins only: an extension that fails to load leaves the guard
 * silently missing.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

/** A shell command that runs one of craftpath's scripts. */
const STEP_SCRIPT = /\.craftpath\/scripts\/[a-z-]+\.py\b/;

function run(args, cwd, input) {
    return new Promise((resolve) => {
        const child = spawn("python3", args, { cwd });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => resolve({ status: null, stdout, stderr: String(error) }));
        child.on("close", (status) => resolve({ status, stdout, stderr }));
        child.stdin.end(input);
    });
}

/** The guard's verdict on one tool call: undefined, or why it is refused. */
export async function verdict(toolName, input, cwd) {
    const command = input?.command;
    if (typeof command !== "string" || !STEP_SCRIPT.test(command)) return undefined;
    const result = await run(
        [join(".craftpath", "scripts", "guard.py")],
        cwd,
        JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: toolName,
            tool_input: input,
            cwd,
        }),
    );
    if (result.status !== 0) {
        // A guard that could not run has not allowed anything.
        return `craftpath's guard failed: ${result.stderr.trim() || `exit ${result.status}`}`;
    }
    if (result.stdout.trim() === "") return undefined;
    const decision = JSON.parse(result.stdout).hookSpecificOutput;
    return decision?.permissionDecision === "deny" ? decision.permissionDecisionReason : undefined;
}

export default function craftpath(pi) {
    pi.on("tool_call", async (event, ctx) => {
        const reason = await verdict(event.toolName, event.input, ctx?.cwd ?? process.cwd());
        // No `terminate`: the agent must still report the reason. The step says to stop.
        return reason === undefined ? undefined : { block: true, reason };
    });
}
