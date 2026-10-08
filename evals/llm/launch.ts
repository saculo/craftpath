/**
 * Launching the real harnesses, headless.
 *
 * Craftpath never runs an agent; this is the eval runner doing it, in a
 * throwaway fixture repository. Permissions are bypassed because nobody is
 * there to answer a prompt -- the fixture is the sandbox.
 */
import { join } from "node:path";
import { scratch } from "../../test/scratch";

/** One thing the agent did, normalised across harnesses. */
export type Event =
    | { kind: "tool"; name: string; input: Record<string, unknown> }
    | { kind: "text"; text: string }
    | { kind: "raw"; event: unknown };

export interface RunOptions {
    root: string;
    prompt: string;
    model?: string;
    budget: { turns: number; usd: number; minutes: number };
    env: Record<string, string>;
    signal: AbortSignal;
}

export interface RunOutput {
    exit: number;
    events: Event[];
    /** Null when the harness does not report a cost. */
    costUsd: number | null;
    turns: number;
}

export interface Launcher {
    harness: "claude-code" | "pi";
    /** Harness-specific setup inside the fixture, before the run. */
    prepare?(root: string, env: Record<string, string>): Promise<void>;
    run(options: RunOptions): Promise<RunOutput>;
}

/**
 * A `craftpath` first on PATH that runs this checkout.
 *
 * Hooks and the agent call `craftpath` by name, and the one installed globally
 * is whatever release was last installed -- not the code under evaluation.
 */
export async function craftpathShim(): Promise<string> {
    const dir = await scratch("craftpath-shim-");
    const bin = new URL("../../bin/craftpath.ts", import.meta.url).pathname;
    await Bun.write(
        join(dir, "craftpath"),
        `#!/bin/sh\nexec "${process.execPath}" "${bin}" "$@"\n`,
    );
    await Bun.$`chmod +x ${join(dir, "craftpath")}`;
    return dir;
}

/** Lines of a child's stdout, as they arrive. */
async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
            yield buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
        }
    }
    if (buffer.trim() !== "") yield buffer;
}

/** Claude Code's stream-json, normalised. */
export function claudeEvents(message: Record<string, unknown>): Event[] {
    if (message.type !== "assistant") return [];
    const content = (message.message as { content?: unknown[] } | undefined)?.content ?? [];
    return content.flatMap((part): Event[] => {
        const p = part as {
            type?: string;
            name?: string;
            input?: Record<string, unknown>;
            text?: string;
        };
        if (p.type === "tool_use")
            return [{ kind: "tool", name: p.name ?? "", input: p.input ?? {} }];
        if (p.type === "text" && p.text) return [{ kind: "text", text: p.text }];
        return [];
    });
}

export const CLAUDE: Launcher = {
    harness: "claude-code",
    async run({ root, prompt, model, budget, env, signal }) {
        const child = Bun.spawn(
            [
                "claude",
                "-p",
                prompt,
                "--output-format",
                "stream-json",
                "--verbose",
                "--dangerously-skip-permissions",
                "--no-session-persistence",
                "--max-budget-usd",
                String(budget.usd),
                ...(model ? ["--model", model] : []),
            ],
            { cwd: root, env, stdout: "pipe", stderr: "pipe" },
        );
        const stop = () => child.kill("SIGTERM");
        signal.addEventListener("abort", stop, { once: true });

        const events: Event[] = [];
        let turns = 0;
        let costUsd: number | null = null;
        for await (const line of lines(child.stdout)) {
            let message: Record<string, unknown>;
            try {
                message = JSON.parse(line);
            } catch {
                continue;
            }
            if (message.type === "assistant") turns++;
            events.push(...claudeEvents(message));
            if (message.type === "result") {
                costUsd =
                    typeof message.total_cost_usd === "number" ? message.total_cost_usd : null;
            }
            // This version of claude has no --max-turns: the cap is enforced here.
            if (turns > budget.turns) stop();
        }
        signal.removeEventListener("abort", stop);
        return { exit: await child.exited, events, costUsd, turns };
    },
};

/**
 * pi, headless. Its json event format has not been recorded yet (the spike is
 * pending), so events are kept raw and cost is not reported: graders that
 * read the trace are claude-only until the normaliser exists.
 */
export const PI: Launcher = {
    harness: "pi",
    async prepare(root, env) {
        const installed = await Bun.$`pi install -l npm:pi-subagents-lite`
            .cwd(root)
            .env(env)
            .quiet()
            .nothrow();
        if (installed.exitCode !== 0) {
            throw new Error(
                `pi install -l npm:pi-subagents-lite failed: ${installed.stderr.toString().trim()}`,
            );
        }
    },
    async run({ root, prompt, model, env, signal }) {
        const child = Bun.spawn(
            [
                "pi",
                "-p",
                "--mode",
                "json",
                "--no-session",
                ...(model ? ["--model", model] : []),
                prompt,
            ],
            {
                cwd: root,
                env,
                stdout: "pipe",
                stderr: "pipe",
            },
        );
        const stop = () => child.kill("SIGTERM");
        signal.addEventListener("abort", stop, { once: true });
        const events: Event[] = [];
        for await (const line of lines(child.stdout)) {
            try {
                events.push({ kind: "raw", event: JSON.parse(line) });
            } catch {
                // not an event
            }
        }
        signal.removeEventListener("abort", stop);
        return { exit: await child.exited, events, costUsd: null, turns: 0 };
    },
};
