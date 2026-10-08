/**
 * craftpath's Claude-compatible hooks for pi.
 *
 * The extension reads the `hooks` block of `.pi/settings.json` -- the same
 * format as Claude Code's `.claude/settings.json` -- and runs the hooks on the
 * matching pi events, giving each command the JSON Claude Code would and
 * honouring its answer the way Claude Code does. Tool names and inputs are
 * translated to Claude Code's (`bash` -> `Bash`, `path` -> `file_path`), so
 * one configuration and one set of hook scripts serve both harnesses.
 *
 * Tested as shipped: the asset is imported and handed a fake `pi`, and the
 * hooks are real shell scripts in a scratch project.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch, scratch } from "../scratch";

afterAll(cleanScratch);

const EXTENSION = new URL("../../assets/pi/claude-hooks.ts", import.meta.url).pathname;

type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;

/** A project whose `.pi/settings.json` has `hooks`, each hook a shell script body. */
async function project(hooks: Record<string, { matcher?: string; script: string }[]>) {
    const root = await scratch("craftpath-hooks-");
    const config: Record<string, unknown[]> = {};
    let n = 0;
    for (const [event, entries] of Object.entries(hooks)) {
        config[event] = [];
        for (const { matcher, script } of entries) {
            const path = join(root, `hook-${n++}.sh`);
            await Bun.write(path, `#!/bin/sh\n${script}\n`);
            await Bun.$`chmod +x ${path}`;
            config[event]!.push({
                ...(matcher === undefined ? {} : { matcher }),
                hooks: [{ type: "command", command: path }],
            });
        }
    }
    await Bun.write(join(root, ".pi/settings.json"), JSON.stringify({ hooks: config }));
    const mod = await import(EXTENSION);
    const handlers = new Map<string, Handler>();
    const notes: string[] = [];
    mod.default({ on: (name: string, handler: Handler) => handlers.set(name, handler) });
    const ctx = { cwd: root, ui: { notify: (m: string) => notes.push(m) } };
    const fire = (name: string, event: Record<string, unknown>) => handlers.get(name)!(event, ctx);
    const seen = async () =>
        (await Bun.file(join(root, "seen.jsonl")).exists())
            ? (await Bun.file(join(root, "seen.jsonl")).text())
                  .trim()
                  .split("\n")
                  .map((l) => JSON.parse(l))
            : [];
    return { root, fire, seen, notes };
}

/** A hook that records the JSON it was given. */
const RECORD = 'cat >> "$(dirname "$0")/seen.jsonl"; echo >> "$(dirname "$0")/seen.jsonl"';

describe("PreToolUse <- tool_call", () => {
    test("gets Claude Code's JSON, with pi's tool and input translated", async () => {
        const { root, fire, seen } = await project({
            PreToolUse: [{ matcher: "Bash|Write|Edit", script: RECORD }],
        });

        await fire("tool_call", { toolName: "bash", input: { command: "ls -la" } });
        await fire("tool_call", { toolName: "write", input: { path: "a.ts", content: "x" } });
        await fire("tool_call", {
            toolName: "edit",
            input: { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] },
        });

        const events = await seen();
        expect(events.map((e) => [e.hook_event_name, e.tool_name, e.tool_input])).toEqual([
            ["PreToolUse", "Bash", { command: "ls -la" }],
            ["PreToolUse", "Write", { file_path: "a.ts", content: "x" }],
            ["PreToolUse", "Edit", { file_path: "a.ts", old_string: "x", new_string: "y" }],
        ]);
        expect(events[0].cwd).toBe(root);
    });

    test("a matcher that does not match runs nothing", async () => {
        const { fire, seen } = await project({ PreToolUse: [{ matcher: "Bash", script: RECORD }] });

        expect(
            await fire("tool_call", { toolName: "read", input: { path: "a.ts" } }),
        ).toBeUndefined();
        expect(await seen()).toEqual([]);
    });

    test("exit 2 blocks the call, with stderr as the reason", async () => {
        const { fire } = await project({
            PreToolUse: [{ matcher: "Bash", script: 'echo "not allowed" >&2; exit 2' }],
        });

        expect(
            await fire("tool_call", { toolName: "bash", input: { command: "rm -rf /" } }),
        ).toEqual({
            block: true,
            reason: "not allowed",
        });
    });

    test("permissionDecision deny blocks the call, with its reason", async () => {
        const deny = `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"SPEC.md is not complete"}}'`;
        const { fire } = await project({ PreToolUse: [{ matcher: "Bash", script: deny }] });

        expect(await fire("tool_call", { toolName: "bash", input: { command: "x" } })).toEqual({
            block: true,
            reason: "SPEC.md is not complete",
        });
    });

    test("updatedInput rewrites the call, translated back to pi's shape", async () => {
        const update = `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"file_path":"b.ts","content":"y"}}}'`;
        const { fire } = await project({ PreToolUse: [{ matcher: "Write", script: update }] });
        const event = { toolName: "write", input: { path: "a.ts", content: "x" } };

        expect(await fire("tool_call", event)).toBeUndefined();
        expect(event.input).toEqual({ path: "b.ts", content: "y" });
    });

    test("hook commands see CLAUDE_PROJECT_DIR, so Claude Code's hook lines work unchanged", async () => {
        const { root, fire } = await project({
            PreToolUse: [{ matcher: "Bash", script: 'echo "$CLAUDE_PROJECT_DIR" >&2; exit 2' }],
        });

        expect(await fire("tool_call", { toolName: "bash", input: { command: "x" } })).toEqual({
            block: true,
            reason: root,
        });
    });
});

