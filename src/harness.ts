/**
 * Where each harness reads craftpath's steps, skills and the test-first rule,
 * and how a step is rendered for it.
 *
 * Every step is a user-only skill on both harnesses -- `/craftpath-<step>` on
 * Claude Code, `/skill:craftpath-<step>` on pi -- and runs in a fresh subagent:
 * on Claude Code through `context: fork`; on pi its first instruction hands the
 * step to a general-purpose subagent. Either way the step's first action
 * is running its script, which the PreToolUse guard checks before it runs.
 *
 * Step sources (`assets/steps/<step>.md`) carry these tokens:
 *   {{DELEGATE}}      pi: hand the whole step to a subagent; Claude Code: nothing
 *   {{ARGS}}          the step's arguments, as a script argument
 *   {{REQUEST}}       the step's arguments, in prose
 *   {{SCRIPT:<name>}} `python3 .craftpath/scripts/<name>.py`
 *   {{CMD:<step>}}    how the user invokes another step
 *   {{RULE:tdd.md}}   where the test-first rule lives
 */
export type HarnessId = "claude-code" | "pi";

export interface Harness {
    id: HarnessId;
    /** Where a step is installed. */
    stepPath(step: string): string;
    skillPath(name: string): string;
    rulePath(name: string): string;
    /** A step source, rendered for this harness. */
    renderStep(step: string, source: string): string;
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
    rule: (name: string) => string,
    delegate: string,
    args: Args = CLAUDE_ARGS,
): string {
    return text
        .replace("{{DELEGATE}}\n", delegate)
        .replaceAll("{{ARGS}}", args.args)
        .replaceAll("{{REQUEST}}", args.request)
        .replace(SCRIPT, (_, name: string) => `python3 .craftpath/scripts/${name}.py`)
        .replace(/\{\{CMD:([a-z-]+)\}\}/g, (_, step: string) => `/craftpath-${step}`)
        .replace(/\{\{RULE:([a-z.-]+)\}\}/g, (_, name: string) => rule(name));
}

/** `---\nfront\n---\nbody` with `lines` added to the front matter. */
function withFrontmatter(source: string, lines: string[]): string {
    return source.replace(/^---\n/, `---\n${lines.join("\n")}\n`);
}

const claudeRule = (name: string) => `.claude/rules/${name}`;
const piRule = (name: string) => `.pi/skills/${name.replace(/\.md$/, "")}/SKILL.md`;

export const CLAUDE_CODE: Harness = {
    id: "claude-code",
    stepPath: (step) => `.claude/skills/craftpath-${step}/SKILL.md`,
    skillPath: (name) => `.claude/skills/${name}/SKILL.md`,
    rulePath: claudeRule,
    render: (text) => render(text, claudeRule, ""),
    renderStep(step, source) {
        // A user-only skill, run in a fresh general-purpose subagent; the caller
        // waits for its result.
        return this.render(
            withFrontmatter(source, [
                `name: craftpath-${step}`,
                "disable-model-invocation: true",
                "context: fork",
                "background: false",
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
    stepPath: (step) => `.pi/skills/craftpath-${step}/SKILL.md`,
    skillPath: (name) => `.pi/skills/${name}/SKILL.md`,
    rulePath: piRule,
    render: (text) => render(text, piRule, ""),
    renderStep(step, source) {
        return render(
            withFrontmatter(source, [`name: craftpath-${step}`, "disable-model-invocation: true"]),
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
