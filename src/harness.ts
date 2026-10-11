/**
 * Where each harness reads craftpath's steps, skills and the test-first rule,
 * and how a step is rendered for it.
 *
 * Every step is a user-only skill on both harnesses -- `/craftpath-<step>` on
 * Claude Code, `/skill:craftpath-<step>` on pi -- and a step whose source
 * carries {{DELEGATE}} runs in a fresh subagent: on Claude Code through
 * `context: fork`; on pi its first instruction hands the step to a
 * general-purpose subagent. A step without it (work) runs in the session, since
 * it starts subagents itself and a forked step's subagents do not wait for it.
 * Either way the step's first action is running its script, which the
 * PreToolUse guard checks before it runs.
 *
 * Step sources (`assets/steps/<step>.md`) carry these tokens:
 *   {{DELEGATE}}      run the step in a subagent (pi: a hand-off paragraph;
 *                     Claude Code: `context: fork`)
 *   {{ARGS}}          the step's arguments, as a script argument
 *   {{REQUEST}}       the step's arguments, in prose
 *   {{SCRIPT:<name>}} `python3 .craftpath/scripts/<name>.py`
 *   {{CMD:<step>}}    how the user invokes another step
 *   {{RULE:tdd.md}}   where the test-first rule lives
 *
 * Templates and scripts are installed once and shared by every harness, so
 * {{CMD:<step>}} there -- and {{COMMANDS}}, the pattern the scripts name a step
 * with -- spell the step for each harness installed (`renderShared`).
 */
export type HarnessId = "claude-code" | "pi";

/** A step's `[steps.<step>.<harness>]` table in config.toml; only what is set applies. */
export interface StepSettings {
    model?: string;
    effort?: string;
}

export interface Harness {
    id: HarnessId;
    /** How the user runs a step: `/craftpath-plan`, `/skill:craftpath-plan`. */
    command(step: string): string;
    /** Where a step is installed. */
    stepPath(step: string): string;
    skillPath(name: string): string;
    rulePath(name: string): string;
    /** A step source, rendered for this harness with the step's configured settings. */
    renderStep(step: string, source: string, settings?: StepSettings): string;
    /** The test-first rule, in the form this harness reads. */
    renderRule(name: string, body: string): string;
    /** Tokens in any shipped text. */
    render(text: string): string;
}

const SCRIPT = /\{\{SCRIPT:([a-z-]+)\}\}/g;

interface Args {
    /** The arguments as one script argument. */
    args: string;
    /** The arguments, referred to in prose. */
    request: string;
}

/** Claude Code substitutes `$ARGUMENTS`; pi appends the request after the skill. */
const CLAUDE_ARGS: Args = { args: '"$ARGUMENTS"', request: "$ARGUMENTS" };
const PI_ARGS: Args = {
    args: `"<the user's request>"`,
    request: "the user's request, given after this skill",
};

function render(
    text: string,
    command: (step: string) => string,
    rule: (name: string) => string,
    delegate: string,
    args: Args = CLAUDE_ARGS,
): string {
    return text
        .replace("{{DELEGATE}}\n", delegate)
        .replaceAll("{{ARGS}}", args.args)
        .replaceAll("{{REQUEST}}", args.request)
        .replace(SCRIPT, (_, name: string) => `python3 .craftpath/scripts/${name}.py`)
        .replace(/\{\{CMD:([a-z-]+)\}\}/g, (_, step: string) => command(step))
        .replace(/\{\{RULE:([a-z.-]+)\}\}/g, (_, name: string) => rule(name));
}

/** `---\nfront\n---\nbody` with `lines` added to the front matter. */
function withFrontmatter(source: string, lines: string[]): string {
    return source.replace(/^---\n/, `---\n${lines.join("\n")}\n`);
}

/** `model:` and `effort:` front-matter lines, for the keys that are set. */
function configured(settings: StepSettings): string[] {
    const lines: string[] = [];
    if (settings.model !== undefined) lines.push(`model: ${settings.model}`);
    if (settings.effort !== undefined) lines.push(`effort: ${settings.effort}`);
    return lines;
}

const claudeRule = (name: string) => `.claude/rules/${name}`;
const piRule = (name: string) => `.pi/skills/${name.replace(/\.md$/, "")}/SKILL.md`;

const claudeCommand = (step: string) => `/craftpath-${step}`;
const piCommand = (step: string) => `/skill:craftpath-${step}`;

export const CLAUDE_CODE: Harness = {
    id: "claude-code",
    command: claudeCommand,
    stepPath: (step) => `.claude/skills/craftpath-${step}/SKILL.md`,
    skillPath: (name) => `.claude/skills/${name}/SKILL.md`,
    rulePath: claudeRule,
    render: (text) => render(text, claudeCommand, claudeRule, ""),
    renderStep(step, source, settings = {}) {
        // A user-only skill, run in a fresh general-purpose subagent; the caller
        // waits for its result. A step without {{DELEGATE}} runs in the session.
        const fork = source.includes("{{DELEGATE}}") ? ["context: fork", "background: false"] : [];
        // work runs on the session's model: its setting is for the subagents it starts.
        const chosen = step === "work" ? [] : configured(settings);
        return this.render(
            withFrontmatter(source, [
                `name: craftpath-${step}`,
                "disable-model-invocation: true",
                ...fork,
                ...chosen,
            ]),
        );
    },
    renderRule: (_name, body) => body,
};

/** pi has no forked skills: the step's first instruction hands it to a subagent. */
const PI_DELEGATE = [
    "**Run this whole step in a fresh subagent.** Call the `Agent` tool (from",
    "pi-subagents-lite) with agent `general-purpose`, `run_in_background: false`,",
    "and as its prompt everything below this paragraph followed by the user's",
    "request exactly as given after this skill. Then report the subagent's result",
    "to the user, word for word, and stop. Do not do the step yourself.",
    "",
    "",
].join("\n");

export const PI: Harness = {
    id: "pi",
    command: piCommand,
    stepPath: (step) => `.pi/skills/craftpath-${step}/SKILL.md`,
    skillPath: (name) => `.pi/skills/${name}/SKILL.md`,
    rulePath: piRule,
    render: (text) => render(text, piCommand, piRule, ""),
    // pi takes no model or effort per step: settings are ignored.
    renderStep(step, source) {
        return render(
            withFrontmatter(source, [`name: craftpath-${step}`, "disable-model-invocation: true"]),
            piCommand,
            piRule,
            PI_DELEGATE,
            PI_ARGS,
        );
    },
    // pi has no rules, only skills, so the rule travels as one.
    renderRule(name, body) {
        const stem = name.replace(/\.md$/, "");
        return [
            "---",
            `name: ${stem}`,
            "description: >-",
            "  A craftpath repository rule, binding on every change that alters behaviour.",
            "  Load it before writing or modifying code, tests or configuration.",
            "---",
            "",
            body,
        ].join("\n");
    },
};

export const HARNESSES: Record<HarnessId, Harness> = { "claude-code": CLAUDE_CODE, pi: PI };

/** A template or script, shared by every harness: a step is named for each one installed. */
export function renderShared(text: string, harnesses: Harness[]): string {
    const name = (step: string) => harnesses.map((h) => h.command(step)).join(" or ");
    return text
        .replace(/\{\{CMD:([a-z-]+)\}\}/g, (_, step: string) => name(step))
        .replaceAll("{{COMMANDS}}", name("{step}"));
}
