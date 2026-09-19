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
import { DESIGN_TEMPLATE, TASK_DESIGN_TEMPLATE } from "../templates/design";
import { FINDING_TEMPLATE } from "../templates/finding";
import { PLAN_TEMPLATE } from "../templates/plan";
import { REQUIREMENT_TEMPLATE } from "../templates/requirement";
import { RESULT_TEMPLATE } from "../templates/result";
import { RULES_README } from "../templates/rules-readme";
import { SKILLS_README } from "../templates/skills-readme";
import { SPEC_DELTA_TEMPLATE } from "../templates/spec-delta";
import { SPEC_TEMPLATE } from "../templates/spec";
import { TASK_TEMPLATE } from "../templates/task";
import { PreconditionError } from "../transitions";
import { installCommand } from "./install";
import { RULES } from "../rules/index";
import { SKILLS } from "../skills/index";

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
    "task-design.md": TASK_DESIGN_TEMPLATE,
    "plan.md": PLAN_TEMPLATE,
    "result.md": RESULT_TEMPLATE,
    "task.md": TASK_TEMPLATE,
    "spec.md": SPEC_TEMPLATE,
    "spec-delta.md": SPEC_DELTA_TEMPLATE,
    "changelog.md": CHANGELOG_TEMPLATE,
    "adr.md": ADR_TEMPLATE,
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
# "auto":   the agent records the approval itself and continues.
# "manual": the agent stops until a human approves.
requirement = "auto"
plan = "manual"
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

/**
 * `hook validate`, not `validate`: Claude Code blocks a stop only on exit 2,
 * and treats any other non-zero code as a hook error the model never sees.
 * `validate` exits 1 by design -- that is the code humans and CI read -- so the
 * hook gets a wrapper that runs the same checks and speaks the hook protocol.
 */
const STOP = {
    hooks: [{ type: "command", command: "craftpath hook validate", timeout: 30 }],
};

type Settings = {
    hooks?: Record<string, unknown[]>;
    [k: string]: unknown;
};

/**
 * `... craftpath[.ts] hook <name>` -> `hook <name>`; null when it is not ours.
 *
 * The tail is what identifies the hook, because the path in front of it is a
 * deployment detail: `craftpath`, `./bin/craftpath.ts` and
 * `bun /abs/bin/craftpath.ts` all wire the same guard.
 */
function hookTail(command: string): string | null {
    return /(?:^|[\s/])craftpath(?:\.ts)?\s+(hook\s+[\w-]+)\s*$/.exec(command)?.[1] ?? null;
}

/**
 * True if an equivalent hook command is already registered.
 *
 * Equivalent, not identical. A project wired as
 * `bun /abs/bin/craftpath.ts hook guard-write` IS wired, and adding craftpath's
 * own spelling beside it means every Edit pays for two hook spawns, one of
 * which cannot resolve -- while both entries claim the guard is active.
 */
function alreadyWired(existing: unknown[], command: string): boolean {
    const wanted = hookTail(command);
    return existing.some((entry) => {
        const hooks = (entry as { hooks?: { command?: string }[] })?.hooks ?? [];
        return hooks.some((h) => {
            if (typeof h.command !== "string") return false;
            return h.command === command || (wanted !== null && hookTail(h.command) === wanted);
        });
    });
}

/**
 * Why this settings.json cannot be merged into, or null when it can.
 *
 * `settings.hooks.PreToolUse ??= []` leaves a hand-edited non-array in place,
 * and `alreadyWired` then calls `.some` on it -- an uncaught TypeError with a
 * source dump, thrown after the templates and skills were already written.
 * Same class of problem as unparseable JSON, so it gets the same handling.
 */
