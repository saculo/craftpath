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
 * Commands are filled only from what the project declares (D21, narrowed --
 * see detect.ts). Anything else stays blank: a guessed command that silently
 * does nothing is worse than a blank one.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { COMMANDS } from "../commands/index";
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
import pkg from "../../package.json" with { type: "json" };
import { type Detected, detectCommands } from "./detect";
import { stampBlock } from "./stamp";
import { type Harness, DEFAULT_HARNESS } from "../harness/index";
import { render } from "../harness/render";
import { installCommand } from "./install";
import { RULES } from "../rules/index";
import { SKILLS } from "../skills/index";
import { recordWritten } from "./manifest";

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

export const BLANK_CONFIG = `# Craftpath configuration.
#
# A module is a directory of this project with its own commands. After a task's
# change, the changed files pick the modules it affects, plus every module that
# depends on them, and \`craftpath task verify\` runs the criterion's command --
# \`test\` or \`build\` -- in each, from that module's directory.
#
# A project without submodules is one module at the root. Declare more as:
#
#   [modules.web]
#   path = "./apps/web"
#   test = "bun test"
#   depends_on = ["shared"]
#
# Fill these in by hand -- a guessed command that silently does nothing is worse
# than a blank one.

[modules.app]
path = "./"
test = ""                # e.g. "bun test" / "./gradlew test" / "pytest"
build = ""

[gates]
# "auto":   the agent records the approval itself and continues.
# "manual": the agent stops until a human approves.
requirement = "auto"
plan = "manual"
result = "manual"

[git]
work_branch_prefix = "work/"
# base_branch = "master"  # changed files are measured from where work left it
`;

/** The blank template, with the root module's detected test in place of its empty one. */
function filledConfig(detected: Detected): string {
    return detected.test === undefined
        ? BLANK_CONFIG
        : BLANK_CONFIG.replace(/^test = "".*$/m, `test = ${JSON.stringify(detected.test)}`);
}

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
        await Bun.write(join(dir, harness.commandFile(name)), render(body, harness));
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
 * Rules go through the harness, which knows the only shape its own agent can
 * discover -- a rule file on Claude Code, a skill on pi.
 */
export async function installSkills(
    root: string,
    harness: Harness = DEFAULT_HARNESS,
): Promise<{ skills: number; rules: number; written: string[] }> {
    let skills = 0;
    let rules = 0;
    const written: string[] = [];

    for (const [name, body] of Object.entries(SKILLS)) {
        const rel = join(harness.skillsDir, name, "SKILL.md");
        const path = join(root, rel);
        if (await Bun.file(path).exists()) continue;
        await Bun.write(path, render(body, harness));
        written.push(rel);
        skills++;
    }

    for (const [name, body] of Object.entries(RULES)) {
        const rel = await harness.writeRule(root, name, render(body, harness));
        if (rel === null) continue;
        written.push(rel);
        rules++;
    }

    return { skills, rules, written };
}

/**
 * Every managed file this build ships for these harnesses (M2), keyed by
 * project-relative path, as the exact text init or update writes there.
 *
 * Slash commands and guard wiring are not here: they are generated and always
 * rewritten (M3).
 */
export function managedFiles(harnesses: Harness[]): Record<string, string> {
    const files: Record<string, string> = {};
    for (const [name, body] of Object.entries(TEMPLATES)) {
        files[join(".craftpath/templates", name)] = body;
    }
    for (const harness of harnesses) {
        for (const [dir, body] of [
            [harness.rulesDir, RULES_README],
            [harness.skillsDir, SKILLS_README],
        ] as const) {
            if (dir !== null) files[join(dir, "README.md")] = render(body, harness);
        }
        for (const [name, body] of Object.entries(SKILLS)) {
            files[join(harness.skillsDir, name, "SKILL.md")] = render(body, harness);
        }
        for (const [name, body] of Object.entries(RULES)) {
            const rule = harness.ruleFile(name, render(body, harness));
            files[rule.path] = rule.text;
        }
    }
    return files;
}

