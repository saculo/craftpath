// @ts-nocheck -- installed into a project with no node_modules to check against.
/**
 * Claude Code's hooks, on pi. Installed by `craftpath init`; re-running it
 * replaces this file.
 *
 * Reads the `hooks` block of `.pi/settings.json` (and `~/.pi/agent/settings.json`)
 * -- the same format as Claude Code's `settings.json` -- and runs those hooks on
 * the matching pi events, as Claude Code would:
 *
 *   PreToolUse        tool_call              exit 2 or permissionDecision "deny" blocks
 *   PostToolUse       tool_result            exit 2 / decision "block" reason goes to the model
 *   UserPromptSubmit  input                  exit 2 / decision "block" drops the prompt; stdout is context
 *   Stop              agent_before_settle    exit 2 / decision "block" continues once with the reason
 *   SessionStart      session_start
 *   SessionEnd        session_shutdown
 *   PreCompact        session_before_compact
 *   PostCompact       session_compact
 *
 * Each hook command runs through the shell with the JSON Claude Code would send
 * on stdin and CLAUDE_PROJECT_DIR set, so hook lines written for Claude Code
 * work unchanged. pi's tools are presented under Claude Code's names and input
 * shapes (`bash` -> `Bash`, `path` -> `file_path`).
 *
 * Event mapping and result handling follow @hsingjui/pi-hooks (MIT).
 * Imports node builtins only: an extension that fails to load leaves every
 * hook silently off.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// pi's tools as Claude Code's
// ---------------------------------------------------------------------------

const NAMES = {
    bash: "Bash",
    write: "Write",
    edit: "Edit",
    read: "Read",
    grep: "Grep",
    find: "Glob",
    ls: "LS",
};

/** pi's tool call -> Claude Code's tool_name and tool_input. */
export function toClaude(toolName, input = {}) {
    const name = NAMES[toolName] ?? toolName;
    const { path, edits, ...rest } = input;
    if (toolName === "edit") {
        const pairs = (edits ?? []).map((e) => ({ old_string: e.oldText, new_string: e.newText }));
        return pairs.length === 1
            ? { name, input: { file_path: path, ...pairs[0] } }
            : { name: "MultiEdit", input: { file_path: path, edits: pairs } };
    }
    if (toolName === "write" || toolName === "read")
        return { name, input: { file_path: path, ...rest } };
    return { name, input };
}

/** A hook's updatedInput, in Claude Code's shape -> pi's. */
export function toPi(toolName, input) {
    const { file_path, old_string, new_string, edits, ...rest } = input;
    if (toolName === "edit") {
        const pairs = edits ?? [{ old_string, new_string }];
        return {
            path: file_path,
            edits: pairs.map((e) => ({ oldText: e.old_string, newText: e.new_string })),
        };
    }
    if (toolName === "write" || toolName === "read") return { path: file_path, ...rest };
    return input;
}

// ---------------------------------------------------------------------------
// Configuration and execution
// ---------------------------------------------------------------------------

function readHooks(file) {
    try {
        return JSON.parse(readFileSync(file, "utf8")).hooks ?? {};
    } catch {
        return {};
    }
}

/** The hook commands for an event whose matcher accepts `subject`. */
function commandsFor(cwd, event, subject) {
    const groups = [
        ...(readHooks(join(cwd, ".pi", "settings.json"))[event] ?? []),
        ...(readHooks(join(homedir(), ".pi", "agent", "settings.json"))[event] ?? []),
    ];
    return groups
        .filter((group) => matches(group.matcher, subject))
        .flatMap((group) => (group.hooks ?? []).filter((h) => h.type === "command" && h.command));
}

/** Claude Code's matchers: empty or `*` is everything, otherwise a regex (so `A|B` lists names). */
function matches(matcher, subject) {
    if (!matcher || matcher === "*" || subject === undefined) return true;
    try {
        return new RegExp(`^(?:${matcher})$`).test(subject);
    } catch {
        return matcher === subject;
    }
}

function runHook(hook, payload, cwd) {
    return new Promise((resolve) => {
        const child = spawn("sh", ["-c", hook.command], {
            cwd,
            env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => child.kill("SIGTERM"), (hook.timeout ?? 60) * 1000);
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            resolve({ code: null, stdout, stderr: String(error) });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });
        child.stdin.end(JSON.stringify(payload));
    });
}

