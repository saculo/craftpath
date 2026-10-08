/**
 * Where each harness reads craftpath's commands, skills and the test-first
 * rule, and how a command is rendered for it.
 *
 * Command sources (`assets/commands/<step>.md`) carry three tokens:
 *   {{RUN:<script>}}  run `.craftpath/scripts/<script>.py "$ARGUMENTS"` before
 *                     the agent sees the prompt, and put its output here
 *   {{CMD:<step>}}    how the user invokes another step
 *   {{RULE:tdd.md}}   where the test-first rule lives
 */
export type HarnessId = "claude-code" | "pi";

export interface Harness {
    id: HarnessId;
    /** Where a step's command file goes. */
    commandPath(step: string): string;
    skillPath(name: string): string;
    rulePath(name: string): string;
    /** A command source, rendered for this harness. */
    renderCommand(source: string): string;
    /** The test-first rule, in the form this harness reads. */
    renderRule(name: string, body: string): string;
    render(text: string): string;
}

const RUN = /\{\{RUN:([a-z-]+)\}\}/g;

function tokens(text: string, cmd: (step: string) => string, rule: (name: string) => string) {
    return text
        .replace(/\{\{CMD:([a-z-]+)\}\}/g, (_, step: string) => cmd(step))
        .replace(/\{\{RULE:([a-z.-]+)\}\}/g, (_, name: string) => rule(name));
}

const claudeRule = (name: string) => `.claude/rules/${name}`;
const piRule = (name: string) => `.pi/skills/${name.replace(/\.md$/, "")}/SKILL.md`;

export const CLAUDE_CODE: Harness = {
    id: "claude-code",
    commandPath: (step) => `.claude/commands/craftpath/${step}.md`,
    skillPath: (name) => `.claude/skills/${name}/SKILL.md`,
    rulePath: claudeRule,
    render: (text) => tokens(text, (step) => `/craftpath:${step}`, claudeRule),
    renderCommand(source) {
        const scripts = [...source.matchAll(RUN)].map((m) => m[1]!);
        const allowed = scripts.map((s) => `Bash(python3 .craftpath/scripts/${s}.py:*)`).join(", ");
        // Claude Code runs a `!`-prefixed command while expanding the prompt,
        // before the model sees it -- but only when the command lists it in
        // `allowed-tools`; otherwise a headless run ends silently.
        const front = [
            "disable-model-invocation: true",
            ...(scripts.length > 0 ? [`allowed-tools: ${allowed}`] : []),
        ].join("\n");
        const body = source
            .replace(/^---\n/, `---\n${front}\n`)
            .replace(RUN, (_, s: string) => `!\`python3 .craftpath/scripts/${s}.py "$ARGUMENTS"\``);
        return this.render(body);
    },
    renderRule: (_name, body) => body,
};

export const PI: Harness = {
    id: "pi",
    // Read by craftpath's pi extension, which registers /craftpath-<step>.
    commandPath: (step) => `.pi/craftpath/commands/${step}.md`,
    skillPath: (name) => `.pi/skills/${name}/SKILL.md`,
    rulePath: piRule,
    render: (text) => tokens(text, (step) => `/craftpath-${step}`, piRule),
    // {{RUN:...}} stays: the extension runs the script and fills it in.
    renderCommand(source) {
        return this.render(source);
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