export async function init(
    root: string,
    harnesses: Harness[] = [DEFAULT_HARNESS],
    version: string = pkg.version,
): Promise<void> {
    const dirs = [...DIRS, ...harnesses.flatMap(harnessDirs)];
    for (const dir of dirs) {
        await mkdir(join(root, dir), { recursive: true });
    }

    // Git does not track empty directories, so the layout would vanish on clone.
    for (const dir of [...KEEP, ...harnesses.flatMap((h) => h.scaffoldDirs)]) {
        const path = join(root, dir, ".gitkeep");
        if (!(await Bun.file(path).exists())) await Bun.write(path, "");
    }

    const configPath = join(root, ".craftpath/config.toml");
    if (await Bun.file(configPath).exists()) {
        console.log("kept      .craftpath/config.toml (already present)");
    } else {
        const detected = await detectCommands(root);
        await Bun.write(configPath, stampBlock(version) + filledConfig(detected));
        console.log("created   .craftpath/config.toml");
        if (detected.test !== undefined) {
            console.log(`detected  test = "${detected.test}" for the root module`);
        }
    }

    // state/ is committed, evidence logs included: without it there is no
    // resume across machines, and validate re-reads every log against its
    // recorded exit code -- so logs left out of git fail validation everywhere
    // but the machine that ran the tests.

    // Only what init itself wrote: a file it kept is the project's, and update
    // decides what to make of it.
    const managed: string[] = [];

    let written = 0;
    for (const [name, body] of Object.entries(TEMPLATES)) {
        const rel = join(".craftpath/templates", name);
        const path = join(root, rel);
        if (!(await Bun.file(path).exists())) {
            await Bun.write(path, body);
            managed.push(rel);
            written++;
        }
    }
    console.log(
        written > 0
            ? `created   .craftpath/templates/ (${written} templates)`
            : "kept      .craftpath/templates/ (already present)",
    );

    // Per harness, in the order chosen. Each gets the same skills and rules in
    // whatever shape it can actually discover them.
    const refusals: string[] = [];
    for (const harness of harnesses) {
        console.log(`\n-- ${harness.label}`);

        // Seed the dirs that would otherwise be empty and confusing.
        for (const [dir, body] of [
            [harness.rulesDir, RULES_README],
            [harness.skillsDir, SKILLS_README],
        ] as const) {
            if (dir === null) continue;
            const rel = join(dir, "README.md");
            const path = join(root, rel);
            if (!(await Bun.file(path).exists())) {
                await Bun.write(path, render(body, harness));
                managed.push(rel);
            }
        }

        const installed = await installSkills(root, harness);
        managed.push(...installed.written);
        console.log(
            `installed ${harness.skillsDir}/ (${installed.skills} skill${installed.skills === 1 ? "" : "s"}), ` +
                `${installed.rules} rule${installed.rules === 1 ? "" : "s"}`,
        );

        // Unreadable harness config costs the hooks, not the rest of the
        // install. The old code returned here -- before the slash commands and
        // before the PATH warning -- and the CLI then exited 0, so `init`
        // reported success having written no hooks and no slash commands,
        // which is the whole workflow.
        const wiring = await harness.wireGuards(root);
        if (wiring.refused !== null) {
            refusals.push(`${harness.label}: ${wiring.refused}`);
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

        // Only when hooks exist to run: the warning's premise is "the hooks
        // just wired", and a warning whose premise is false teaches people to
        // skip the ones whose premise is true.
        if (wiring.refused === null) warnIfUnresolvable(harness);
    }

    await recordWritten(root, managed, version);

    console.log("\nNext:");
    console.log("  1. fill in test and build for each module in .craftpath/config.toml");
    let step = 2;
    for (const harness of harnesses) {
        for (const next of harness.nextSteps()) {
            console.log(`  ${step++}. ${next}`);
        }
    }

    // Everything that could be installed is installed, so this is deliberately
    // the last statement: a half-set-up project is worse than a fully set-up one
    // carrying a warning. But exiting 0 would report success for an install that
    // left the trust boundary unenforced, so the exit code says otherwise.
    if (refusals.length > 0) {
        throw new PreconditionError(
            `init finished, but no guards were wired for ${refusals.join("; ")}.`,
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
