/**
 * The pi harness.
 *
 * pi has no external hook protocol, so wiring means writing an extension where
 * pi auto-discovers it. The extension's own behaviour is covered in
 * `pi-extension.test.ts`; this is the descriptor that installs it.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { PI } from "./pi";
import { PI_EXTENSION } from "./pi-extension";
import { HARNESSES, harnessFor } from "./index";

async function tmpdir(): Promise<string> {
    return await mkdtemp(join(osTmpdir(), "craftpath-pi-"));
}

describe("the pi descriptor", () => {
    test("is registered under its own id", () => {
        expect(harnessFor("pi")).toBe(PI);
        expect(HARNESSES.pi).toBe(PI);
    });

    test("uses pi's own resource directories", () => {
        expect(PI.skillsDir).toBe(".pi/skills");
        expect(PI.commandsDir).toBe(".pi/prompts");
    });

    test("has no rules directory, because pi has no such concept", () => {
        // Stated rather than faked. A rule written to a directory pi never
        // reads is worse than a missing one: it looks installed.
        expect(PI.rulesDir).toBeNull();
    });

    test("a command carries its namespace in the file name, the directory being flat", () => {
        expect(PI.commandFile("work.md")).toBe("craftpath-work.md");
        expect(PI.invocation("work")).toBe("/craftpath-work");
    });

    test("detects a project that has a .pi directory", async () => {
        const root = await tmpdir();
        expect(await PI.detect(root)).toBe(false);
        await Bun.write(join(root, ".pi/settings.json"), "{}");
        expect(await PI.detect(root)).toBe(true);
    });

    test("detects its own install, which writes no settings file", async () => {
        // `init --harness pi` creates .pi/extensions, skills and prompts and
        // never a settings.json -- pi auto-discovers all three. Detecting on
        // the settings file meant craftpath could not find the install it had
        // just done, so `doctor` and `update` both reported the wrong harness.
        const root = await tmpdir();
        await PI.wireGuards(root);
        expect(await PI.detect(root)).toBe(true);
    });

    test("next steps name project trust, which has no Claude Code analogue", async () => {
        // .pi/extensions loads only after the project is trusted, so a fully
        // installed project can have inactive guards and look healthy.
        expect(PI.nextSteps().join(" ")).toContain("trust");
    });
});

describe("wiring pi means writing the extension", () => {
    test("wiring writes the extension where pi auto-discovers it", async () => {
        const root = await tmpdir();
        const wiring = await PI.wireGuards(root);
        expect(wiring.refused).toBeNull();
        expect(wiring.added).toBe(1);
        expect(await Bun.file(join(root, ".pi/extensions/craftpath.ts")).text()).toBe(PI_EXTENSION);
    });

    test("wiring twice adds nothing, but repairs a stale extension", async () => {
        const root = await tmpdir();
        await PI.wireGuards(root);
        expect((await PI.wireGuards(root)).added).toBe(0);

        // Generated, not the project's: an older craftpath's extension must be
        // replaced or the guards keep speaking the previous protocol.
        await Bun.write(join(root, ".pi/extensions/craftpath.ts"), "// stale\n");
        expect((await PI.wireGuards(root)).added).toBe(1);
    });

    test("the installed extension is what doctor counts as a wired guard", async () => {
        const root = await tmpdir();
        expect(await PI.wiredGuardCommands(root)).toEqual([]);
        await PI.wireGuards(root);
        expect(await PI.wiredGuardCommands(root)).toEqual(["craftpath hook guard-write"]);
    });
});
