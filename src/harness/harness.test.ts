/**
 * The harness seam.
 *
 * Craftpath's workflow, state and evidence are harness-independent; only four
 * things are not -- where skills, rules and commands are installed, how a
 * command is invoked, how the guards get wired, and which env var names the
 * project root. This suite pins that boundary so a second harness is an added
 * descriptor rather than a search-and-replace through init and doctor.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cleanScratch, scratch } from "../../test/scratch";
import { join } from "node:path";
import { CLAUDE_CODE } from "./claude-code";
import { DEFAULT_HARNESS, HARNESSES, detect, harnessFor } from "./index";
import { PROJECT_DIR_ENVS, projectRootFrom } from "../hooks/io";
import { shouldBlock } from "../hooks/guard-bash";
import { targets } from "../hooks/guard-write";

async function tmpdir(): Promise<string> {
    return await scratch("craftpath-harness-");
}

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

describe("the guard payload contract is harness-neutral", () => {
    // Measured against pi 2026-09-21: `write` takes {path, content}, `edit`
    // takes {path, edits:[{oldText,newText}]}, `bash` takes {command}. The
    // guards read paths and commands, never tool names, so a pi adapter is a
    // spawn-and-translate shim rather than a second implementation -- but only
    // while these shapes keep reaching `targets`. That is what this pins.
    test("pi's write shape reaches targets", () => {
        expect(targets({ path: ".craftpath/state/T1.json", content: "{}" })).toEqual([
            ".craftpath/state/T1.json",
        ]);
    });

    test("pi's edit shape reaches targets", () => {
        expect(
            targets({
                path: ".craftpath/state/T1.json",
                edits: [{ oldText: "a", newText: "b" }],
            }),
        ).toEqual([".craftpath/state/T1.json"]);
    });

    test("pi's bash shape is judged by the same rule", () => {
        expect(shouldBlock("echo '{}' > .craftpath/state/T1.json")).toBe(true);
    });
});

describe("the project root is not one harness's env var", () => {
    test("Claude Code's variable is honoured", () => {
        expect(projectRootFrom({ CLAUDE_PROJECT_DIR: "/repo" }, "/cwd")).toBe("/repo");
    });

    test("pi's variable is honoured", () => {
        expect(projectRootFrom({ PI_PROJECT_DIR: "/repo" }, "/cwd")).toBe("/repo");
    });

    test("craftpath's own override wins, so any harness can be adapted", () => {
        expect(
            projectRootFrom(
                { CRAFTPATH_PROJECT_DIR: "/repo", CLAUDE_PROJECT_DIR: "/wrong" },
                "/cwd",
            ),
        ).toBe("/repo");
    });

    test("cwd is the fallback when no harness announces itself", () => {
        expect(projectRootFrom({}, "/cwd")).toBe("/cwd");
    });

    test("an empty value is not a project root", () => {
        expect(projectRootFrom({ CLAUDE_PROJECT_DIR: "" }, "/cwd")).toBe("/cwd");
    });

    test("every listed variable is one a harness actually sets", () => {
        expect(PROJECT_DIR_ENVS).toEqual([
            "CRAFTPATH_PROJECT_DIR",
            "CLAUDE_PROJECT_DIR",
            "PI_PROJECT_DIR",
        ]);
    });
});

describe("the Claude Code descriptor reproduces today's layout", () => {
    // Not a redundant restatement of the constants: init and doctor read these
    // instead of their own literals now, so a change here is a change to where
    // a real project's files land.
    test("paths", () => {
        expect(CLAUDE_CODE.skillsDir).toBe(".claude/skills");
        expect(CLAUDE_CODE.rulesDir).toBe(".claude/rules");
        expect(CLAUDE_CODE.commandsDir).toBe(".claude/commands/craftpath");
    });

    test("scaffolds the project hooks directory it has always scaffolded", () => {
        // Empty on purpose -- somewhere for a project's own hook scripts to go.
        // It survives a clone only because init writes a .gitkeep into it, so
        // dropping it from the descriptor silently changes a real project's
        // layout.
        expect(CLAUDE_CODE.scaffoldDirs).toEqual([".claude/hooks"]);
    });

    test("a command file keeps its plain name, because the directory namespaces it", () => {
        expect(CLAUDE_CODE.commandFile("work.md")).toBe("work.md");
        expect(CLAUDE_CODE.invocation("work")).toBe("/craftpath:work");
    });
});

describe("harness selection", () => {
    test("Claude Code is the default, so an existing project is unaffected", () => {
        expect(DEFAULT_HARNESS).toBe(CLAUDE_CODE);
        expect(harnessFor("claude-code")).toBe(CLAUDE_CODE);
    });

    test("an unknown id is refused rather than silently defaulted", () => {
        expect(() => harnessFor("emacs")).toThrow(/emacs/);
    });

    test("every registered harness is registered under its own id", () => {
        for (const [id, harness] of Object.entries(HARNESSES)) {
            expect(harness.id).toBe(id);
        }
    });

    test("a repo carrying .claude/ detects as Claude Code", async () => {
        const root = await tmpdir();
        await Bun.write(join(root, ".claude/settings.json"), "{}");
        expect((await detect(root)).map((h) => h.id)).toEqual(["claude-code"]);
    });

    test("a repo carrying no harness directory detects as none", async () => {
        expect(await detect(await tmpdir())).toEqual([]);
    });
});

describe("guard wiring is the harness's job, not init's", () => {
    test("wiring an empty project adds the guards and the stop check", async () => {
        const root = await tmpdir();
        const result = await CLAUDE_CODE.wireGuards(root);
        expect(result.refused).toBeNull();
        expect(result.added).toBe(3);

        const settings = await Bun.file(join(root, ".claude/settings.json")).json();
        expect(settings.hooks.PreToolUse).toHaveLength(2);
        expect(settings.hooks.Stop).toHaveLength(1);
    });

    test("wiring twice adds nothing the second time", async () => {
        const root = await tmpdir();
        await CLAUDE_CODE.wireGuards(root);
        expect((await CLAUDE_CODE.wireGuards(root)).added).toBe(0);
    });

    test("unparseable settings are refused, not overwritten", async () => {
        const root = await tmpdir();
        await Bun.write(join(root, ".claude/settings.json"), "{ not json");
        const result = await CLAUDE_CODE.wireGuards(root);
        expect(result.refused).toContain("not valid JSON");
        expect(await Bun.file(join(root, ".claude/settings.json")).text()).toBe("{ not json");
    });

    test("the wired commands are the ones doctor looks for", async () => {
        const root = await tmpdir();
        await CLAUDE_CODE.wireGuards(root);
        expect(await CLAUDE_CODE.wiredGuardCommands(root)).toEqual([
            "craftpath hook guard-write",
            "craftpath hook guard-bash",
        ]);
    });

    test("an unwired project reports no guard commands", async () => {
        expect(await CLAUDE_CODE.wiredGuardCommands(await tmpdir())).toEqual([]);
    });
});
