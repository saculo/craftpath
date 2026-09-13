/**
 * `craftpath init` -- scaffold the harness in the current repository.
 *
 * Creates .craftpath/ (config + directories) and merges guard hooks into
 * .claude/settings.json. Idempotent: re-running never clobbers an existing
 * config or duplicates a hook entry.
 *
 * No stack detection (D21). The user writes config.toml by hand -- a guessed
 * command that silently does nothing is worse than a blank one.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { INVESTIGATE_COMMAND } from "../commands/investigate";
import { PR_COMMAND } from "../commands/pr";
import { STATUS_COMMAND } from "../commands/status";
import { WORK_COMMAND } from "../commands/work";
import { ADR_TEMPLATE } from "../templates/adr";
import { CHANGELOG_TEMPLATE } from "../templates/changelog";
import { CONTEXT_TEMPLATE } from "../templates/context";
import { DESIGN_TEMPLATE } from "../templates/design";
import { FINDING_TEMPLATE } from "../templates/finding";
import { PLAN_TEMPLATE } from "../templates/plan";
import { PR_BODY_TEMPLATE } from "../templates/pr-body";
import { REQUIREMENT_TEMPLATE } from "../templates/requirement";
import { RESULT_TEMPLATE } from "../templates/result";
import { RULES_README } from "../templates/rules-readme";
import { SKILLS_README } from "../templates/skills-readme";
import { SPEC_DELTA_TEMPLATE } from "../templates/spec-delta";
import { SPEC_TEMPLATE } from "../templates/spec";
import { TASK_TEMPLATE } from "../templates/task";

/**
 * Directories created by init.
 *
 * Per-work-item files (spec-delta.md, changelog.md, tasks/) are NOT created
 * here -- there is no work item yet. They are scaffolded from
 * `.craftpath/templates/` by `craftpath work new`.
 */
const DIRS = [
    // harness data
    ".craftpath/work",              // model space
    ".craftpath/state",             // trusted kernel; per-work logs/ live inside
    ".craftpath/specs",             // durable capability specs
    ".craftpath/decisions",         // ADRs, append-only
    ".craftpath/templates",         // artifact scaffolds
    ".craftpath/archive",           // completed work items
    // claude code surface
    ".claude/skills",
    ".claude/commands/craftpath",
    ".claude/hooks",                // project hook scripts, if you add any
    ".claude/rules",                // path-scoped conventions
];

/** Directories that start empty and would otherwise not survive a clone. */
const KEEP = [
    ".craftpath/work",
    ".craftpath/state",
    ".craftpath/specs",
    ".craftpath/decisions",
    ".craftpath/archive",
    ".claude/hooks",
];

const COMMANDS: Record<string, string> = {
    "work.md": WORK_COMMAND,
    "investigate.md": INVESTIGATE_COMMAND,
    "pr.md": PR_COMMAND,
    "status.md": STATUS_COMMAND,
};

const TEMPLATES: Record<string, string> = {
    "requirement.md": REQUIREMENT_TEMPLATE,
    "context.md": CONTEXT_TEMPLATE,
    "design.md": DESIGN_TEMPLATE,
    "plan.md": PLAN_TEMPLATE,
    "result.md": RESULT_TEMPLATE,
    "task.md": TASK_TEMPLATE,
    "spec.md": SPEC_TEMPLATE,
    "spec-delta.md": SPEC_DELTA_TEMPLATE,
    "changelog.md": CHANGELOG_TEMPLATE,
    "adr.md": ADR_TEMPLATE,
    "pr-body.md": PR_BODY_TEMPLATE,
    "finding.md": FINDING_TEMPLATE,
};

const CONFIG = `# Craftpath configuration.
#
# Every command referenced by a task's \`verify\` is defined here, so plans stay
# repo-agnostic and there is exactly one place to change an invocation.
# Fill these in by hand -- a guessed command that silently does nothing is worse
# than a blank one.

[commands.test]
run = ""                 # e.g. "bun test" / "./gradlew test" / "pytest"
# How this runner scopes ONE test. {selector} is substituted, shell-quoted.
#   "-t {selector}"          bun, jest        "-k {selector}"            pytest
#   "--tests {selector}"     gradle           "-Dtest={selector}"        maven
#   "-run {selector} ./..."  go
# selector_template = "-t {selector}"

[commands.lint]
run = ""

[skills.backend]
default_verify = ["test"]

[gates]
requirement = "auto"
plan = "auto_if_simple"  # auto when <=2 tasks and no infra/security skill
result = "manual"

[git]
work_branch_prefix = "work/"
`;

const GUARDS = [
    {
        matcher: "Edit|Write|MultiEdit|NotebookEdit",
        hooks: [{ type: "command", command: "craftpath hook guard-write", timeout: 5 }],
    },
    {
        matcher: "Bash",
        hooks: [{ type: "command", command: "craftpath hook guard-bash", timeout: 5 }],
    },
];

const STOP = {
    hooks: [{ type: "command", command: "craftpath validate", timeout: 30 }],
};

