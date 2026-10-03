import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Config } from "../schema";
import { cleanScratch, scratch } from "../../test/scratch";
import { affectedModules, changedFiles } from "./modules";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

type Modules = Config["modules"];

/** A module graph from name -> [path, depends_on], declared in this order. */
function graph(spec: Record<string, [string, string[]?]>): Modules {
    return Object.fromEntries(
        Object.entries(spec).map(([name, [path, depends_on = []]]) => [name, { path, depends_on }]),
    );
}

describe("affected modules", () => {
    test("a changed file selects the module that owns it", () => {
        const modules = graph({ shared: ["./shared"], api: ["./api"] });
        expect(affectedModules(modules, ["api/src/a.ts"])).toEqual(["api"]);
    });

    test("a change reaches every transitive dependent, dependencies first", () => {
        const modules = graph({
            api: ["./api", ["shared"]],
            web: ["./web", ["shared"]],
            shared: ["./shared"],
        });
        expect(affectedModules(modules, ["shared/x.ts"])).toEqual(["shared", "api", "web"]);
    });

    test("the longest matching path owns the file", () => {
        const modules = graph({ app: ["./"], web: ["./apps/web"] });
        expect(affectedModules(modules, ["apps/web/p.tsx"])).toEqual(["web"]);
        expect(affectedModules(modules, ["src/root.ts"])).toEqual(["app"]);
    });

    test("a file no module owns affects nothing", () => {
        const modules = graph({ shared: ["./shared"], api: ["./api"] });
        expect(affectedModules(modules, ["README.md"])).toEqual([]);
    });

    test("a path is a directory, not a prefix", () => {
        // ./api must not own ./api-docs/x.md.
        const modules = graph({ api: ["./api"] });
        expect(affectedModules(modules, ["api-docs/x.md"])).toEqual([]);
    });
});

/** A git repository on master with one commit, and the helper to drive it. */
async function repo(): Promise<{ root: string; git: (...args: string[]) => Promise<void> }> {
    const root = await scratch("craftpath-modules-");
    const git = async (...args: string[]) => {
        await Bun.$`git -C ${root} -c user.email=t@example.com -c user.name=T ${args}`.quiet();
    };
    await git("init", "-q", "-b", "master");
    await Bun.write(join(root, "tracked.txt"), "one\n");
    await git("add", "-A");
    await git("commit", "-qm", "base");
    return { root, git };
}

describe("changed files", () => {
    test("committed, uncommitted and untracked against the merge-base", async () => {
        const { root, git } = await repo();
        await git("checkout", "-qb", "work/x");
        await Bun.write(join(root, "committed.txt"), "c\n");
        await git("add", "-A");
        await git("commit", "-qm", "work");
        await Bun.write(join(root, "tracked.txt"), "two\n");
        await Bun.write(join(root, "untracked.txt"), "u\n");
        // master moving on after the branch point is not this branch's change.
        await git("checkout", "-q", "master");
        await Bun.write(join(root, "master-only.txt"), "m\n");
        await git("add", "master-only.txt");
        await git("commit", "-qm", "elsewhere");
        await git("checkout", "-q", "work/x");

        expect((await changedFiles(root, "master")).sort()).toEqual([
            "committed.txt",
            "tracked.txt",
            "untracked.txt",
        ]);
    });

    test("refuses a base branch that does not exist", async () => {
        const { root } = await repo();
        const error = await changedFiles(root, "main").then(
            () => null,
            (e: Error & { exitCode?: number }) => e,
        );
        expect(error?.message).toContain('"main"');
        expect(error?.message).toContain("base_branch");
        expect(error?.exitCode).toBe(2);
    });
});