function hooksProblem(settings: Settings): string | null {
    const hooks: unknown = settings.hooks;
    if (hooks !== undefined && (typeof hooks !== "object" || hooks === null || Array.isArray(hooks))) {
        return "hooks is not an object";
    }
    for (const event of ["PreToolUse", "Stop"]) {
        const value = (hooks as Record<string, unknown> | undefined)?.[event];
        if (value !== undefined && !Array.isArray(value)) return `hooks.${event} is not a list`;
    }
    return null;
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

/**
 * Writes craftpath's skills and rules into the project.
 *
 * The work command loads each task's skills by name and stops when one is
 * missing, so a project without them cannot get past planning.
 *
 * Written from src/skills and src/rules -- never read from craftpath's own
 * `.claude/`, which is internal tooling for developing craftpath and does not
 * ship.
 *
 * Never overwrites, the same rule templates follow. A skill whose SKILL.md
 * exists is the project's; `update` re-runs this so a newer craftpath can add
 * skills to a project initialised before they existed.
 */
export async function installSkills(root: string): Promise<{ skills: number; rules: number }> {
    let skills = 0;
    let rules = 0;

    for (const [name, body] of Object.entries(SKILLS)) {
        const path = join(root, ".claude/skills", name, "SKILL.md");
        if (await Bun.file(path).exists()) continue;
        await Bun.write(path, body);
        skills++;
    }

    for (const [name, body] of Object.entries(RULES)) {
        const path = join(root, ".claude/rules", name);
        if (await Bun.file(path).exists()) continue;
        await Bun.write(path, body);
        rules++;
    }

    return { skills, rules };
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

    // state/ is committed, evidence logs included: without it there is no
    // resume across machines, and validate re-reads every log against its
    // recorded exit code -- so logs left out of git fail validation everywhere
    // but the machine that ran the tests.

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

    const installed = await installSkills(root);
    console.log(
        installed.skills + installed.rules > 0
            ? `installed .claude/skills/ (${installed.skills} skill${installed.skills === 1 ? "" : "s"}), ` +
              `.claude/rules/ (${installed.rules} rule${installed.rules === 1 ? "" : "s"})`
            : "kept      .claude/skills/ and .claude/rules/ (already present)",
    );

    const settingsPath = join(root, ".claude/settings.json");

    // Unreadable settings costs the hooks, not the rest of the install. The old
    // code returned here -- before the slash commands and before the PATH
    // warning -- and the CLI then exited 0, so `init` reported success having
    // written no hooks and no slash commands, which is the whole workflow.
    let unwired: string | null = null;
    let settings: Settings = {};
    if (await Bun.file(settingsPath).exists()) {
        try {
            settings = JSON.parse(await Bun.file(settingsPath).text()) as Settings;
        } catch {
            unwired = "it is not valid JSON";
        }
    }
    unwired ??= hooksProblem(settings);

    if (unwired !== null) {
        console.error(
            `\n!! .claude/settings.json was left untouched: ${unwired}.\n` +
            "   No guard hooks and no Stop hook are wired: writes to .craftpath/state/\n" +
            "   will NOT be blocked, and `craftpath validate` will not run on stop.\n" +
            "   Fix it, then re-run `craftpath init` -- it is idempotent.",
        );
    }

    let added = 0;
    if (unwired === null) {
        settings.hooks ??= {};
        settings.hooks.PreToolUse ??= [];
        settings.hooks.Stop ??= [];

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
    }

    // Never overwrite a file we could not merge into: it is the user's, and it
    // may hold settings this code knows nothing about.
    if (unwired === null) {
        await Bun.write(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        console.log(
            added > 0
                ? `wired     .claude/settings.json (${added} hook${added > 1 ? "s" : ""})`
                : "kept      .claude/settings.json (hooks already wired)",
        );
    }

    const n = await writeCommands(root);
    console.log(`wrote     .claude/commands/craftpath/ (${n} slash commands)`);

    // Only when hooks exist to run: the warning's premise is "the hooks just
    // wired", and a warning whose premise is false teaches people to skip the
    // ones whose premise is true.
    if (unwired === null) warnIfUnresolvable();

    console.log("\nNext:");
    console.log("  1. fill in the commands in .craftpath/config.toml");
    console.log("  2. restart Claude Code, then run /craftpath:work in chat");

    // Everything that could be installed is installed, so this is deliberately
    // the last statement: a half-set-up project is worse than a fully set-up one
    // carrying a warning. But exiting 0 would report success for an install that
    // left the trust boundary unenforced, so the exit code says otherwise.
    if (unwired !== null) {
        throw new PreconditionError(
            `init finished, but .claude/settings.json ${unwired}, so no hooks were wired.`,
        );
    }
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
        `   Fix with:  ${installCommand()}`,
    );
}
