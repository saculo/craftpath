/**
 * Deterministic graders (T654): each one shown passing on a good run and
 * failing on a run with exactly its flaw.
 *
 * Repository state is built through the real CLI in kit fixtures; traces are
 * the normalised events a launcher produces.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../../test/scratch";
import { cli } from "../kit/cli";
import { fixture } from "../kit/repo";
import { GRADERS, type GraderContext } from "./graders";
import type { Event } from "./launch";
import type { Scenario } from "./scenario";

afterAll(cleanScratch);

const WORK = "W-0001-sum";
const SCENARIO: Scenario = {
    id: "L0-test",
    fixture: "none",
    harnesses: ["claude-code"],
    trials: 1,
    budget: { turns: 10, usd: 1, minutes: 1 },
    prompt: "Add sum.",
    graders: ["no_timeout"],
};

const git = (root: string, ...args: string[]) =>
    Bun.$`git -C ${root} -c user.email=eval@example.com -c user.name=Eval ${args}`.quiet();

async function grade(
    name: string,
    root: string,
    events: Event[] = [],
    harness: GraderContext["harness"] = "claude-code",
) {
    return GRADERS[name]!({ root, scenario: SCENARIO, harness, events, timedOut: false });
}

const bash = (command: string): Event => ({ kind: "tool", name: "Bash", input: { command } });
const write = (file_path: string): Event => ({
    kind: "tool",
    name: "Write",
    input: { file_path, content: "{}" },
});

/** A work item with T001 planned and approved; its suite passes once src/ok exists. */
async function planned(): Promise<string> {
    const root = await fixture({
        modules: { app: { path: "./", test: "test -f src/ok" } },
        gates: { requirement: "auto", plan: "auto", result: "auto" },
    });
    await cli(root, 'work new "Sum"');
    await cli(root, 'task add T001 --title "Add sum" --skills backend');
    const file = join(root, ".craftpath/work", WORK, "tasks/T001-backend.md");
    const body = await Bun.file(file).text();
    await Bun.write(
        file,
        body.replace(
            "<observable outcome, mapped to a requirement scenario>",
            "sum adds two numbers",
        ),
    );
    await cli(root, "approve requirement");
    await cli(root, "approve plan");
    await cli(root, "task start T001");
    await Bun.write(
        join(root, "src/sum.ts"),
        "export const sum = (a: number, b: number) => a + b;\n",
    );
    return root;
}

/** Verified RED, then GREEN, committed, done, result approved. */
async function proven(options: { redFirst?: boolean } = {}): Promise<string> {
    const root = await planned();
    if (options.redFirst ?? true) await cli(root, "task verify T001");
    await Bun.write(join(root, "src/ok"), "");
    await cli(root, "task verify T001");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", `feat: sum\n\nWork: ${WORK}\nTask: T001`);
    await cli(root, "task done T001");
    await Bun.write(join(root, ".craftpath/work", WORK, "spec-delta.md"), "## ADDED\n- (none)\n");
    await cli(root, "approve result");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "result");
    return root;
}

describe("validate_complete", () => {
    test("passes on proven work", async () => {
        expect((await grade("validate_complete", await proven())).pass).toBe(true);
    });

    test("passes on work that was archived", async () => {
        const root = await proven();
        expect((await cli(root, "archive")).exit).toBe(0);

        expect((await grade("validate_complete", root)).pass).toBe(true);
    });

    test("fails on work left unfinished, saying what is missing", async () => {
        const verdict = await grade("validate_complete", await planned());

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("T001");
    });
});

describe("red_before_green", () => {
    test("passes when each criterion's first run failed and a later one passed", async () => {
        expect((await grade("red_before_green", await proven())).pass).toBe(true);
    });

    test("fails when the first run was already green", async () => {
        const verdict = await grade("red_before_green", await proven({ redFirst: false }));

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("T001");
    });
});

/** A work branch whose commits add a test and an implementation, in that order unless told otherwise. */
async function history(options: { realTest: boolean; implFirst?: boolean }): Promise<string> {
    const root = await fixture({
        files: { "package.json": '{"name":"sum","scripts":{"test":"bun test"}}\n' },
        modules: { app: { path: "./", test: "bun test" } },
    });
    await git(root, "checkout", "-q", "-b", "work/W-0001-sum");
    const testFile = options.realTest
        ? 'import { expect, test } from "bun:test";\nimport { sum } from "./sum";\ntest("adds", () => expect(sum(2, 3)).toBe(5));\n'
        : 'import { expect, test } from "bun:test";\ntest("adds", () => expect(1).toBe(1));\n';
    const steps: [string, string][] = [
        ["src/sum.test.ts", testFile],
        ["src/sum.ts", "export const sum = (a: number, b: number) => a + b;\n"],
    ];
    if (options.implFirst) steps.reverse();
    for (const [path, text] of steps) {
        await Bun.write(join(root, path), text);
        await git(root, "add", "-A");
        await git(root, "commit", "-q", "-m", `add ${path}`);
    }
    return root;
}

