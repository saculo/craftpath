/**
 * `craftpath init [--harness claude-code,pi]` -- install craftpath into this
 * project, or update it: re-running is how a project takes a new release.
 */
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { ASSETS, assetFiles } from "./assets";
import { detectBaseBranch, detectCommands } from "./detect";
import { HARNESSES, type Harness, type HarnessId } from "./harness";
import { Installer, type Outcome } from "./install";

const GUARD = 'python3 "$CLAUDE_PROJECT_DIR/.craftpath/scripts/guard.py"';

export interface InitOptions {
    /** A different assets directory -- how tests stand in for a newer release. */
    assets?: string;
}

export async function init(
    root: string,
    args: string[],
    options: InitOptions = {},
): Promise<number> {
    const harnesses = await selected(root, args);
    if (harnesses === null) return 2;
    const assets = options.assets ?? ASSETS;
    const installer = await Installer.open(root);
    const report: string[] = [];
    const write = async (path: string, text: string) => {
        const outcome: Outcome = await installer.write(path, text);
        if (outcome === "kept")
            report.push(`kept      ${path} (edited) -- new version in ${path}.new`);
        else if (outcome !== "unchanged") report.push(`${outcome.padEnd(9)} ${path}`);
    };

    await writeConfig(root, report);
    for (const [rel, text] of Object.entries(await assetFiles(assets, "scripts"))) {
        await write(`.craftpath/scripts/${rel}`, text);
    }
    for (const [rel, text] of Object.entries(await assetFiles(assets, "templates"))) {
        await write(`.craftpath/templates/${rel}`, text);
    }

    let refused = false;
    for (const harness of harnesses) {
        for (const [rel, source] of Object.entries(await assetFiles(assets, "commands"))) {
            await write(
                harness.commandPath(rel.replace(/\.md$/, "")),
                harness.renderCommand(source),
            );
        }
        for (const [rel, text] of Object.entries(await assetFiles(assets, "skills"))) {
            await write(harness.skillPath(rel.split("/")[0]!), harness.render(text));
        }
        for (const [name, text] of Object.entries(await assetFiles(assets, "rules"))) {
            await write(harness.rulePath(name), harness.renderRule(name, harness.render(text)));
        }
        if (harness.id === "pi") {
            await write(
                ".pi/extensions/craftpath.ts",
                (await assetFiles(assets, "pi"))["craftpath.ts"]!,
            );
        } else {
            const problem = await wireGuard(root);
            if (problem !== null) {
                refused = true;
                report.push(problem);
            } else report.push("wired     .claude/settings.json (UserPromptExpansion guard)");
        }
    }

    await installer.save(pkg.version);
    for (const line of report) console.log(line);
    return refused ? 1 : 0;
}

/** `--harness a,b`; otherwise whichever the project already has, else Claude Code. */
async function selected(root: string, args: string[]): Promise<Harness[] | null> {
    const i = args.indexOf("--harness");
    if (i !== -1) {
        const ids = (args[i + 1] ?? "").split(",").filter(Boolean);
        const unknown = ids.filter((id) => !(id in HARNESSES));
        if (ids.length === 0 || unknown.length > 0) {
            console.error(`--harness takes claude-code, pi or both; got: ${args[i + 1] ?? ""}`);
            return null;
        }
        return ids.map((id) => HARNESSES[id as HarnessId]);
    }
    const found: Harness[] = [];
    if (await isDir(join(root, ".claude"))) found.push(HARNESSES["claude-code"]);
    if (await isDir(join(root, ".pi"))) found.push(HARNESSES.pi);
    return found.length > 0 ? found : [HARNESSES["claude-code"]];
}

async function isDir(path: string): Promise<boolean> {
    return (await Bun.$`test -d ${path}`.quiet().nothrow()).exitCode === 0;
}

/** Written once; after that the file is the project's. */
async function writeConfig(root: string, report: string[]): Promise<void> {
    const path = join(root, ".craftpath/config.toml");
    if (await Bun.file(path).exists()) return;
    const test = (await detectCommands(root)).test ?? "";
    const base = (await detectBaseBranch(root)) ?? "main";
    await Bun.write(
        path,
        [
            "# craftpath configuration -- yours to edit; `craftpath init` never rewrites it.",
            "",
            "[git]",
            `base_branch = ${JSON.stringify(base)}   # work item branches start here`,
            "",
            "# A module is a directory with its own test and build commands. A task's",
            "# changed files pick the modules whose tests must pass for it to complete.",
            "[modules.app]",
            'path = "./"',
            `test = ${JSON.stringify(test)}`,
            'build = ""',
            "",
        ].join("\n"),
    );
    report.push("wrote     .craftpath/config.toml");
}

/** Adds the guard hook once; never rewrites a settings file it cannot parse. */
async function wireGuard(root: string): Promise<string | null> {
    const path = join(root, ".claude/settings.json");
    const file = Bun.file(path);
    let settings: { hooks?: Record<string, unknown[]> } = {};
    if (await file.exists()) {
        try {
            settings = JSON.parse(await file.text());
        } catch {
            return "refused   .claude/settings.json is not valid JSON; the guard is NOT wired. Fix it and re-run init.";
        }
    }
    settings.hooks ??= {};
    settings.hooks.UserPromptExpansion ??= [];
    const entries = settings.hooks.UserPromptExpansion as { hooks?: { command?: string }[] }[];
    if (!entries.some((e) => e.hooks?.some((h) => h.command === GUARD))) {
        entries.push({
            matcher: "craftpath:.*",
            hooks: [{ type: "command", command: GUARD, timeout: 30 }],
        } as never);
    }
    await Bun.write(path, `${JSON.stringify(settings, null, 2)}\n`);
    return null;
}
