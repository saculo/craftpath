/**
 * The CLI is small on purpose: `init`, `doctor`, `version`. Everything a work
 * item needs happens through harness commands and the scripts they run.
 */
import { describe, expect, test } from "bun:test";
import pkg from "../../package.json" with { type: "json" };

const BIN = new URL("../../bin/craftpath.ts", import.meta.url).pathname;

async function craftpath(...args: string[]) {
    const p = Bun.spawn([process.execPath, BIN, ...args], { stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { exit: await p.exited, out };
}

describe("the CLI surface", () => {
    test("version prints the version", async () => {
        const { exit, out } = await craftpath("version");
        expect(exit).toBe(0);
        expect(out.trim()).toBe(`craftpath ${pkg.version}`);
    });

    test("help lists exactly init, doctor and version", async () => {
        const { exit, out } = await craftpath("help");
        expect(exit).toBe(0);
        const commands = [...out.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]);
        expect(commands).toEqual(["init", "doctor", "version"]);
    });

    test("an unknown command is a usage error that shows help", async () => {
        const { exit, out } = await craftpath("task", "add", "T001");
        expect(exit).toBe(2);
        expect(out).toContain("craftpath <command>");
    });
});
