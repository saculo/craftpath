/**
 * `task next` and `task report`: the CLI decides and records, the harness runs.
 *
 * The CLI is a deterministic manager of files and state. It never launches an
 * agent: `next` picks and starts the task and hands back its brief, the
 * harness's own agent runs the worker, and `report` validates and records what
 * that worker said.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TaskState } from "../schema";
import { CLAUDE_CODE } from "../harness/claude-code";
import { render } from "../harness/render";
import { COMMANDS } from "../commands";
import { approvePlan } from "../../test/gates";
import { cleanScratch, scratch } from "../../test/scratch";
import { init } from "./init";
import { taskAdd } from "./task";
import { workNew } from "./work";

afterAll(cleanScratch);

const WORK = "W-0001-avatar-upload";
const CLI = join(import.meta.dir, "../../bin/craftpath.ts");

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
    }
}

async function planned(approved = true): Promise<string> {
    const root = await scratch("craftpath-next-");
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await quietly(() => taskAdd(root, "T001", { title: "Add avatar upload", skills: ["backend"] }));
    await quietly(() =>
        taskAdd(root, "T002", { title: "Add avatar removal", skills: ["backend"] }),
    );
    if (approved) await approvePlan(root);
    return root;
}

async function cli(
    root: string,
    ...args: string[]
): Promise<{ exit: number; out: string; err: string }> {
    const p = Bun.spawn([process.execPath, CLI, ...args], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
    });
    const out = await new Response(p.stdout).text();
    const err = await new Response(p.stderr).text();
    return { exit: await p.exited, out, err };
}

const state = async (root: string, id: string) =>
    TaskState.parse(await Bun.file(join(root, ".craftpath/state", WORK, `${id}.json`)).json());

async function report(root: string, id: string, text: string) {
    const file = join(root, "outcome.txt");
    await Bun.write(file, text);
    return cli(root, "task", "report", id, "--work", WORK, "--outcome-file", file);
}

const BLOCKED =
    '<craftpath-outcome>{"status":"blocked","summary":"Needs a key.","blocker":"no API key"}</craftpath-outcome>';

describe("task next decides, and runs nothing", () => {
    test("it starts the next eligible task and prints its brief", async () => {
        const root = await planned();

        const { exit, out } = await cli(root, "task", "next", "--work", WORK);

        expect(exit).toBe(0);
        const brief = JSON.parse(out);
        expect(brief).toMatchObject({
            status: "started",
            workId: WORK,
            taskId: "T001",
            skills: ["backend"],
            taskFile: `.craftpath/work/${WORK}/tasks/T001-backend.md`,
            requirement: `.craftpath/work/${WORK}/requirement.md`,
            inputs: [],
        });
        expect(brief.outcome).toContain("<craftpath-outcome>");
        expect((await state(root, "T001")).status).toBe("in_progress");
    });

    test("it refuses while the plan gate is pending", async () => {
        const root = await planned(false);

        const { exit } = await cli(root, "task", "next", "--work", WORK);

        expect(exit).toBe(2);
        expect((await state(root, "T001")).status).toBe("pending");
    });

    test("with every eligible task held, it is idle and names them", async () => {
        const root = await planned();
        await cli(root, "task", "next", "--work", WORK);
        await report(root, "T001", BLOCKED);
        await cli(root, "task", "next", "--work", WORK);
        await report(root, "T002", BLOCKED);

        const { exit, out } = await cli(root, "task", "next", "--work", WORK);

        expect(exit).toBe(0);
        expect(JSON.parse(out)).toEqual({
            status: "idle",
            held: [
                { taskId: "T001", status: "blocked", reason: "no API key" },
                { taskId: "T002", status: "blocked", reason: "no API key" },
            ],
        });
    });
});

describe("task report records what the worker said", () => {
    test("a valid outcome is recorded, and next moves on", async () => {
        const root = await planned();
        await cli(root, "task", "next", "--work", WORK);

        const recorded = await report(root, "T001", BLOCKED);
        const next = await cli(root, "task", "next", "--work", WORK);

        expect(recorded.exit).toBe(0);
        expect(JSON.parse(recorded.out)).toEqual({
            status: "blocked",
            taskId: "T001",
            reason: "no API key",
        });
        expect((await state(root, "T001")).attempts).toHaveLength(1);
        expect(JSON.parse(next.out)).toMatchObject({ taskId: "T002" });
    });

    test("output without the envelope is recorded as a failed attempt", async () => {
        const root = await planned();
        await cli(root, "task", "next", "--work", WORK);

        const recorded = await report(root, "T001", "How can I help?");

        expect(JSON.parse(recorded.out)).toEqual({
            status: "failed",
            taskId: "T001",
            reason: "missing <craftpath-outcome> envelope",
        });
        expect((await state(root, "T001")).attempts[0]).toMatchObject({ status: "failed" });
    });

    test("a second report for an unanswered outcome is refused", async () => {
        const root = await planned();
        await cli(root, "task", "next", "--work", WORK);
        await report(root, "T001", BLOCKED);

        const again = await report(root, "T001", BLOCKED);

        expect(again.exit).toBe(2);
        expect((await state(root, "T001")).attempts).toHaveLength(1);
    });

    test("a task that was never started cannot be reported", async () => {
        const root = await planned();

        const { exit } = await report(root, "T001", BLOCKED);

        expect(exit).toBe(2);
    });
});

describe("the work command drives the loop through next and report", () => {
    test("its task loop asks next for the task and reports the worker's outcome", () => {
        const text = render(COMMANDS["work.md"]!, CLAUDE_CODE);
        expect(text).toContain("craftpath task next --work <work-id>");
        expect(text).toContain("craftpath task report <id> --work <work-id> --outcome-file <file>");
    });
});