describe("PostToolUse <- tool_result", () => {
    test("exit 2 puts stderr in front of the model, after the tool's own output", async () => {
        const { fire } = await project({
            PostToolUse: [{ matcher: "Bash", script: 'echo "lint failed" >&2; exit 2' }],
        });

        const result = (await fire("tool_result", {
            toolName: "bash",
            input: { command: "x" },
            content: [{ type: "text", text: "ok" }],
            isError: false,
        })) as { content: { text: string }[] };

        expect(result.content.map((c) => c.text)).toEqual(["ok", "lint failed"]);
    });
});

describe("UserPromptSubmit <- input", () => {
    test("exit 2 blocks the prompt and tells the user why", async () => {
        const { fire, notes } = await project({
            UserPromptSubmit: [{ script: 'echo "no secrets" >&2; exit 2' }],
        });

        expect(await fire("input", { text: "my key is ...", source: "interactive" })).toEqual({
            action: "handled",
        });
        expect(notes).toContain("no secrets");
    });

    test("stdout is added to the prompt as context", async () => {
        const { fire } = await project({ UserPromptSubmit: [{ script: 'echo "branch: main"' }] });

        expect(await fire("input", { text: "hi", source: "interactive" })).toEqual({
            action: "transform",
            text: "hi\n\nbranch: main",
        });
    });

    test("with no hook, the prompt continues untouched", async () => {
        const { fire } = await project({});

        expect(await fire("input", { text: "hi", source: "interactive" })).toEqual({
            action: "continue",
        });
    });
});

describe("Stop <- agent_before_settle", () => {
    test("exit 2 continues the agent once with the reason, then lets the next stop through", async () => {
        const { fire, seen } = await project({
            Stop: [{ script: `${RECORD}; echo "tests are red" >&2; exit 2` }],
        });

        const first = (await fire("agent_before_settle", { entries: [] })) as {
            continue: boolean;
            entries: { content: string }[];
        };
        const second = await fire("agent_before_settle", { entries: [] });

        expect(first.continue).toBe(true);
        expect(first.entries.at(-1)!.content).toContain("tests are red");
        expect(second).toBeUndefined();
        expect((await seen()).map((e) => e.stop_hook_active)).toEqual([false, true]);
    });
});

describe("session events", () => {
    test("SessionStart and SessionEnd run on session_start and session_shutdown", async () => {
        const { fire, seen } = await project({
            SessionStart: [{ script: RECORD }],
            SessionEnd: [{ script: RECORD }],
        });

        await fire("session_start", { reason: "startup" });
        await fire("session_shutdown", {});

        expect((await seen()).map((e) => [e.hook_event_name, e.source ?? null])).toEqual([
            ["SessionStart", "startup"],
            ["SessionEnd", null],
        ]);
    });
});
