/**
 * C3: each grader passes what a step should leave behind and fails what it
 * should not. A script plays the model: the scenario's fixture is built, the
 * step's work is done (or done badly) by hand, and the outcome is collected and
 * graded exactly as after a real run. No model runs here.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type Fixture, fixture, ID, R1, SPEC, WORK } from "./fixture";
import { collect, e1, e2, e3, e4, e5, e6, e7, type Outcome } from "./graders";

const made: Fixture[] = [];
afterAll(() => Promise.all(made.map((fx) => rm(fx.dir, { recursive: true, force: true }))));

async function at(start: Parameters<typeof fixture>[0]): Promise<Fixture> {
    const fx = await fixture(start, "claude-code");
    made.push(fx);
    return fx;
}

const py = (fx: Fixture, ...args: string[]) =>
    Bun.$`python3 ${args}`
        .cwd(fx.tree)
        .env({ ...process.env, PATH: `${fx.stub}:${process.env.PATH}` })
        .quiet();
const write = (fx: Fixture, rel: string, text: string) => Bun.write(join(fx.tree, rel), text);
const head = async (fx: Fixture) =>
    (await Bun.$`git -C ${fx.tree} rev-parse HEAD`.quiet().text()).trim();

async function reviewed(fx: Fixture, points: string): Promise<void> {
    await py(fx, ".craftpath/scripts/review.py", ID);
    await write(
        fx,
        `${WORK}/REVIEW.md`,
        `# C-00001 — Clamp a number: review\n\n- **Reviewed at:** ${await head(fx)}\n\n## Points\n\n${points}\n`,
    );
}

describe("E1 work: both tasks done, one commit each, tests green", () => {
    test("passes when both tasks are implemented and completed", async () => {
        const fx = await at("planned-two");
        await py(fx, ".craftpath/scripts/work.py", ID, "all");
        await write(
            fx,
            "math/src/clamp.ts",
            "export const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);\n",
        );
        await write(
            fx,
            "math/test/clamp.test.ts",
            'import { expect, test } from "bun:test";\nimport { clamp } from "../src/clamp";\ntest("keeps a value inside the range", () => expect(clamp(5, 0, 10)).toBe(5));\n',
        );
        await write(
            fx,
            "greet/src/greet.ts",
            'export const greet = (n: string) => "Hello, " + n + "!";\n',
        );
        await write(
            fx,
            "greet/test/greet.test.ts",
            'import { expect, test } from "bun:test";\nimport { greet } from "../src/greet";\ntest("greets a name", () => expect(greet("Ada")).toBe("Hello, Ada!"));\n',
        );
        await py(fx, ".craftpath/scripts/complete.py", ID, "T-0001");
        await py(fx, ".craftpath/scripts/complete.py", ID, "T-0002");

        expect(e1(await collect(fx))).toEqual({ pass: true, reasons: [] });
    });

    test("fails when nothing was done", async () => {
        const grade = e1(await collect(await at("planned-two")));

        expect(grade.pass).toBe(false);
        expect(grade.reasons).toContain("T-0001 is not ticked");
    });
});

describe("E2 review: an open major point names the missing S3", () => {
    test("passes a review that found it", async () => {
        const fx = await at("done-gap");
        await reviewed(fx, R1);

        expect(e2(await collect(fx))).toEqual({ pass: true, reasons: [] });
    });

    test("fails a review that found nothing", async () => {
        const fx = await at("done-gap");
        await reviewed(fx, "None");

        expect(e2(await collect(fx)).reasons).toContain("no open major point names the missing S3");
    });
});

describe("E3 review again: R1 solved by the fix, nothing else open", () => {
    test("passes R1 marked solved in the fixing commit", async () => {
        const fx = await at("gap-fixed");
        await reviewed(fx, `${R1.replace("- [ ]", "- [x]")} (solved in ${fx.fixSha?.slice(0, 7)})`);

        expect(e3(await collect(fx))).toEqual({ pass: true, reasons: [] });
    });

    test("fails R1 left open", async () => {
        const fx = await at("gap-fixed");
        await reviewed(fx, R1);

        expect(e3(await collect(fx)).reasons).toContain("R1 is not marked solved");
    });
});

const ADR = `- [ ] K1 [ADR] Refuse an empty clamp range
  - **Context:** swapping the bounds hid wrong-order calls.
  - **Decision:** clamp throws a RangeError when min > max.
  - **Consequences:** callers must order the bounds.`;
const LINE = "- [ ] K2 [CLAUDE.md] Run `bun test` from the repository root.";
const knowledge = (...candidates: string[]) =>
    `# C-00001 — Clamp a number: knowledge\n\n## Candidates\n\n${candidates.join("\n\n")}\n`;

describe("E4 learn: an ADR and an instruction line, at most three", () => {
    test("passes the two planted candidates", async () => {
        const fx = await at("done-notes");
        await py(fx, ".craftpath/scripts/learn.py", ID);
        await write(fx, `${WORK}/KNOWLEDGE.md`, knowledge(ADR, LINE));

        expect(e4(await collect(fx))).toEqual({ pass: true, reasons: [] });
    });

    test("fails four candidates without the ADR", async () => {
        const fx = await at("done-notes");
        await py(fx, ".craftpath/scripts/learn.py", ID);
        const lines = [1, 2, 3, 4].map(
            (n) => `- [ ] K${n} [CLAUDE.md] Run \`bun test\` from the root, take ${n}.`,
        );
        await write(fx, `${WORK}/KNOWLEDGE.md`, knowledge(...lines));

        const { reasons } = e4(await collect(fx));
        expect(reasons).toContain("no ADR candidate for throwing instead of swapping the bounds");
        expect(reasons).toContain("4 candidates; at most 3 were worth proposing");
    });
});

describe("E5 learn-apply and pr: the ADR, the line, the PR with its knowledge", () => {
    test("passes once both steps' scripts have run", async () => {
        const fx = await at("ticked");
        await py(fx, ".craftpath/scripts/learn-apply.py", ID);
        await py(fx, ".craftpath/scripts/pr.py", ID);

        expect(e5(await collect(fx))).toEqual({ pass: true, reasons: [] });
    });

    test("fails when no PR was opened", async () => {
        const fx = await at("ticked");
        await py(fx, ".craftpath/scripts/learn-apply.py", ID);

        expect(e5(await collect(fx)).reasons).toContain("no pull request was opened");
    });
});

describe("E6 the whole flow: every file complete, every task done, tests green", () => {
    const outcome = (plan: string, testsGreen = true): Outcome => ({
        files: { [`${WORK}/PLAN.md`]: plan },
        commits: [],
        checks: { spec: 0, plan: 0, review: 0 },
        testsGreen,
        gh: { calls: "", body: "" },
    });

    test("passes a finished flow", () => {
        expect(e6(outcome("## Tasks\n\n### Wave 1\n\n- [x] T-0001 — Add clamp\n"))).toEqual({
            pass: true,
            reasons: [],
        });
    });

    test("fails an open task, red tests and a missing review", () => {
        const o = outcome("## Tasks\n\n### Wave 1\n\n- [ ] T-0001 — Add clamp\n", false);
        delete o.checks.review;

        const { reasons } = e6(o);
        expect(reasons).toContain("check.py review fails or its file is missing");
        expect(reasons).toContain("tasks not done: - [ ] T-0001 — Add clamp");
        expect(reasons).toContain("the modules' tests are not green");
    });
});

describe("E7 revise the spec: answers worked in, nothing open, one work item", () => {
    test("passes the answers worked into the spec", async () => {
        const fx = await at("spec-open");
        await py(fx, ".craftpath/scripts/spec.py", ID);
        await write(
            fx,
            `${WORK}/SPEC.md`,
            SPEC.replace("Non-numeric input.", "Non-numeric input, NaN included."),
        );

        expect(e7(await collect(fx))).toEqual({ pass: true, reasons: [] });
    });

    test("fails a spec left as it was", async () => {
        const fx = await at("spec-open");

        const { reasons } = e7(await collect(fx));
        expect(reasons).toContain("open questions are left");
        expect(reasons).toContain("no scenario says min > max throws a RangeError");
    });

    test("fails when the answers started a second work item", async () => {
        const fx = await at("spec-open");
        await py(fx, ".craftpath/scripts/spec.py", "Clamp answers");

        expect(e7(await collect(fx)).reasons).toContain("2 work items, not 1");
    });
});
