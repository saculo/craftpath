/**
 * C2: the README names exactly the steps `init` installs, and only CLI
 * commands that exist -- so it cannot quietly describe a flow that is gone.
 */
import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { USAGE } from "../src/cli";

const README = await Bun.file(new URL("../README.md", import.meta.url)).text();
const STEPS = (await readdir(new URL("../assets/steps", import.meta.url)))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();

test("names every step init installs, and no other", () => {
    const named = [...README.matchAll(/\/(?:skill:)?craftpath-([a-z-]+)/g)].map((m) => m[1]);

    expect([...new Set(named)].sort()).toEqual(STEPS);
});

test("names only CLI commands that exist", () => {
    const commands = [...USAGE.matchAll(/^ {2}([a-z]+) /gm)].map((m) => m[1]);
    // Only in code -- fenced blocks and inline spans -- where a command is a command.
    const code = [...README.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)]
        .map((m) => m[1] ?? m[2])
        .join("\n");
    const named = [...code.matchAll(/(?:^|\s)craftpath ([a-z-]+)/gm)].map((m) => m[1]);

    expect(named.length).toBeGreaterThan(0);
    expect([...new Set(named)].filter((c) => !commands.includes(c))).toEqual([]);
});

/** C-00006 S8: this repo's docs point at the test-first principle, not the old rule. */
const CLAUDE_MD = await Bun.file(new URL("../CLAUDE.md", import.meta.url)).text();

function expectPointsAtTestFirst(doc: string) {
    expect(doc).toContain("`test-first` skill");
    expect(doc).not.toContain(".claude/rules/tdd.md");
    expect(doc).not.toContain("`tdd` skill");
}

test("CLAUDE.md points at the test-first principle", () => {
    expectPointsAtTestFirst(CLAUDE_MD);
});

test("the README points at the test-first principle", () => {
    expectPointsAtTestFirst(README);
});

/** C-00010 S8: this repo's docs point at the engineering principles, not the discipline skills. */
test("CLAUDE.md points at the engineering principles, not the discipline skills", () => {
    for (const name of [
        "fix-root-causes",
        "boundary-discipline",
        "laziness-protocol",
        "foundational-thinking",
        "sequence-verifiable-units",
    ])
        expect(CLAUDE_MD, name).toContain(`\`${name}\``);
    for (const name of ["backend", "frontend", "infrastructure"])
        expect(CLAUDE_MD, name).not.toContain(`\`${name}\``);
});

/** C-00015 S1: this repo's docs name the verify step; review is gone. */
test("S1 README and CLAUDE.md name verify, never review", () => {
    for (const [name, doc] of [
        ["README.md", README],
        ["CLAUDE.md", CLAUDE_MD],
    ] as const) {
        expect(doc, name).toContain("/craftpath-verify");
        expect(doc, name).not.toContain("/craftpath-review");
    }
    expect(README).toContain("[steps.verify.claude-code]");
    expect(README).not.toContain("[steps.review.claude-code]");
});
