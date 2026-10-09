/**
 * `/craftpath-spec <title>`: the guard, then `spec.py`, which creates the work
 * item -- id, worktree next to the repo, branch from the base, SPEC.md -- and
 * then the agent writes the spec.
 *
 * The scripts are run exactly as the harnesses run them: the guard with the
 * hook's JSON on stdin, the step script with the command's arguments.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { git, guard, project, script } from "./kit";

afterAll(cleanScratch);

const spec = (cwd: string, title: string) => script(cwd, "spec", title);
const specGuard = (cwd: string, args: string) => guard(cwd, "spec", args);

describe("the spec guard", () => {
    test("refuses without a title", async () => {
        const { blocked, reason } = await specGuard(await project(), "  ");

        expect(blocked).toBe(true);
        expect(reason).toContain("title");
    });

    test("refuses while craftpath's files are not committed on the base branch", async () => {
        const { blocked, reason } = await specGuard(
            await project({ commit: false }),
            "Health endpoint",
        );

        expect(blocked).toBe(true);
        expect(reason).toContain("main");
        expect(reason).toContain("commit");
    });

    test("refuses where craftpath is not initialised", async () => {
        const root = await project();
        await Bun.$`rm ${join(root, ".craftpath/config.toml")}`;

        const { blocked, reason } = await specGuard(root, "Health endpoint");

        expect(blocked).toBe(true);
        expect(reason).toContain("craftpath init");
    });

    test("lets a complete request through", async () => {
        expect((await specGuard(await project(), "Health endpoint")).blocked).toBe(false);
    });
});

describe("the guard acts only on a step's script", () => {
    test("any other shell command passes straight through", async () => {
        const root = await project();
        for (const command of [
            "ls -la",
            "bun test",
            "python3 other.py",
            "cat .craftpath/scripts/spec.py",
        ]) {
            expect({ command, ...(await guard(root, "spec", "", { command })) }).toMatchObject({
                command,
                blocked: false,
                exit: 0,
            });
        }
    });

    test("pi's tool call shape is judged the same way", async () => {
        const root = await project();

        expect(await guard(root, "spec", '"  "', { tool: "bash" })).toMatchObject({
            blocked: true,
        });
        expect(await guard(root, "spec", '"Health endpoint"', { tool: "bash" })).toMatchObject({
            blocked: false,
        });
    });

    test("a quoted title is one title", async () => {
        const root = await project();
        await Bun.$`rm ${join(root, ".craftpath/config.toml")}`;

        const { blocked, reason } = await guard(root, "spec", '"Health endpoint"');

        expect(blocked).toBe(true); // not initialised -- but it got past the title
        expect(reason).toContain("craftpath init");
    });
});

describe("each step's guard is its own file", () => {
    test("a guard file in guards/ is used for its step's script, with no other change", async () => {
        const root = await project();
        await Bun.write(
            join(root, ".craftpath/scripts/guards/review.py"),
            "from craftpath import Refusal\n\n\ndef check(cwd, args, command):\n    raise Refusal(f'{command} is not ready: {args}')\n",
        );

        const { blocked, reason } = await guard(root, "review", "C-00001");

        expect(blocked).toBe(true);
        expect(reason).toBe("/craftpath-review is not ready: C-00001");
    });

    test("a guard that crashes refuses the step, rather than letting it run", async () => {
        const root = await project();
        await Bun.write(
            join(root, ".craftpath/scripts/guards/review.py"),
            "def check(cwd, args, invoked):\n    return 1 / 0\n",
        );

        const { blocked, reason } = await guard(root, "review", "C-00001");

        expect(blocked).toBe(true);
        expect(reason).toContain("guard for review failed");
        expect(reason).toContain("ZeroDivisionError");
    });

    test("a guard file that does not load refuses the step too", async () => {
        const root = await project();
        await Bun.write(join(root, ".craftpath/scripts/guards/review.py"), "def check(:\n");

        const { blocked, reason } = await guard(root, "review", "C-00001");

        expect(blocked).toBe(true);
        expect(reason).toContain("SyntaxError");
    });

    test("a script with no guard file passes", async () => {
        expect(await guard(await project(), "task", 'C-00001 --wave 1 "x"')).toMatchObject({
            blocked: false,
        });
    });
});

describe("spec.py creates the work item", () => {
    test("worktree next to the repo, branch from base, SPEC.md with its id and title", async () => {
        const root = await project();

        const { exit, out } = await spec(root, "Health endpoint");

        expect(exit).toBe(0);
        const tree = join(root, "..", "app.craftpath", "C-00001-health-endpoint");
        const file = join(tree, ".craftpath/work/C-00001/SPEC.md");
        expect(out).toContain(tree);
        expect(out).toContain(file);
        const text = await Bun.file(file).text();
        expect(text).toStartWith("# C-00001 — Health endpoint");
        expect(text).not.toContain("{{");
        expect((await git(tree, "branch", "--show-current").text()).trim()).toBe(
            "craftpath/C-00001-health-endpoint",
        );
        expect((await git(tree, "rev-parse", "HEAD").text()).trim()).toBe(
            (await git(root, "rev-parse", "main").text()).trim(),
        );
    });

    test("ids count up across branches, worktrees and commit messages", async () => {
        const root = await project();
        await spec(root, "First");
        await spec(root, "Second");
        // A removed worktree still has its branch; a merged one its commit message.
        await git(
            root,
            "worktree",
            "remove",
            "--force",
            join(root, "..", "app.craftpath", "C-00002-second"),
        );
        await git(
            root,
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "feat(C-00007/T-0001): from elsewhere",
        );

        const { out } = await spec(root, "Third");

        expect(out).toContain("C-00008-third");
    });

    test("run from inside a work item's worktree, it still creates a sibling of the repo", async () => {
        const root = await project();
        await spec(root, "First");
        const first = join(root, "..", "app.craftpath", "C-00001-first");

        const { exit, out } = await spec(first, "Second");

        expect(exit).toBe(0);
        expect(out).toContain(join(root, "..", "app.craftpath", "C-00002-second"));
    });
});

describe("on pi, the hooks extension runs the guard from .pi/settings.json", () => {
    type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

    /** The installed extension, loaded as pi loads it, its tool_call handler returned. */
    async function toolCall(root: string): Promise<Handler> {
        const mod = await import(join(root, ".pi/extensions/claude-hooks.ts"));
        const handlers = new Map<string, Handler>();
        mod.default({ on: (name: string, handler: Handler) => handlers.set(name, handler) });
        return handlers.get("tool_call")!;
    }

    const bash = (command: string) => ({ toolName: "bash", input: { command } });

    test("a refused step script is blocked, with the reason for the agent to report", async () => {
        const root = await project({ harness: "pi" });
        const handler = await toolCall(root);

        const result = (await handler(bash('python3 .craftpath/scripts/spec.py "  "'), {
            cwd: root,
        })) as {
            block: boolean;
            reason: string;
        };

        expect(result.block).toBe(true);
        expect(result.reason).toContain("title");
    });

    test("an allowed step script and any other call pass through", async () => {
        const root = await project({ harness: "pi" });
        const handler = await toolCall(root);

        expect(
            await handler(bash('python3 .craftpath/scripts/spec.py "Health endpoint"'), {
                cwd: root,
            }),
        ).toBeUndefined();
        expect(await handler(bash("ls -la"), { cwd: root })).toBeUndefined();
        expect(
            await handler({ toolName: "read", input: { path: "SPEC.md" } }, { cwd: root }),
        ).toBeUndefined();
    });
});

describe("on Claude Code, the real PreToolUse hook refuses inside the forked step", () => {
    // Costs one small agent turn: the agent runs the script before the hook can
    // refuse it. Opt in with CRAFTPATH_REAL_HARNESS=1.
    const real = process.env.CRAFTPATH_REAL_HARNESS === "1" && Bun.which("claude") !== null;

    test.skipIf(!real)(
        "/craftpath-plan for an unknown work item is refused, and says why",
        async () => {
            const root = await project();
            const p = Bun.spawn(
                [
                    "claude",
                    "-p",
                    "/craftpath-plan C-00009",
                    "--model",
                    "haiku",
                    "--output-format",
                    "json",
                    "--max-budget-usd",
                    "0.05",
                    "--no-session-persistence",
                ],
                { cwd: root, stdin: new Blob([""]), stdout: "pipe", stderr: "pipe" },
            );
            const result = JSON.parse(await new Response(p.stdout).text());
            await p.exited;

            expect(result.result).toContain("C-00009");
            expect(result.result).toContain("not an open work item");
        },
        120_000,
    );
});
