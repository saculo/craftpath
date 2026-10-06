/**
 * The hook entry points, run as Claude Code runs them: a subprocess with the
 * event on stdin, judged by its exit code.
 *
 * The Stop hook's contract is that it terminates. It may refuse a stop once,
 * to put a finding in front of the agent, but it must never refuse with a
 * condition the agent cannot resolve -- that is a session that cannot end.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { cleanScratch, scratch } from "../../test/scratch";
import { init } from "../core/init";
import { taskAdd } from "../core/task";
import { workNew } from "../core/work";

afterAll(cleanScratch);

const CLI = new URL("../../bin/craftpath.ts", import.meta.url).pathname;

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
        console.error = err;
    }
}

/** An initialised repo holding one work item per title, each with a task. */
async function repoWith(...titles: string[]): Promise<{ root: string; ids: string[] }> {
    const root = await scratch("craftpath-hook-");
    await quietly(() => init(root));
    for (const title of titles) {
        await quietly(() => workNew(root, title, "light"));
    }
    const ids = (
        await Array.fromAsync(
            new Bun.Glob("*").scan({
                cwd: join(root, ".craftpath/work"),
                onlyFiles: false,
            }),
        )
    )
        .filter((name) => name !== ".gitkeep")
        .sort();
    for (const work of ids) {
        await quietly(() => taskAdd(root, "T001", { title: "Add the endpoint", work }));
    }
    return { root, ids };
}

/** Points one work item's T001 at a task that does not exist. */
async function breakGraph(root: string, work: string): Promise<void> {
    const dir = join(root, ".craftpath/work", work, "tasks");
    const file = (await Array.fromAsync(new Bun.Glob("T001*.md").scan({ cwd: dir })))[0]!;
    const body = await Bun.file(join(dir, file)).text();
    await Bun.write(join(dir, file), body.replace(/depends_on: \[.*\]/, 'depends_on: ["T009"]'));
}

async function hook(
    name: string,
    options: { cwd: string; event?: unknown; env?: Record<string, string> },
): Promise<{ exit: number; stderr: string }> {
    const env: Record<string, string | undefined> = { ...process.env, ...options.env };
    // The test runner may itself run under a harness; its root must not leak in.
    for (const key of ["CRAFTPATH_PROJECT_DIR", "CLAUDE_PROJECT_DIR", "PI_PROJECT_DIR"]) {
        if (!(key in (options.env ?? {}))) delete env[key];
    }
    const p = Bun.spawn([process.execPath, CLI, "hook", name], {
        cwd: options.cwd,
        env,
        stdin: new Blob([JSON.stringify(options.event ?? {})]),
        stdout: "pipe",
        stderr: "pipe",
    });
    const exit = await p.exited;
    return { exit, stderr: await new Response(p.stderr).text() };
}

describe("stop hook terminates", () => {
    test("several sound open work items do not block the stop", async () => {
        const { root } = await repoWith("Avatar upload", "Billing export");

        const { exit, stderr } = await hook("validate", { cwd: root });

        expect(stderr).toBe("");
        expect(exit).toBe(0);
    });

    test("an invalid item among several open ones blocks, naming that item", async () => {
        const { root, ids } = await repoWith("Avatar upload", "Billing export");
        await breakGraph(root, ids[1]!);

        const { exit, stderr } = await hook("validate", { cwd: root });

        expect(exit).toBe(2);
        expect(stderr).toContain(ids[1]!);
        expect(stderr).not.toContain("--work");
    });

    test("a stop already continued by this hook is allowed, finding or not", async () => {
        const { root, ids } = await repoWith("Avatar upload");
        await breakGraph(root, ids[0]!);

        const { exit } = await hook("validate", { cwd: root, event: { stop_hook_active: true } });

        expect(exit).toBe(0);
    });
});

describe("hooks resolve the project root the same way", () => {
    test("validate run from a subdirectory checks the project the harness names", async () => {
        const { root, ids } = await repoWith("Avatar upload");
        await breakGraph(root, ids[0]!);
        const sub = join(root, "src/deep");
        await mkdir(sub, { recursive: true });

        const { exit } = await hook("validate", {
            cwd: sub,
            env: { CLAUDE_PROJECT_DIR: root },
        });

        expect(exit).toBe(2);
    });

    test("guard-bash run from a subdirectory reads the project's gate policy", async () => {
        // init writes requirement = "auto": the agent is told to approve it itself.
        const { root } = await repoWith("Avatar upload");
        const sub = join(root, "src/deep");
        await mkdir(sub, { recursive: true });

        const { exit } = await hook("guard-bash", {
            cwd: sub,
            env: { CLAUDE_PROJECT_DIR: root },
            event: { tool_name: "Bash", tool_input: { command: "craftpath approve requirement" } },
        });

        expect(exit).toBe(0);
    });
});
