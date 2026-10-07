/**
 * Where `work new` puts the work branch.
 *
 * New work starts from the configured base branch, never from whatever branch
 * happens to be checked out: branching from another work item's branch stacks
 * the two, and carries that item's committed state into the new branch as a
 * second open work item.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch, scratch } from "../../test/scratch";
import { init } from "./init";
import { WORK, openWorkIds, workNew } from "./work";

afterAll(cleanScratch);

async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; err: string }> {
    const log = console.log;
    const error = console.error;
    const lines: string[] = [];
    console.log = () => {};
    console.error = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        return { value: await fn(), err: lines.join("\n") };
    } finally {
        console.log = log;
        console.error = error;
    }
}

async function refusal(
    fn: () => Promise<unknown>,
): Promise<(Error & { exitCode?: number }) | null> {
    return quietly(fn).then(
        () => null,
        (error: Error & { exitCode?: number }) => error,
    );
}

function git(root: string, ...args: string[]) {
    return Bun.$`git -C ${root} -c user.email=t@example.com -c user.name=T ${args}`.quiet();
}

const head = async (root: string, ref = "HEAD") =>
    (await git(root, "rev-parse", ref).text()).trim();
const branch = async (root: string) => (await git(root, "branch", "--show-current").text()).trim();

/** A repository on master holding everything init wrote. */
async function repo(): Promise<string> {
    const root = await scratch("craftpath-branch-");
    await git(root, "init", "-q", "-b", "master");
    await quietly(() => init(root));
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "base");
    return root;
}

describe("work new branches from the base branch", () => {
    test("on another work item's branch, the new branch starts from base, not from it", async () => {
        const root = await repo();
        await quietly(() => workNew(root, "First thing", "light"));
        await git(root, "add", "-A");
        await git(root, "commit", "-qm", "start first");
        const master = await head(root, "master");

        await quietly(() => workNew(root, "Second thing", "light"));

        expect(await branch(root)).toBe("work/W-0002-second-thing");
        expect(await head(root)).toBe(master);
        expect(await openWorkIds(root)).toEqual(["W-0002-second-thing"]);
    });

    test("a dirty tree is refused before anything is written", async () => {
        const root = await repo();
        await Bun.write(join(root, ".craftpath/config.toml"), "# edited, not committed\n");

        const error = await refusal(() => workNew(root, "First thing", "light"));

        expect(error?.exitCode).toBe(2);
        expect(error?.message).toContain("uncommitted");
        expect(await openWorkIds(root)).toEqual([]);
        expect(await Bun.file(join(root, WORK, "W-0001-first-thing")).exists()).toBe(false);
        expect(await branch(root)).toBe("master");
    });

    test("a base branch that does not exist creates no branch, and says so", async () => {
        const root = await repo();
        const config = join(root, ".craftpath/config.toml");
        const text = await Bun.file(config).text();
        await Bun.write(config, text.replace(/^base_branch = .*$/m, 'base_branch = "main"'));
        await git(root, "commit", "-qam", "base is main");

        const { err } = await quietly(() => workNew(root, "First thing", "light"));

        expect(await branch(root)).toBe("master");
        expect(err).toContain('"main"');
        expect(await openWorkIds(root)).toEqual(["W-0001-first-thing"]);
    });
});
