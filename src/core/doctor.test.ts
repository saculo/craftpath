import { afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_CODE } from "../harness/claude-code";
import { cleanScratch, scratch } from "../../test/scratch";
import { doctor } from "./doctor";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

const TAIL =
    '\n[gates]\nrequirement = "auto"\nplan = "auto"\nresult = "manual"\n\n' +
    '[git]\nwork_branch_prefix = "work/"\n';

/** What doctor prints for a project holding only this config. */
async function doctorOf(config: string, dirs: string[] = []): Promise<string> {
    const root = await scratch("craftpath-doctor-");
    for (const dir of dirs) await mkdir(join(root, dir), { recursive: true });
    await Bun.write(join(root, ".craftpath/config.toml"), config + TAIL);
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        await doctor(root, 5000, [CLAUDE_CODE]);
    } finally {
        console.log = log;
    }
    return lines.join("\n");
}

describe("doctor", () => {
    test("reports each module's commands", async () => {
        const out = await doctorOf(
            '[modules.api]\npath = "./api"\ntest = "pwd | grep -q /api$"\n\n[modules.web]\npath = "./"\nbuild = ""\n',
            ["api"],
        );

        // test runs in api's directory and passes; build is not declared.
        expect(out).toMatch(/api\.test\s+PASS/);
        expect(out).toMatch(/api\.build\s+MISSING/);
        expect(out).toMatch(/web\.test\s+MISSING/);
    });

    test("a blank build does not lower the health", async () => {
        const out = await doctorOf('[modules.app]\npath = "./"\ntest = "true"\nbuild = ""\n');

        expect(out).toContain("Verification health: HEALTHY");
        expect(out).toMatch(/app\.build\s+MISSING/);
        expect(out).not.toMatch(/verified by[^\n]*app\.build/);
    });

    test("a blank test still lowers the health", async () => {
        const out = await doctorOf('[modules.app]\npath = "./"\ntest = ""\nbuild = "true"\n');

        expect(out).not.toContain("Verification health: HEALTHY");
    });
});

describe("doctor reports stacked work branches", () => {
    const git = (root: string, ...args: string[]) =>
        Bun.$`git -C ${root} -c user.email=t@example.com -c user.name=T ${args}`.quiet();

    /** A repository on master with W-0001 started and committed on its own branch. */
    async function started(): Promise<string> {
        const root = await scratch("craftpath-doctor-");
        await git(root, "init", "-q", "-b", "master");
        const { init } = await import("./init");
        const { workNew } = await import("./work");
        const quiet = console.log;
        console.log = () => {};
        try {
            await init(root);
            await Bun.write(
                join(root, ".craftpath/config.toml"),
                '[modules.app]\npath = "./"\ntest = "true"\n' + TAIL + 'base_branch = "master"\n',
            );
            await git(root, "add", "-A");
            await git(root, "commit", "-qm", "base");
            await workNew(root, "First thing", "light");
            await git(root, "add", "-A");
            await git(root, "commit", "-qm", "start first\n\nWork: W-0001-first-thing");
        } finally {
            console.log = quiet;
        }
        return root;
    }

    async function report(root: string): Promise<string> {
        const lines: string[] = [];
        const log = console.log;
        console.log = (...args: unknown[]) => void lines.push(args.join(" "));
        try {
            await doctor(root, 5000, [CLAUDE_CODE]);
        } finally {
            console.log = log;
        }
        return lines.join("\n");
    }

    test("a work branch made from another work branch is reported, with the rebase that fixes it", async () => {
        // What `work new` did before it branched from base: stacked on W-0001.
        const root = await started();
        await git(root, "checkout", "-q", "-b", "work/W-0002-second-thing");
        await Bun.write(join(root, "src/second.ts"), "export {};\n");
        await git(root, "add", "-A");
        await git(root, "commit", "-qm", "second\n\nWork: W-0002-second-thing");

        const out = await report(root);

        expect(out).toContain("work/W-0002-second-thing is stacked on work/W-0001-first-thing");
        expect(out).toContain(
            "git rebase --onto master work/W-0001-first-thing work/W-0002-second-thing",
        );
        expect(out).toContain("W-0001-first-thing is open on this branch");
    });

    test("a work branch made from base is not reported", async () => {
        const root = await started();
        await git(root, "checkout", "-q", "master");
        const { workNew } = await import("./work");
        const quiet = console.log;
        console.log = () => {};
        try {
            await workNew(root, "Second thing", "light");
        } finally {
            console.log = quiet;
        }

        const out = await report(root);

        expect(out).not.toContain("stacked");
        expect(out).not.toContain("open on this branch");
    });
});