function json(text) {
    if (!text.startsWith("{")) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** Every matching hook, in order, with what each said. */
async function run(cwd, event, subject, fields) {
    const payload = { session_id: "pi", cwd, hook_event_name: event, ...fields };
    const results = [];
    for (const hook of commandsFor(cwd, event, subject)) {
        const result = await runHook(hook, payload, cwd);
        results.push({ ...result, output: result.code === 0 ? json(result.stdout) : null });
    }
    return results;
}

/** A blocking answer: exit 2 (stderr), or a JSON decision. */
function blocking(result) {
    if (result.code === 2) return result.stderr || "Blocked by hook";
    const out = result.output;
    const specific = out?.hookSpecificOutput;
    if (specific?.permissionDecision === "deny")
        return specific.permissionDecisionReason || "Blocked by hook";
    if (out?.decision === "block") return out.reason || "Blocked by hook";
    return null;
}

function context(result) {
    if (result.code !== 0) return null;
    if (result.output) return result.output.hookSpecificOutput?.additionalContext ?? null;
    return result.stdout || null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export default function claudeHooks(pi) {
    const cwdOf = (ctx) => ctx?.cwd ?? process.cwd();

    pi.on("tool_call", async (event, ctx) => {
        const cwd = cwdOf(ctx);
        const tool = toClaude(event.toolName, event.input);
        for (const result of await run(cwd, "PreToolUse", tool.name, {
            tool_name: tool.name,
            tool_input: tool.input,
        })) {
            const reason = blocking(result);
            if (reason !== null) return { block: true, reason };
            const updated = result.output?.hookSpecificOutput?.updatedInput;
            if (updated && typeof updated === "object") {
                const next = toPi(event.toolName, updated);
                for (const key of Object.keys(event.input)) delete event.input[key];
                Object.assign(event.input, next);
            }
        }
        return undefined;
    });

    pi.on("tool_result", async (event, ctx) => {
        const cwd = cwdOf(ctx);
        const tool = toClaude(event.toolName, event.input);
        const notes = [];
        for (const result of await run(cwd, "PostToolUse", tool.name, {
            tool_name: tool.name,
            tool_input: tool.input,
            tool_response: { content: event.content, isError: event.isError },
        })) {
            const note = blocking(result) ?? context(result);
            if (note && (result.code === 2 || result.output)) notes.push(note);
        }
        if (notes.length === 0) return undefined;
        return { content: [...event.content, ...notes.map((text) => ({ type: "text", text }))] };
    });

    pi.on("input", async (event, ctx) => {
        const cwd = cwdOf(ctx);
        const added = [];
        for (const result of await run(cwd, "UserPromptSubmit", undefined, {
            prompt: event.text,
        })) {
            const reason = blocking(result);
            if (reason !== null) {
                ctx?.ui?.notify?.(reason, "warning");
                return { action: "handled" };
            }
            const note = context(result);
            if (note) added.push(note);
        }
        if (added.length === 0) return { action: "continue" };
        return { action: "transform", text: [event.text, ...added].join("\n\n") };
    });

    // A stop refused once is let through the next time, as Claude Code's
    // stop_hook_active does -- so a finding nobody can fix cannot loop forever.
    let continued = false;
    pi.on("agent_before_settle", async (event, ctx) => {
        const cwd = cwdOf(ctx);
        const reasons = [];
        for (const result of await run(cwd, "Stop", undefined, { stop_hook_active: continued })) {
            const reason = blocking(result);
            if (reason !== null) reasons.push(reason);
        }
        if (reasons.length === 0 || continued) {
            continued = false;
            return undefined;
        }
        continued = true;
        return {
            entries: [
                ...(event.entries ?? []),
                {
                    type: "custom_message",
                    customType: "claude-hooks-stop",
                    content: reasons.join("\n\n"),
                    display: false,
                },
            ],
            continue: true,
        };
    });

    const SOURCES = {
        startup: "startup",
        reload: "startup",
        new: "clear",
        resume: "resume",
        fork: "resume",
    };
    pi.on("session_start", async (event, ctx) => {
        const source = SOURCES[event.reason] ?? "startup";
        await run(cwdOf(ctx), "SessionStart", source, { source });
    });
    pi.on("session_shutdown", async (_event, ctx) => {
        await run(cwdOf(ctx), "SessionEnd", undefined, {});
    });
    pi.on("session_before_compact", async (_event, ctx) => {
        await run(cwdOf(ctx), "PreCompact", "auto", { trigger: "auto" });
    });
    pi.on("session_compact", async (_event, ctx) => {
        await run(cwdOf(ctx), "PostCompact", "auto", { trigger: "auto" });
    });
}
