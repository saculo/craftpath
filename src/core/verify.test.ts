import { afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TaskState } from "../schema";
import { cleanScratch, scratch } from "../../test/scratch";
import { init } from "./init";
import { taskAdd, taskStart, taskVerify } from "./task";
import { validate } from "./validate";
import { workNew } from "./work";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

const WORK = "0001-avatar-upload";
const TAIL =
    '\n[gates]\nrequirement = "auto"\nplan = "auto"\nresult = "manual"\n\n' +
    '[git]\nwork_branch_prefix = "work/"\n';

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

/**
 * A project on master whose config is `config` plus the required tables,
 * with a work item branched off it and T001 started, verified by `test`.
 */
async function startedWith(config: string): Promise<string> {
    const root = await scratch("craftpath-verify-");
    const git = (...args: string[]) =>
        Bun.$`git -C ${root} -c user.email=t@example.com -c user.name=T ${args}`.quiet();
    await git("init", "-q", "-b", "master");
    await quietly(() => init(root));
    await Bun.write(join(root, ".craftpath/config.toml"), config + TAIL);
    await git("add", "-A");
    await git("commit", "-qm", "base");
    await quietly(() => workNew(root, "Avatar upload", "light"));
    await quietly(() => taskAdd(root, "T001", { title: "Add the endpoint" }));

    const dir = join(root, ".craftpath/work", WORK, "tasks");
    const file = (await Array.fromAsync(new Bun.Glob("T001*.md").scan({ cwd: dir })))[0]!;
    const body = await Bun.file(join(dir, file)).text();
    await Bun.write(
        join(dir, file),
        body.replace(
            /acceptance:[\s\S]*?(?=\n---)/,
            "acceptance:\n  - id: A1\n    text: it works\n    verified_by:\n      - cmd: test",
        ),
    );
    await quietly(() => taskStart(root, "T001"));
    return root;
}

/** A change under `dir`, as the implementation would leave one. */
async function change(root: string, rel: string): Promise<void> {
    await mkdir(join(root, rel, ".."), { recursive: true });
    await Bun.write(join(root, rel), "changed\n");
}

async function verify(root: string): Promise<(Error & { exitCode?: number }) | null> {
    return await quietly(() =>
        taskVerify(root, "T001").then(
            () => null,
            (e: Error & { exitCode?: number }) => e,
        ),
    );
}

async function evidenceOf(root: string) {
    return TaskState.parse(await Bun.file(join(root, ".craftpath/state", WORK, "T001.json")).json())
        .evidence;
}

const exists = (root: string, rel: string) => Bun.file(join(root, rel)).exists();

describe("module verify", () => {
    test("runs the command from the module's directory", async () => {
        const root = await startedWith('[modules.api]\npath = "./api"\ntest = "pwd > out"\n');
        await change(root, "api/src/a.ts");

        expect(await verify(root)).toBeNull();

        expect((await Bun.file(join(root, "api/out")).text()).trim()).toEndWith("/api");
    });

    test("runs only affected modules", async () => {
        const root = await startedWith(
            '[modules.api]\npath = "./api"\ntest = "touch ran"\n\n' +
                '[modules.web]\npath = "./web"\ntest = "touch ran"\n',
        );
        await change(root, "web/p.tsx");
        await mkdir(join(root, "api"), { recursive: true });

        expect(await verify(root)).toBeNull();

        expect(await exists(root, "web/ran")).toBe(true);
        expect(await exists(root, "api/ran")).toBe(false);
        expect((await evidenceOf(root))[0]!.modules).toEqual(["web"]);
    });

    test("refuses before running when an affected module lacks the command", async () => {
        const root = await startedWith(
            '[modules.api]\npath = "./api"\ntest = "touch ran"\n\n' +
                '[modules.web]\npath = "./web"\nbuild = "true"\n',
        );
        await change(root, "api/a.ts");
        await change(root, "web/p.tsx");

        const error = await verify(root);

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain('"web"');
        expect(error?.message).toContain('"test"');
        expect(await exists(root, "api/ran")).toBe(false);
        expect(await evidenceOf(root)).toEqual([]);
    });

    test("refuses when no module is affected", async () => {
        const root = await startedWith(
            '[modules.api]\npath = "./api"\ntest = "true"\n\n[modules.web]\npath = "./web"\ntest = "true"\n',
        );
        await change(root, "README.md");

        const error = await verify(root);

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toMatch(/no module/i);
        expect(await evidenceOf(root)).toEqual([]);
    });

    test("craftpath's own files affect no module", async () => {
        // A root module owns every path, .craftpath/ included, so without this
        // every work item note would run the root module's tests.
        const root = await startedWith('[modules.app]\npath = "./"\ntest = "touch ran"\n');

        const error = await verify(root);

        expect(error?.message).toMatch(/no module/i);
        expect(await exists(root, "ran")).toBe(false);
    });

    test("one failing module fails the command's evidence", async () => {
        const root = await startedWith(
            '[modules.api]\npath = "./api"\ntest = "echo api-ran"\n\n' +
                '[modules.web]\npath = "./web"\ntest = "echo web-ran; exit 3"\n',
        );
        await change(root, "api/a.ts");
        await change(root, "web/p.tsx");

        const error = await verify(root);

        expect(error?.exitCode).toBe(2);
        const [evidence] = await evidenceOf(root);
        expect(evidence!.cmd).toBe("test");
        expect(evidence!.modules).toEqual(["api", "web"]);
        expect(evidence!.exit).not.toBe(0);
        const log = await Bun.file(join(root, ".craftpath/state", WORK, evidence!.log)).text();
        expect(log).toMatch(/## api[\s\S]*api-ran[\s\S]*## web[\s\S]*web-ran/);
    });

    test("a config without modules verifies as before", async () => {
        const root = await startedWith('[commands.test]\nrun = "pwd > out"\n');

        expect(await verify(root)).toBeNull();

        expect(await exists(root, "out")).toBe(true);
        expect((await evidenceOf(root))[0]!.modules).toBeUndefined();
    });

    test("validate accepts the log of a run across modules", async () => {
        // validate re-reads every log against its recorded exit (M3), and a
        // module run's log carries an exit line per module before the overall one.
        const root = await startedWith(
            // The failing module first: its exit line is then not the last one,
            // so only the overall line can make the log agree with the record.
            '[modules.web]\npath = "./web"\ntest = "exit 3"\n\n' +
                '[modules.api]\npath = "./api"\ntest = "true"\n',
        );
        await change(root, "api/a.ts");
        await change(root, "web/p.tsx");
        await verify(root);
        await Bun.write(join(root, "web/package.json"), "{}\n");
        await Bun.write(
            join(root, ".craftpath/config.toml"),
            (await Bun.file(join(root, ".craftpath/config.toml")).text()).replace(
                'test = "exit 3"',
                'test = "true"',
            ),
        );
        expect(await verify(root)).toBeNull();

        const error = await quietly(() =>
            validate(root).then(
                () => null,
                (e: Error) => e,
            ),
        );
        expect(error).toBeNull();
    });
});
