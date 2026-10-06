import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TaskState } from "../schema";
import { cleanScratch, scratch } from "../../test/scratch";
import { advance } from "./advance";
import { init } from "./init";
import { taskAdd } from "./task";
import { workNew } from "./work";

afterAll(cleanScratch);

const WORK = "W-0001-avatar-upload";

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
    }
}

async function repoWithTask(): Promise<string> {
    const root = await scratch("craftpath-advance-");
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await quietly(() =>
        taskAdd(root, "T001", { title: "Add avatar upload", produces: ["design.md"] }),
    );
    return root;
}

describe("task advance", () => {
    test("generic worker output is a recorded failed attempt", async () => {
        const root = await repoWithTask();

        const result = await advance(root, async () => "How can I help?");

        expect(result).toEqual({
            status: "failed",
            taskId: "T001",
            reason: "missing <craftpath-outcome> envelope",
        });
        const state = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "T001.json")).json(),
        );
        expect(state.status).toBe("in_progress");
        expect(state.attempts).toHaveLength(1);
        expect(state.attempts[0]).toMatchObject({
            status: "failed",
            summary: "How can I help?",
            reason: "missing <craftpath-outcome> envelope",
        });
    });

    test("never advances a different selected work id", async () => {
        const root = await repoWithTask();
        await quietly(() => workNew(root, "Billing", "light"));
        await quietly(() => taskAdd(root, "T001", { title: "Add billing", work: "W-0002" }));

        const result = await advance(
            root,
            async () =>
                '<craftpath-outcome>{"status":"blocked","summary":"Need a decision.","blocker":"Choose the billing provider."}</craftpath-outcome>',
            "W-0002",
        );

        expect(result).toEqual({
            status: "blocked",
            taskId: "T001",
            reason: "Choose the billing provider.",
        });
        const first = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "T001.json")).json(),
        );
        expect(first.status).toBe("pending");
        const second = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", "W-0002-billing", "T001.json")).json(),
        );
        expect(second.status).toBe("in_progress");
        expect(second.attempts[0]).toMatchObject({ status: "blocked" });
    });

    test("passes only declared dependency artifacts and still requires verification", async () => {
        const root = await repoWithTask();
        await quietly(() =>
            taskAdd(root, "T002", {
                title: "Use the design",
                skills: ["frontend"],
                dependsOn: ["T001"],
            }),
        );
        const first = join(root, ".craftpath/state", WORK, "T001.json");
        const state = TaskState.parse(await Bun.file(first).json());
        await Bun.write(first, JSON.stringify({ ...state, status: "done" }));
        await Bun.write(join(root, "design.md"), "chosen design\n");
        await Bun.write(join(root, "unrelated.md"), "do not preload\n");

        let input: unknown;
        let skills: unknown;
        const result = await advance(root, async (brief) => {
            input = brief.inputs;
            skills = brief.skills;
            return '<craftpath-outcome>{"status":"completed","summary":"Implemented the selected task."}</craftpath-outcome>';
        });

        expect(result).toEqual({ status: "completed", taskId: "T002", reason: undefined });
        expect(input).toEqual([{ path: "design.md", content: "chosen design\n" }]);
        expect(skills).toEqual(["frontend"]);
        const second = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "T002.json")).json(),
        );
        expect(second.status).toBe("in_progress");
        expect(second.attempts).toHaveLength(1);
        expect(second.attempts[0]).toMatchObject({ status: "completed" });
    });
});
