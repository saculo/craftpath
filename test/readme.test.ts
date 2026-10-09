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