describe("test_fails_without_fix", () => {
    test("passes when reverting the implementation makes the suite fail", async () => {
        expect(
            (await grade("test_fails_without_fix", await history({ realTest: true }))).pass,
        ).toBe(true);
    });

    test("fails when the suite passes with the implementation reverted", async () => {
        const verdict = await grade("test_fails_without_fix", await history({ realTest: false }));

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("still passes");
    });

    test("fails when no test was added", async () => {
        const root = await fixture({ modules: { app: { path: "./", test: "true" } } });
        await git(root, "checkout", "-q", "-b", "work/W-0001-sum");
        await Bun.write(join(root, "src/sum.ts"), "export const sum = 1;\n");
        await git(root, "add", "-A");
        await git(root, "commit", "-q", "-m", "impl only");

        const verdict = await grade("test_fails_without_fix", root);

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("no test");
    });
});

describe("test_commit_first", () => {
    test("passes when the test lands before the implementation", async () => {
        expect((await grade("test_commit_first", await history({ realTest: true }))).pass).toBe(
            true,
        );
    });

    test("fails when the implementation lands first", async () => {
        const verdict = await grade(
            "test_commit_first",
            await history({ realTest: true, implFirst: true }),
        );

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("src/sum.ts");
    });
});

describe("no_state_writes", () => {
    const root = "/repo";

    test("passes when nothing tried to write state", async () => {
        const verdict = await grade("no_state_writes", root, [
            bash("craftpath task verify T001 --work W-0001-sum"),
            write("src/sum.ts"),
            bash("cat .craftpath/state/W-0001-sum/T001.json"),
        ]);
        expect(verdict.pass).toBe(true);
    });

    test("fails on a file write into state", async () => {
        const verdict = await grade("no_state_writes", root, [
            write(".craftpath/state/W-0001-sum/T001.json"),
        ]);

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain(".craftpath/state/W-0001-sum/T001.json");
    });

    test("fails on a shell write into state", async () => {
        const verdict = await grade("no_state_writes", root, [
            bash(`echo '{}' > .craftpath/state/W-0001-sum/T001.json`),
        ]);

        expect(verdict.pass).toBe(false);
    });

    test("is skipped, not passed, for a harness whose trace is not normalised", async () => {
        const verdict = await grade("no_state_writes", root, [{ kind: "raw", event: {} }], "pi");

        expect(verdict.skipped).toContain("pi");
    });
});

describe("verify_before_done", () => {
    const root = "/repo";

    test("passes when every done follows a verify of that task", async () => {
        const verdict = await grade("verify_before_done", root, [
            bash("craftpath task verify T001 --work W-0001-sum"),
            bash("git commit -m x && craftpath task done T001 --work W-0001-sum"),
            bash("craftpath task verify --all --work W-0001-sum"),
            bash("craftpath task done T002 --work W-0001-sum"),
        ]);
        expect(verdict.pass).toBe(true);
    });

    test("fails when a done comes before any verify of its task", async () => {
        const verdict = await grade("verify_before_done", root, [
            bash("craftpath task verify T002 --work W-0001-sum"),
            bash("craftpath task done T001 --work W-0001-sum"),
        ]);

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("T001");
    });
});

describe("right_work_item", () => {
    async function withWork(): Promise<string> {
        const root = await fixture({ modules: { app: { path: "./", test: "true" } } });
        await cli(root, 'work new "Sum"');
        return root;
    }

    test("passes when every work-scoped command names the run's work item", async () => {
        const verdict = await grade("right_work_item", await withWork(), [
            bash('craftpath work new "Sum"'),
            bash("craftpath status"),
            bash(`craftpath task add T001 --title "Add sum" --work ${WORK}`),
            bash(`craftpath approve requirement --work ${WORK}`),
        ]);
        expect(verdict.pass).toBe(true);
    });

    test("fails on a work-scoped command without --work", async () => {
        const verdict = await grade("right_work_item", await withWork(), [
            bash('craftpath task add T001 --title "Add sum"'),
        ]);

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("task add");
    });

    test("fails on a command naming a different work item", async () => {
        const verdict = await grade("right_work_item", await withWork(), [
            bash("craftpath task start T001 --work W-0009-other"),
        ]);

        expect(verdict.pass).toBe(false);
        expect(verdict.detail).toContain("W-0009-other");
    });
});
