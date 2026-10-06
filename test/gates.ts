/**
 * Fixtures for work that has passed G1 and G2.
 *
 * `task start` and `task done` refuse while the plan gate is pending, so a
 * test about execution first records the approvals execution needs -- through
 * `approve` itself, never by writing work.json, so the fixture cannot drift
 * from what the kernel accepts.
 */
import { approve, gateState } from "../src/core/approve";
import { taskStart } from "../src/core/task";
import { readOpenWork } from "../src/core/work";

async function quietly(fn: () => Promise<void>): Promise<void> {
    const log = console.log;
    console.log = () => {};
    try {
        await fn();
    } finally {
        console.log = log;
    }
}

/** Approves requirement and plan for the selected work item, if pending. */
export async function approvePlan(root: string, work?: string): Promise<void> {
    const state = (await readOpenWork(root, work))!;
    for (const gate of ["requirement", "plan"] as const) {
        if (gateState(state.approvals, gate, state.amendments) === "approved") continue;
        await quietly(() => approve(root, gate, { work, approver: "reviewer@example.com" }));
    }
}

/** `taskStart` on work whose plan is approved. */
export async function startTask(root: string, id: string, work?: string): Promise<void> {
    await approvePlan(root, work);
    await taskStart(root, id, work);
}
