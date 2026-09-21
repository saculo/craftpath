/**
 * `craftpath init` -- scaffold the harness in the current repository.
 *
 * Creates .craftpath/ (config + directories) and asks the harness to wire its
 * guards. Idempotent: re-running never clobbers an existing config or
 * duplicates a hook entry.
 *
 * Everything harness-shaped -- where skills, rules and commands land, how the
 * guards are wired, what the operator does next -- comes from the `Harness`
 * descriptor, so a second harness is a descriptor rather than a second init.
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
import { type Harness, DEFAULT_HARNESS } from "../harness/index";
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
    ".craftpath/work", // model space
    ".craftpath/state", // trusted kernel; per-work logs/ live inside
    ".craftpath/specs", // durable capability specs
    ".craftpath/decisions", // ADRs, append-only
    ".craftpath/templates", // artifact scaffolds
    ".craftpath/archive", // completed work items
];

/** Directories that start empty and would otherwise not survive a clone. */
const KEEP = [
    ".craftpath/work",
    ".craftpath/state",
    ".craftpath/specs",
    ".craftpath/decisions",
    ".craftpath/archive",
];

/** The harness's own surface, created so `init` leaves a legible layout. */
function harnessDirs(harness: Harness): string[] {
    return [
        harness.skillsDir,
        harness.commandsDir,
        harness.rulesDir,
        ...harness.scaffoldDirs,
    ].filter((d): d is string => d !== null);
}

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

/**
 * Write the slash commands into the harness's command directory.
 *
 * The harness decides both the directory and the file name, because harnesses
 * namespace commands differently: Claude Code takes the namespace from the
 * directory (`commands/craftpath/work.md` -> `/craftpath:work`), while a flat
 * prompt directory has to carry it in the file name.
 *
 * These are generated and always overwritten, which is what makes
 * `craftpath update` work after a package upgrade.
 */
export async function writeCommands(
    root: string,
    harness: Harness = DEFAULT_HARNESS,
): Promise<number> {
    const dir = join(root, harness.commandsDir);
    await mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(COMMANDS)) {
        await Bun.write(join(dir, harness.commandFile(name)), body);
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
 *
 * A harness with no `rulesDir` gets the skills and no rules. That is a real
 * gap, not a silent success -- the rule still has to reach the project some
 * other way -- so the count comes back zero for a caller to report.
 */
export async function installSkills(
    root: string,
    harness: Harness = DEFAULT_HARNESS,
): Promise<{ skills: number; rules: number }> {
    let skills = 0;
    let rules = 0;

    for (const [name, body] of Object.entries(SKILLS)) {
        const path = join(root, harness.skillsDir, name, "SKILL.md");
        if (await Bun.file(path).exists()) continue;
        await Bun.write(path, body);
        skills++;
    }

    if (harness.rulesDir !== null) {
        for (const [name, body] of Object.entries(RULES)) {
            const path = join(root, harness.rulesDir, name);
            if (await Bun.file(path).exists()) continue;
            await Bun.write(path, body);
            rules++;
        }
    }

    return { skills, rules };
}

export async function init(root: string, harness: Harness = DEFAULT_HARNESS): Promise<void> {
    for (const dir of [...DIRS, ...harnessDirs(harness)]) {
        await mkdir(join(root, dir), { recursive: true });
    }

    // Git does not track empty directories, so the layout would vanish on clone.
    for (const dir of [...KEEP, ...harness.scaffoldDirs]) {
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

    // Seed the harness dirs that would otherwise be empty and confusing.
    for (const [dir, body] of [
        [harness.rulesDir, RULES_README],
        [harness.skillsDir, SKILLS_README],
    ] as const) {
        if (dir === null) continue;
        const path = join(root, dir, "README.md");
        if (!(await Bun.file(path).exists())) await Bun.write(path, body);
    }

    const installed = await installSkills(root, harness);
    console.log(
        `installed ${harness.skillsDir}/ (${installed.skills} skill${installed.skills === 1 ? "" : "s"}), ` +
            `${installed.rules} rule${installed.rules === 1 ? "" : "s"}`,
    );

    // Unreadable harness config costs the hooks, not the rest of the install.
    // The old code returned here -- before the slash commands and before the
    // PATH warning -- and the CLI then exited 0, so `init` reported success
    // having written no hooks and no slash commands, which is the whole
    // workflow.
    const wiring = await harness.wireGuards(root);
    if (wiring.refused !== null) {
        console.error(
            `\n!! ${harness.label} configuration was left untouched: ${wiring.refused}.\n` +
                "   The guards are NOT wired: writes to .craftpath/state/ will not be\n" +
                "   blocked, and `craftpath validate` will not run on stop.\n" +
                "   Fix it, then re-run `craftpath init` -- it is idempotent.",
        );
    } else {
        console.log(
            wiring.added > 0
                ? `wired     ${harness.label} (${wiring.added} hook${wiring.added > 1 ? "s" : ""})`
                : `kept      ${harness.label} (already wired)`,
        );
    }

    const n = await writeCommands(root, harness);
    console.log(`wrote     ${harness.commandsDir}/ (${n} commands)`);

    // Only when hooks exist to run: the warning's premise is "the hooks just
    // wired", and a warning whose premise is false teaches people to skip the
    // ones whose premise is true.
    if (wiring.refused === null) warnIfUnresolvable(harness);

    console.log("\nNext:");
    console.log("  1. fill in the commands in .craftpath/config.toml");
    for (const [i, step] of harness.nextSteps().entries()) {
        console.log(`  ${i + 2}. ${step}`);
    }

    // Everything that could be installed is installed, so this is deliberately
    // the last statement: a half-set-up project is worse than a fully set-up one
    // carrying a warning. But exiting 0 would report success for an install that
    // left the trust boundary unenforced, so the exit code says otherwise.
    if (wiring.refused !== null) {
        throw new PreconditionError(
            `init finished, but ${harness.label} configuration ${wiring.refused}, so no hooks were wired.`,
        );
    }
}

/**
 * The hooks just written invoke `craftpath` by name. If that does not resolve,
 * the harness cannot run them -- and where guards fail open (Claude Code, D24),
 * the result is not a visible error but a silently unprotected
 * `.craftpath/state/`. A harness that fails CLOSED turns the same missing
 * command into a blocked tool call instead, which is loud but no more usable,
 * so the warning is worth printing either way.
 *
 * So the warning is phrased as the property that is missing rather than as a
 * missing command: "craftpath not found" reads as cosmetic, "state writes will
 * not be blocked" reads as what it actually is.
 *
 * Deliberately not fatal. Init is idempotent and a half-set-up project is worse
 * than a fully set-up one carrying a warning.
 */
function warnIfUnresolvable(harness: Harness): void {
    if (Bun.which("craftpath") !== null) return;
    console.error(
        `\n!! \`craftpath\` is not on PATH, so the hooks just wired into ${harness.label}\n` +
            "   cannot run. Writes to .craftpath/state/ will NOT be blocked.\n" +
            `   Fix with:  ${installCommand()}`,
    );
}
