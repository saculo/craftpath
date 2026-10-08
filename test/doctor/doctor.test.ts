/**
 * `craftpath doctor`: is this project set up for the flow to work?
 *
 * Run as a subprocess, so PATH can stand in a different python3.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch, scratch } from "../scratch";

afterAll(cleanScratch);

const BIN = new URL("../../bin/craftpath.ts", import.meta.url).pathname;
const git = (cwd: string, ...args: string[]) =>
    Bun.$`git -C ${cwd} -c user.email=t@e.c -c user.name=T ${args}`.quiet();

async function craftpath(cwd: string, args: string[], env: Record<string, string> = {}) {
    const p = Bun.spawn([process.execPath, BIN, ...args], {
        cwd,
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
    });
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { exit: await p.exited, out };
}

/** Initialised and committed, with the root module's test set to `run`. */
async function project(run = "true", options: { commit?: boolean } = {}): Promise<string> {
    const root = await scratch("craftpath-doctor-");
    await git(root, "init", "-q", "-b", "main");
    await git(root, "commit", "-q", "--allow-empty", "-m", "base");
    await craftpath(root, ["init", "--harness", "claude-code"]);
    const config = join(root, ".craftpath/config.toml");
    await Bun.write(
        config,
        (await Bun.file(config).text()).replace(/^test = .*$/m, `test = ${JSON.stringify(run)}`),
    );
    if (options.commit ?? true) {
        await git(root, "add", "-A");
        await git(root, "commit", "-q", "-m", "install");
    }
    return root;
}

describe("doctor", () => {
    test("a healthy project passes every check", async () => {
        const { exit, out } = await craftpath(await project(), ["doctor"]);

        expect(out).toMatch(/ok\s+python3 3\.\d+/);
        expect(out).toMatch(/ok\s+Claude Code guard wired/);
        expect(out).toMatch(/ok\s+module app: test passes/);
        expect(out).not.toContain("FAIL");
        expect(exit).toBe(0);
    });

    test("a python3 older than 3.11 fails, saying what is needed", async () => {
        const root = await project();
        const bin = await scratch("craftpath-fakepy-");
        await Bun.write(join(bin, "python3"), "#!/bin/sh\necho 'Python 3.9.18'\n");
        await Bun.$`chmod +x ${join(bin, "python3")}`;

        const { exit, out } = await craftpath(root, ["doctor"], {
            PATH: `${bin}:${process.env.PATH}`,
        });

        expect(exit).toBe(1);
        expect(out).toMatch(/FAIL\s+python3 3\.9/);
        expect(out).toContain("3.11");
    });

    test("an unwired guard fails", async () => {
        const root = await project();
        await Bun.write(join(root, ".claude/settings.json"), "{}\n");

        const { exit, out } = await craftpath(root, ["doctor"]);

        expect(exit).toBe(1);
        expect(out).toMatch(/FAIL\s+Claude Code guard/);
        expect(out).toContain("craftpath init");
    });

    test("a failing module test fails", async () => {
        const { exit, out } = await craftpath(await project("exit 3"), ["doctor"]);

        expect(exit).toBe(1);
        expect(out).toMatch(/FAIL\s+module app: test fails \(exit 3\)/);
    });

    test("craftpath's files not committed on the base branch fail", async () => {
        const { exit, out } = await craftpath(await project("true", { commit: false }), ["doctor"]);

        expect(exit).toBe(1);
        expect(out).toMatch(/FAIL\s+craftpath's files are not committed on main/);
    });
});