type Settings = {
    hooks?: Record<string, unknown[]>;
    [k: string]: unknown;
};

/** True if an equivalent hook command is already registered. */
function alreadyWired(existing: unknown[], command: string): boolean {
    return existing.some((entry) => {
        const hooks = (entry as { hooks?: { command?: string }[] })?.hooks ?? [];
        return hooks.some((h) => h.command === command);
    });
}

/**
 * Write the slash commands into `.claude/commands/craftpath/`.
 *
 * A file at `commands/craftpath/work.md` registers as `/craftpath:work` --
 * the directory is the namespace. These are generated and always overwritten,
 * which is what makes `craftpath update` work after a package upgrade.
 */
export async function writeCommands(root: string): Promise<number> {
    const dir = join(root, ".claude/commands/craftpath");
    await mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(COMMANDS)) {
        await Bun.write(join(dir, name), body);
    }
    return Object.keys(COMMANDS).length;
}

export async function init(root: string): Promise<void> {
    for (const dir of DIRS) {
        await mkdir(join(root, dir), { recursive: true });
    }

    // Git does not track empty directories, so the layout would vanish on clone.
    for (const dir of KEEP) {
        const path = join(root, dir, ".gitkeep");
        if (!(await Bun.file(path).exists())) await Bun.write(path, "");
    }

    const configPath = join(root, ".craftpath/config.toml");
    if (await Bun.file(configPath).exists()) {
        console.log("kept      .craftpath/config.toml (already present)");
    } else {
        await Bun.write(configPath, CONFIG);
        console.log("created   .craftpath/config.toml");
    }

    // state/ is committed: without it there is no resume across machines and CI
    // cannot validate. Logs are noise, so they stay out.
    const ignorePath = join(root, ".craftpath/.gitignore");
    if (!(await Bun.file(ignorePath).exists())) {
        await Bun.write(ignorePath, "state/*/logs/\n");
    }

    let written = 0;
    for (const [name, body] of Object.entries(TEMPLATES)) {
        const path = join(root, ".craftpath/templates", name);
        if (!(await Bun.file(path).exists())) {
            await Bun.write(path, body);
            written++;
        }
    }
    console.log(
        written > 0
            ? `created   .craftpath/templates/ (${written} templates)`
            : "kept      .craftpath/templates/ (already present)",
    );

    // Seed the two .claude dirs that would otherwise be empty and confusing.
    for (const [rel, body] of [
        [".claude/rules/README.md", RULES_README],
        [".claude/skills/README.md", SKILLS_README],
    ] as const) {
        const path = join(root, rel);
        if (!(await Bun.file(path).exists())) await Bun.write(path, body);
    }

    const settingsPath = join(root, ".claude/settings.json");

    let settings: Settings = {};
    if (await Bun.file(settingsPath).exists()) {
        try {
            settings = JSON.parse(await Bun.file(settingsPath).text()) as Settings;
        } catch {
            console.error("!! .claude/settings.json is not valid JSON; leaving it alone");
            return;
        }
    }

    settings.hooks ??= {};
    settings.hooks.PreToolUse ??= [];
    settings.hooks.Stop ??= [];

    let added = 0;
    for (const guard of GUARDS) {
        const command = guard.hooks[0]!.command;
        if (!alreadyWired(settings.hooks.PreToolUse, command)) {
            settings.hooks.PreToolUse.push(guard);
            added++;
        }
    }
    if (!alreadyWired(settings.hooks.Stop, STOP.hooks[0]!.command)) {
        settings.hooks.Stop.push(STOP);
        added++;
    }

    await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(
        added > 0
            ? `wired     .claude/settings.json (${added} hook${added > 1 ? "s" : ""})`
            : "kept      .claude/settings.json (hooks already wired)",
    );

    const n = await writeCommands(root);
    console.log(`wrote     .claude/commands/craftpath/ (${n} slash commands)`);

    warnIfUnresolvable();

    console.log("\nNext:");
    console.log("  1. fill in the commands in .craftpath/config.toml");
    console.log("  2. restart Claude Code, then run /craftpath:work in chat");
}

/**
 * The hooks just written invoke `craftpath` by name. If that does not resolve,
 * Claude Code cannot run them -- and because guards fail open (D24), the result
 * is not a visible error but a silently unprotected `.craftpath/state/`.
 *
 * So the warning is phrased as the property that is missing rather than as a
 * missing command: "craftpath not found" reads as cosmetic, "state writes will
 * not be blocked" reads as what it actually is.
 *
 * Deliberately not fatal. Init is idempotent and a half-set-up project is worse
 * than a fully set-up one carrying a warning.
 */
function warnIfUnresolvable(): void {
    if (Bun.which("craftpath") !== null) return;
    console.error(
        "\n!! `craftpath` is not on PATH, so the hooks just wired cannot run.\n" +
        "   Guards fail open, so writes to .craftpath/state/ will NOT be blocked.\n" +
        "   Fix with:  bun link craftpath",
    );
}
