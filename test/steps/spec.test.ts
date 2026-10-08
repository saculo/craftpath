/**
 * `/craftpath:spec <title>`: the guard, then `spec.py`, which creates the work
 * item -- id, worktree next to the repo, branch from the base, SPEC.md -- and
 * then the agent writes the spec.
 *
 * The scripts are run exactly as the harnesses run them: the guard with the
 * hook's JSON on stdin, the step script with the command's arguments.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { init } from "../../src/init";
import { cleanScratch, scratch } from "../scratch";

afterAll(cleanScratch);

const git = (cwd: string, ...args: string[]) =>
    Bun.$`git -C ${cwd} -c user.email=t@e.c -c user.name=T ${args}`.quiet();

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try {
        return await fn();
    } finally {
        console.log = log;
    }
}

/** A repo on main with craftpath installed and committed. Returns its root. */
async function project(options: { commit?: boolean; harness?: string } = {}): Promise<string> {
    const parent = await scratch("craftpath-spec-");
    const root = join(parent, "app");
    await Bun.write(join(root, "package.json"), '{"name":"app","scripts":{"test":"bun test"}}\n');
    await git(root, "init", "-q", "-b", "main");
    await git(root, "commit", "-q", "--allow-empty", "-m", "base");
    await quietly(() => init(root, ["--harness", options.harness ?? "claude-code"]));
    if (options.commit ?? true) {
        await git(root, "add", "-A");
        await git(root, "commit", "-q", "-m", "chore: install craftpath");
    }
    return root;
}

async function python(cwd: string, args: string[], stdin = "") {
    const p = Bun.spawn(["python3", ...args], {
        cwd,
        stdin: new Blob([stdin]),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
    ]);
    return { exit: await p.exited, out, err };
}

const guard = (cwd: string, args: string, step = "spec") =>
    python(
        cwd,
        [".craftpath/scripts/guard.py"],
        JSON.stringify({ command_name: `craftpath:${step}`, command_args: args, cwd }),
    );

const spec = (cwd: string, title: string) => python(cwd, [".craftpath/scripts/spec.py", title]);

describe("the spec guard", () => {
    test("refuses without a title", async () => {
        const { exit, err } = await guard(await project(), "  ");

        expect(exit).toBe(2);
        expect(err).toContain("title");
    });

    test("refuses while craftpath's files are not committed on the base branch", async () => {
        const { exit, err } = await guard(await project({ commit: false }), "Health endpoint");

        expect(exit).toBe(2);
        expect(err).toContain("main");
        expect(err).toContain("commit");
    });

    test("refuses where craftpath is not initialised", async () => {
        const root = await project();
        await Bun.$`rm ${join(root, ".craftpath/config.toml")}`;

        const { exit, err } = await guard(root, "Health endpoint");

        expect(exit).toBe(2);
        expect(err).toContain("craftpath init");
    });

    test("lets a complete request through", async () => {
        expect((await guard(await project(), "Health endpoint")).exit).toBe(0);
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

describe("on pi, the extension runs the same guard and script", () => {
    class FakePi {
        commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
        sent: string[] = [];
        registerCommand(
            name: string,
            command: { handler: (args: string, ctx: unknown) => Promise<void> },
        ) {
            this.commands.set(name, command);
        }
        sendUserMessage(text: string) {
            this.sent.push(text);
        }
    }

    async function loaded(root: string) {
        const cwd = process.cwd();
        process.chdir(root); // pi loads project extensions from the project
        try {
            const mod = await import(join(root, ".pi/extensions/craftpath.ts"));
            const pi = new FakePi();
            mod.default(pi);
            return pi;
        } finally {
            process.chdir(cwd);
        }
    }

    test("/craftpath-spec creates the work item and hands the agent its instructions", async () => {
        const root = await project({ harness: "pi" });
        const pi = await loaded(root);
        const notes: string[] = [];

        await pi.commands.get("craftpath-spec")!.handler("Health endpoint", {
            cwd: root,
            ui: { notify: (m: string) => notes.push(m) },
        });

        expect(notes).toEqual([]);
        expect(pi.sent).toHaveLength(1);
        expect(pi.sent[0]).toContain("C-00001-health-endpoint");
        expect(pi.sent[0]).toContain("Health endpoint");
        expect(pi.sent[0]).toContain("/craftpath-plan");
        expect(pi.sent[0]).not.toContain("{{");
    });

    test("a refused /craftpath-spec shows the reason and sends nothing", async () => {
        const root = await project({ harness: "pi" });
        const pi = await loaded(root);
        const notes: string[] = [];

        await pi.commands
            .get("craftpath-spec")!
            .handler("", { cwd: root, ui: { notify: (m: string) => notes.push(m) } });

        expect(pi.sent).toEqual([]);
        expect(notes.join("\n")).toContain("title");
    });
});

describe("on Claude Code, the real hook refuses before the model runs", () => {
    const hasClaude = Bun.which("claude") !== null;

    test.skipIf(!hasClaude)(
        "/craftpath:spec without a title is blocked at no cost",
        async () => {
            const root = await project();
            const p = Bun.spawn(
                [
                    "claude",
                    "-p",
                    "/craftpath:spec",
                    "--output-format",
                    "json",
                    "--max-budget-usd",
                    "0.01",
                    "--no-session-persistence",
                ],
                { cwd: root, stdin: new Blob([""]), stdout: "pipe", stderr: "pipe" },
            );
            const result = JSON.parse(await new Response(p.stdout).text());
            await p.exited;

            expect(result.result).toContain("blocked by hook");
            expect(result.result).toContain("title");
            expect(result.total_cost_usd).toBe(0);
        },
        60_000,
    );
});
