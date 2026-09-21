/**
 * Choosing which harnesses `init` installs into, and getting the rules there.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CODE } from "./claude-code";
import { PI } from "./pi";
import { chooseHarnesses, parseHarnesses } from "./select";

async function tmpdir(): Promise<string> {
    return await mkdtemp(join(osTmpdir(), "craftpath-select-"));
}

const never = async (): Promise<never> => {
    throw new Error("must not ask");
};

describe("parsing an explicit --harness", () => {
    test("one, several, and whitespace around them", () => {
        expect(parseHarnesses("pi")).toEqual([PI]);
        expect(parseHarnesses("claude-code, pi")).toEqual([CLAUDE_CODE, PI]);
    });

    test("a repeat is not two installs", () => {
        expect(parseHarnesses("pi,pi")).toEqual([PI]);
    });

    test("an unknown name is refused, naming what is known", () => {
        expect(() => parseHarnesses("emacs")).toThrow(/emacs.*claude-code, pi/s);
    });

    test("an empty list is refused rather than silently installing nothing", () => {
        expect(() => parseHarnesses("")).toThrow(/at least one/);
        expect(() => parseHarnesses("  ,  ")).toThrow(/at least one/);
    });
});

describe("choosing when no --harness was given", () => {
    test("a terminal is asked", async () => {
        const root = await tmpdir();
        const asked: string[][] = [];
        const chosen = await chooseHarnesses(root, undefined, async (options) => {
            asked.push(options.map((o) => o.id));
            return [PI];
        });
        expect(asked).toEqual([["claude-code", "pi"]]);
        expect(chosen).toEqual([PI]);
    });

    test("both is an answer, and installs both", async () => {
        const chosen = await chooseHarnesses(await tmpdir(), undefined, async () => [
            CLAUDE_CODE,
            PI,
        ]);
        expect(chosen).toEqual([CLAUDE_CODE, PI]);
    });

    test("choosing nothing is refused rather than installing nothing", async () => {
        expect(chooseHarnesses(await tmpdir(), undefined, async () => [])).rejects.toThrow(
            /at least one/,
        );
    });

    test("without a terminal, what the project already has wins", async () => {
        // `init` runs unattended in CI and in this suite. Prompting there hangs;
        // guessing Claude Code would re-target a pi project on the next update.
        const root = await tmpdir();
        await Bun.write(join(root, ".pi/settings.json"), "{}");
        expect(await chooseHarnesses(root, undefined, null)).toEqual([PI]);
    });

    test("without a terminal and with nothing to detect, Claude Code stays the default", async () => {
        expect(await chooseHarnesses(await tmpdir(), undefined, null)).toEqual([CLAUDE_CODE]);
    });

    test("an explicit flag is never second-guessed by detection", async () => {
        const root = await tmpdir();
        await Bun.write(join(root, ".pi/settings.json"), "{}");
        expect(await chooseHarnesses(root, "claude-code", never)).toEqual([CLAUDE_CODE]);
    });
});

describe("the test-first rule reaches both harnesses", () => {
    test("Claude Code gets it as a path-scoped rule", async () => {
        const root = await tmpdir();
        expect(await CLAUDE_CODE.writeRule(root, "tdd.md", "BODY")).toBe(".claude/rules/tdd.md");
        expect(await Bun.file(join(root, ".claude/rules/tdd.md")).text()).toBe("BODY");
    });

    test("pi gets it as a skill, because pi has no rules mechanism", async () => {
        // The alternative is writing it to a directory pi never reads, which
        // would look installed and enforce nothing.
        const root = await tmpdir();
        expect(await PI.writeRule(root, "tdd.md", "BODY")).toBe(".pi/skills/tdd/SKILL.md");

        const written = await Bun.file(join(root, ".pi/skills/tdd/SKILL.md")).text();
        // pi reads skills by frontmatter; a body with none is discovered as
        // nothing at all, so the wrapper is what makes the rule exist there.
        expect(written).toStartWith("---\nname: tdd\n");
        expect(written).toContain("description:");
        expect(written).toContain("BODY");
    });

    test("neither harness overwrites a rule the project has edited", async () => {
        const root = await tmpdir();
        for (const harness of [CLAUDE_CODE, PI]) {
            await harness.writeRule(root, "tdd.md", "BODY");
            expect(await harness.writeRule(root, "tdd.md", "CHANGED")).toBeNull();
        }
    });
});
