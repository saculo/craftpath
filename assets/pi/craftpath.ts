// @ts-nocheck -- installed into a project with no node_modules to check against.
/**
 * craftpath on pi. Installed by `craftpath init`; re-running it replaces this file.
 *
 * Registers one `/craftpath-<step>` command per body in
 * `.pi/craftpath/commands/`. Each runs exactly what Claude Code runs for
 * `/craftpath:<step>`:
 *
 *   1. the guard, `.craftpath/scripts/guard.py`, with the same JSON a Claude
 *      Code `UserPromptExpansion` hook receives -- exit 2 refuses the command
 *      and its message is shown;
 *   2. the step's script for every `{{RUN:<script>}}` in the body, its output
 *      put in place of the marker;
 *   3. the body, with `$ARGUMENTS` filled in, handed to the agent.
 *
 * Imports node builtins only: an extension that fails to load leaves the
 * commands silently missing.
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDS = ".pi/craftpath/commands";
const SCRIPTS = ".craftpath/scripts";

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
        child.stdin.end(input ?? "");
    });
}

/** `---\ndescription: ...\n---\nbody` -> { description, body }. */
export function parse(text) {
    const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (match === null) return { description: "", body: text };
    const description = /^description:\s*(.*)$/m.exec(match[1])?.[1] ?? "";
    return { description, body: text.slice(match[0].length) };
}

/** Guard, scripts, prompt -- or a refusal. Exported for craftpath's tests. */
export async function expand(step, args, cwd, text) {
    const guard = await run(
        [join(SCRIPTS, "guard.py")],
        cwd,
        JSON.stringify({
            hook_event_name: "UserPromptExpansion",
            command_name: `craftpath:${step}`,
            command_args: args,
            cwd,
        }),
    );
    if (guard.status === 2) return { refused: guard.stderr.trim() || "Refused by craftpath." };
    if (guard.status !== 0) return { refused: `craftpath guard failed: ${guard.stderr.trim()}` };

    let { body } = parse(text);
    for (const [marker, script] of [...body.matchAll(/\{\{RUN:([a-z-]+)\}\}/g)]) {
        const out = await run([join(SCRIPTS, `${script}.py`), args], cwd);
        if (out.status !== 0) return { refused: out.stderr.trim() || `${script}.py failed` };
        body = body.replace(marker, out.stdout.trim());
    }
    return { prompt: body.replaceAll("$ARGUMENTS", args) };
}

export default function craftpath(pi) {
    let files = [];
    try {
        files = readdirSync(join(process.cwd(), COMMANDS)).filter((f) => f.endsWith(".md"));
    } catch {
        return;
    }
    for (const file of files) {
        const step = file.slice(0, -3);
        const text = readFileSync(join(process.cwd(), COMMANDS, file), "utf8");
        pi.registerCommand(`craftpath-${step}`, {
            description: parse(text).description,
            handler: async (args, ctx) => {
                const result = await expand(step, args ?? "", ctx.cwd ?? process.cwd(), text);
                if (result.refused !== undefined) {
                    ctx.ui.notify(result.refused, "error");
                    return;
                }
                pi.sendUserMessage(result.prompt);
            },
        });
    }
}
