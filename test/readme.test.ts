/**
 * C2: the README names exactly the steps `init` installs, and only CLI
 * commands that exist -- so it cannot quietly describe a flow that is gone.
 */
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** C-00018 S4: AGENTS.md carries one general search rule, no tool-by-tool instructions. */
test("AGENTS.md carries one rule pointing at modern-cli-tools", async () => {
    const file = Bun.file(new URL("../AGENTS.md", import.meta.url));

    expect(await file.exists()).toBe(true);
    const doc = await file.text();
    expect(doc).toContain("`modern-cli-tools`");
    expect(doc.match(/modern-cli-tools/g)).toHaveLength(1);
    for (const tool of ["rg", "fd", "zoxide", "ast-grep", "sg"]) {
        expect(doc, tool).not.toMatch(new RegExp(`(?<![\\w-])${tool}(?![\\w-])`));
    }
});

/** C-00018 S5: CLAUDE.md imports AGENTS.md and is otherwise what it was on master. */
const withoutImport = (s: string) =>
    s
        .split("\n")
        .filter((l) => l !== "@AGENTS.md")
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");

/** The CLAUDE.md check: null when `root`'s CLAUDE.md matches the committed base, else a diff-style message. */
async function claudeMdProblem(root: string): Promise<string | null> {
    const actual = withoutImport(await Bun.file(`${root}/CLAUDE.md`).text());
    const base = withoutImport(await Bun.file(`${root}/test/fixtures/CLAUDE.base.md`).text());
    if (actual === base) return null;
    const a = actual.split("\n");
    const b = base.split("\n");
    const i = a.findIndex((l, n) => l !== b[n]);
    const at = i === -1 ? Math.min(a.length, b.length) : i;
    return [
        `CLAUDE.md differs from test/fixtures/CLAUDE.base.md at line ${at + 1}:`,
        `- fixture: ${b[at] ?? "(end of file)"}`,
        `+ CLAUDE.md: ${a[at] ?? "(end of file)"}`,
        "If the CLAUDE.md edit is deliberate, update test/fixtures/CLAUDE.base.md to match.",
    ].join("\n");
}

const REPO = new URL("..", import.meta.url).pathname;

/** A scratch `git init -b trunk` clone-like directory holding CLAUDE.md and the fixture: no master branch. */
async function trunkClone(claudeMd: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "claude-md-"));
    await mkdir(`${dir}/test/fixtures`, { recursive: true });
    await Bun.write(`${dir}/CLAUDE.md`, claudeMd);
    await Bun.write(
        `${dir}/test/fixtures/CLAUDE.base.md`,
        await Bun.file(`${REPO}/test/fixtures/CLAUDE.base.md`).text(),
    );
    await Bun.$`git init -q -b trunk ${dir}`.quiet();
    return dir;
}

test("CLAUDE.md imports AGENTS.md and is otherwise unchanged", async () => {
    expect(CLAUDE_MD.split("\n").filter((l) => l === "@AGENTS.md")).toHaveLength(1);
    expect(await claudeMdProblem(REPO)).toBeNull();
});

test("the CLAUDE.md check passes in a clone that has no master branch", async () => {
    const dir = await trunkClone(CLAUDE_MD);
    try {
        expect(await claudeMdProblem(dir)).toBeNull();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test("the CLAUDE.md check reports a real change as a failure", async () => {
    const dir = await trunkClone(`${CLAUDE_MD}\nAn unrelated extra line.\n`);
    try {
        const problem = await claudeMdProblem(dir);
        expect(problem).toContain("An unrelated extra line.");
        expect(problem).toContain("CLAUDE.base.md");
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

/** C-00018 S6: the README recommends the four search tools, as optional. */
test("README recommends the four search tools as optional", () => {
    const start = README.indexOf("### Recommended tools");
    expect(start).toBeGreaterThan(-1);
    const section = README.slice(start).split(/\n#{1,3} (?!Recommended tools)/)[0]!;
    const lines = section.split("\n");

    for (const tool of ["rg", "fd", "zoxide", "ast-grep"]) {
        const line = lines.find((l) => l.includes(`\`${tool}\``));
        expect(line, tool).toBeDefined();
        expect(
            line!.replace(`\`${tool}\``, "").replace(/[-*:\s]/g, "").length,
            `${tool} reason`,
        ).toBeGreaterThan(10);
    }
    expect(section).toMatch(/optional/i);
    expect(section).toMatch(/works? without/i);
});
