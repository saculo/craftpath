/**
 * The texts that describe craftpath, checked against craftpath.
 *
 * USAGE is hand-written, the generated commands are prose, and the README is a
 * walkthrough -- and each drifted from the code: flags USAGE never mentioned,
 * commands that fail with two open work items, ids and trailers in a format
 * the CLI stopped writing. These compare each text with the thing it
 * describes -- the route map as stricli reports it, the work-scoped commands,
 * the artifacts each mode scaffolds -- rather than grepping for phrases.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { USAGE } from "../cli/app";
import { ARTIFACTS } from "../core/work";
import { CLAUDE_CODE } from "../harness/claude-code";
import { PI } from "../harness/pi";
import { render } from "../harness/render";
import { COMMANDS } from "./index";

const ROOT = join(import.meta.dir, "../..");
const CLI = join(ROOT, "bin/craftpath.ts");

async function help(path: string[]): Promise<string> {
    const p = Bun.spawn([process.execPath, CLI, ...path, "--help"], { stdout: "pipe" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return out;
}

/** Every routed command, with the flags stricli accepts for it. */
async function routes(path: string[] = []): Promise<Map<string, string[]>> {
    const found = new Map<string, string[]>();
    const usage = (await help(path)).split("\n\n")[0]!;
    for (const line of usage.split("\n").slice(1)) {
        const tokens = line.trim().split(/\s+/).slice(1);
        // stricli lists `<command> --help` after each command's own usage line.
        if (tokens.length === 0 || tokens.at(-1) === "--help") continue;
        const names = tokens.slice(path.length).filter((t) => /^[a-z][\w|-]*$/.test(t));
        const head = [...path, ...tokens.slice(path.length, path.length + names.length)];
        const last = head.at(-1)!;
        if (last.includes("|")) {
            for (const alt of last.split("|")) {
                for (const [k, v] of await routes([...head.slice(0, -1), alt])) found.set(k, v);
            }
        } else if (tokens.includes("...")) {
            for (const [k, v] of await routes(head)) found.set(k, v);
        } else {
            found.set(
                head.join(" "),
                [...line.matchAll(/--([a-z][\w-]*)/g)].map((m) => m[1]!),
            );
        }
    }
    return found;
}

/** USAGE entries by command path: the entry line plus its continuation lines. */
function usageEntries(): Map<string, string> {
    const entries = new Map<string, string>();
    let current: string | null = null;
    for (const line of USAGE.split("\n")) {
        if (/^ {2}\S/.test(line)) {
            // The description starts after a run of spaces; the path ends at
            // the first argument or flag.
            const tokens = line
                .trim()
                .split(/\s{2,}/)[0]!
                .split(/\s+/);
            const end = tokens.findIndex((t) => /^[[(<"-]/.test(t));
            current = tokens.slice(0, end === -1 ? tokens.length : end).join(" ");
            entries.set(current, `${entries.get(current) ?? ""}${line}\n`);
        } else if (current !== null && /^ {3,}\S/.test(line)) {
            entries.set(current, `${entries.get(current)}${line}\n`);
        } else {
            current = null;
        }
    }
    return entries;
}

describe("USAGE matches the route map", () => {
    test("every routed command is listed, with every flag it accepts", async () => {
        const entries = usageEntries();
        const missing: string[] = [];
        for (const [command, flags] of await routes()) {
            const entry = entries.get(command);
            if (entry === undefined) {
                missing.push(command);
                continue;
            }
            for (const flag of flags) {
                if (!entry.includes(`--${flag}`)) missing.push(`${command} --${flag}`);
            }
        }
        expect(missing).toEqual([]);
    });

    test("every listed command is routed", async () => {
        const routed = await routes();
        const listed = [...usageEntries().keys()].filter((c) => !c.startsWith("hook"));
        expect(listed.filter((c) => !routed.has(c))).toEqual([]);
    });

    test("commands without --work say they are repository-wide", async () => {
        const entries = usageEntries();
        const unscoped = [...(await routes()).entries()]
            .filter(
                ([command, flags]) =>
                    !flags.includes("work") && !/^(init|update|version|work new)$/.test(command),
            )
            .map(([command]) => command);
        expect(unscoped.sort()).toEqual(["doctor", "reconcile"]);
        for (const command of unscoped) expect(entries.get(command)).toContain("repository-wide");
    });
});

/** Work-scoped commands: each operates on exactly one selected work item. */
const SCOPED =
    /craftpath (?:task (?:add|start|verify|done|resume|ack|next|report)|amend|approve|validate|pr body|archive)\b[^`\n]*/g;

describe("generated commands select their work item", () => {
    for (const harness of [CLAUDE_CODE, PI]) {
        test(`every work-scoped command passes --work (${harness.id})`, () => {
            const unselected: string[] = [];
            for (const [file, body] of Object.entries(COMMANDS)) {
                for (const [use] of render(body, harness).matchAll(SCOPED)) {
                    if (!use.includes("--work")) unselected.push(`${file}: ${use.trim()}`);
                }
            }
            expect(unselected).toEqual([]);
        });
    }

    test("examples use canonical W-prefixed work ids", () => {
        for (const [file, body] of Object.entries(COMMANDS)) {
            expect({ file, legacy: body.match(/(?<![\w-])\d{4}-[a-z][a-z-]*/g) ?? [] }).toEqual({
                file,
                legacy: [],
            });
        }
    });
});

describe("the README describes what the code does", () => {
    const readme = () => Bun.file(join(ROOT, "README.md")).text();

    test("its ids and trailers are the ones the CLI writes and task done looks for", async () => {
        const text = await readme();
        expect(text.match(/(?<![\w-])\d{4}-[a-z][a-z-]*/g) ?? []).toEqual([]);
        expect(text).toContain("`Work: W-0001-avatar-upload`");
    });

    test("it does not describe pi's removed bespoke task runner", async () => {
        expect(await readme()).not.toContain("craftpath_task");
    });

    test("it documents both modes, with the artifacts each one scaffolds", async () => {
        const text = await readme();
        const section = text.slice(text.indexOf("### Modes"));
        expect(section.length).toBeLessThan(text.length);
        for (const artifact of [...ARTIFACTS.light, ...ARTIFACTS.standard]) {
            expect(section).toContain(artifact);
        }
        expect(section).toContain("--standard");
    });
});
