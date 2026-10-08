/**
 * `craftpath init`: installs craftpath into a project, and is re-run to update.
 *
 * It writes config once (then it is yours), and on every run the scripts,
 * templates, harness commands, skills and the guard wiring -- replacing a file
 * you did not edit, and keeping one you did, with the new version beside it.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { init } from "../../src/init";
import { cleanScratch, scratch } from "../scratch";

afterAll(cleanScratch);

const ASSETS = new URL("../../assets", import.meta.url).pathname;

async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
    const lines: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    console.error = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
        return { value: await fn(), out: lines.join("\n") };
    } finally {
        console.log = log;
        console.error = err;
    }
}

/** A git repository on `main` with a Bun project in it. */
async function project(): Promise<string> {
    const root = await scratch("craftpath-init-");
    await Bun.write(join(root, "package.json"), '{"name":"app","scripts":{"test":"bun test"}}\n');
    await Bun.$`git -C ${root} init -q -b main`.quiet();
    await Bun.$`git -C ${root} -c user.email=t@e.c -c user.name=T commit -q --allow-empty -m base`.quiet();
    return root;
}

const read = (root: string, path: string) => Bun.file(join(root, path)).text();
const exists = (root: string, path: string) => Bun.file(join(root, path)).exists();

describe("init for Claude Code", () => {
    test("writes config, scripts, templates, the spec command, skills and the rule", async () => {
        const root = await project();

        const { value: exit } = await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(exit).toBe(0);
        const config = Bun.TOML.parse(await read(root, ".craftpath/config.toml")) as {
            git: { base_branch: string };
            modules: { app: { path: string; test: string } };
        };
        expect(config.git.base_branch).toBe("main");
        expect(config.modules.app).toMatchObject({ path: "./", test: "bun run test" });
        for (const path of [
            ".craftpath/scripts/guard.py",
            ".craftpath/scripts/spec.py",
            ".craftpath/templates/SPEC.md",
            ".craftpath/manifest.json",
            ".claude/skills/backend/SKILL.md",
            ".claude/rules/tdd.md",
        ]) {
            expect({ path, exists: await exists(root, path) }).toEqual({ path, exists: true });
        }
        const spec = await read(root, ".claude/commands/craftpath/spec.md");
        expect(spec).toContain("disable-model-invocation: true");
        expect(spec).toContain("allowed-tools: Bash(python3 .craftpath/scripts/spec.py:*)");
        expect(spec).toContain('!`python3 .craftpath/scripts/spec.py "$ARGUMENTS"`');
        expect(spec).not.toContain("{{");
    });

    test("wires the guard as a UserPromptExpansion hook, keeping the rest of settings.json", async () => {
        const root = await project();
        await Bun.write(
            join(root, ".claude/settings.json"),
            JSON.stringify({
                model: "sonnet",
                hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] },
            }),
        );

        await quietly(() => init(root, ["--harness", "claude-code"]));
        await quietly(() => init(root, ["--harness", "claude-code"]));

        const settings = JSON.parse(await read(root, ".claude/settings.json"));
        expect(settings.model).toBe("sonnet");
        expect(settings.hooks.Stop).toHaveLength(1);
        expect(settings.hooks.UserPromptExpansion).toEqual([
            {
                matcher: "craftpath:.*",
                hooks: [
                    {
                        type: "command",
                        command: 'python3 "$CLAUDE_PROJECT_DIR/.craftpath/scripts/guard.py"',
                        timeout: 30,
                    },
                ],
            },
        ]);
    });

    test("leaves a malformed settings.json untouched and says so", async () => {
        const root = await project();
        await Bun.write(join(root, ".claude/settings.json"), "{ not json");

        const { value: exit, out } = await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(exit).toBe(1);
        expect(out).toContain(".claude/settings.json");
        expect(await read(root, ".claude/settings.json")).toBe("{ not json");
        expect(await exists(root, ".claude/commands/craftpath/spec.md")).toBe(true);
    });
});

describe("init for pi", () => {
    test("writes the extension, the command bodies and the skills", async () => {
        const root = await project();

        const { value: exit } = await quietly(() => init(root, ["--harness", "pi"]));

        expect(exit).toBe(0);
        expect(await exists(root, ".pi/extensions/craftpath.ts")).toBe(true);
        expect(await exists(root, ".pi/skills/backend/SKILL.md")).toBe(true);
        expect(await exists(root, ".pi/skills/tdd/SKILL.md")).toBe(true);
        const spec = await read(root, ".pi/craftpath/commands/spec.md");
        expect(spec).toContain("{{RUN:spec}}"); // run by the extension, not by pi
        expect(spec).not.toContain("allowed-tools");
        expect(await exists(root, ".claude")).toBe(false);
    });
});

describe("re-running init updates", () => {
    test("config.toml is written once and then left alone", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code"]));
        await Bun.write(join(root, ".craftpath/config.toml"), "# mine\n");

        await quietly(() => init(root, ["--harness", "claude-code"]));

        expect(await read(root, ".craftpath/config.toml")).toBe("# mine\n");
    });

    test("a file you did not edit takes the new version; one you edited is kept, the new one beside it", async () => {
        const root = await project();
        await quietly(() => init(root, ["--harness", "claude-code"]));
        await Bun.write(join(root, ".craftpath/templates/SPEC.md"), "# my own spec template\n");

        // A newer release: every asset changed.
        const release = await scratch("craftpath-assets-");
        await cp(ASSETS, release, { recursive: true });
        for (const path of ["templates/SPEC.md", "scripts/guard.py"]) {
            const file = join(release, path);
            await Bun.write(file, `${await Bun.file(file).text()}\n# release 2\n`);
        }

        const { out } = await quietly(() =>
            init(root, ["--harness", "claude-code"], { assets: release }),
        );

        expect(await read(root, ".craftpath/scripts/guard.py")).toContain("# release 2");
        expect(await read(root, ".craftpath/templates/SPEC.md")).toBe("# my own spec template\n");
        expect(await read(root, ".craftpath/templates/SPEC.md.new")).toContain("# release 2");
        expect(out).toContain(".craftpath/templates/SPEC.md.new");
    });
});
