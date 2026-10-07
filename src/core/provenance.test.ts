/**
 * Approval provenance, and the harness path for manual acknowledgements.
 *
 * `--harness-approval` marks a sign-off that came through a user-invoked
 * harness command. It is recorded as `via: "harness"` for the audit trail --
 * and only that: an agent's shell can type the same flag, so it is not proof
 * that a person approved anything.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { TaskState, WorkState } from "../schema";
import { CLAUDE_CODE } from "../harness/claude-code";
import { PI } from "../harness/pi";
import { render } from "../harness/render";
import { COMMANDS } from "../commands";
import { cleanScratch, scratch } from "../../test/scratch";
import { approvePlan } from "../../test/gates";
import { approve } from "./approve";
import { init } from "./init";
import { taskAck, taskAdd, taskStart } from "./task";
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

async function repo(): Promise<string> {
    const root = await scratch("craftpath-provenance-");
    await Bun.$`git -C ${root} init -q -b master`.quiet();
    await Bun.$`git -C ${root} config user.email dev@example.com`.quiet();
    await quietly(() => init(root));
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await quietly(() =>
        taskAdd(root, "D001", {
            title: "Decide the crop interaction",
            design: "ux",
            designReason: "three viable crop models, and the choice changes the API",
            produces: ["design.md"],
        }),
    );
    return root;
}

const work = async (root: string) =>
    WorkState.parse(await Bun.file(join(root, ".craftpath/state", WORK, "work.json")).json());

describe("a harness approval is recorded as one", () => {
    test("approve --harness-approval records via harness, signed by the repo's git email", async () => {
        const root = await repo();
        await quietly(() => approve(root, "requirement"));

        // plan is `manual`, and there is no terminal and no --approver.
        await quietly(() => approve(root, "plan", { harnessApproval: true, interactive: false }));

        expect((await work(root)).approvals.at(-1)).toMatchObject({
            phase: "plan",
            via: "harness",
            by: "dev@example.com",
        });
    });

    test("an acknowledgement through the harness command is recorded as one", async () => {
        const root = await repo();
        await approvePlan(root);
        await quietly(() => taskStart(root, "D001"));

        await quietly(() => taskAck(root, "D001", "A1", undefined, { harnessApproval: true }));

        const state = TaskState.parse(
            await Bun.file(join(root, ".craftpath/state", WORK, "D001.json")).json(),
        );
        expect(state.acks.at(-1)).toMatchObject({ criterion_id: "A1", via: "harness" });
    });
});

describe("manual criteria have a harness path", () => {
    for (const harness of [CLAUDE_CODE, PI]) {
        test(`the ack command records the selected criterion, then resumes (${harness.id})`, () => {
            const ack = COMMANDS["ack.md"];
            expect(ack).toBeDefined();
            const text = render(ack!, harness);
            expect(text).toContain(
                "craftpath task ack <task> <criterion> --work <work-id> --harness-approval",
            );
            expect(text).toContain(harness.invocation("work"));
        });
    }

    test("the work command stops for a manual criterion and names the ack command", () => {
        const text = render(COMMANDS["work.md"]!, CLAUDE_CODE);
        expect(text).toContain(`${CLAUDE_CODE.invocation("ack")} <task> <criterion> <work-id>`);
    });
});
