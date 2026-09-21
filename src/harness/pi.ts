/**
 * The pi harness (pi.dev, earendil-works/pi).
 *
 * Three differences from Claude Code drive everything here, all measured
 * against pi's source on 2026-09-21:
 *
 *  - **Guards are an extension, not a command.** There is no external hook
 *    protocol; `tool_call` is reachable only from TypeScript loaded in-process.
 *    So wiring means writing `.pi/extensions/craftpath.ts`, which pi
 *    auto-discovers (`src/core/extensions/loader.ts:771`) -- no settings entry.
 *  - **Hooks fail CLOSED.** "`tool_call` errors block the tool (fail-safe)"
 *    (docs/extensions.md:3003), the opposite of Claude Code's D24. The
 *    extension is written so a missing craftpath reports itself rather than
 *    refusing every tool call.
 *  - **Project trust gates all of it.** `.pi/extensions/` loads only after the
 *    project is trusted, so a fully installed project can have inactive guards
 *    and look healthy. That has no Claude Code analogue, which is why it is in
 *    `nextSteps`.
 *
 * pi has no path-scoped rules concept at all, so `rulesDir` is null and the
 * test-first rule travels as a skill instead. Writing it to a directory pi
 * never reads would be worse than not writing it: it would look installed.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Harness, Wiring } from "./index";
import { PI_EXTENSION } from "./pi-extension";

const EXTENSION = ".pi/extensions/craftpath.ts";

async function isDir(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}

export const PI: Harness = {
    id: "pi",
    label: "pi",

    skillsDir: ".pi/skills",
    // pi has no rules mechanism. Stated, not faked -- see the module comment.
    rulesDir: null,
    // Flat: a prompt template's command name is its file name, with no
    // directory namespace, so the namespace has to be in the name.
    commandsDir: ".pi/prompts",
    scaffoldDirs: [".pi/extensions"],

    commandFile: (name) => `craftpath-${name}`,
    invocation: (name) => `/craftpath-${name}`,
    ruleLocation: (name) => `.pi/skills/${name.replace(/\.md$/, "")}/SKILL.md`,

    // pi ships no subagent, so craftpath's extension registers one. Naming the
    // tool explicitly matters more here than on Claude Code: there is no
    // built-in to fall back on, so a vague instruction produces a task run in
    // the planning context with whatever skills happened to match.
    subagent:
        "Call the `craftpath_task` tool for that task, passing its full brief and its\n" +
        "`skills:` list. It runs the task in a fresh pi session with those skills\n" +
        "preloaded. Do not run the task inline instead -- the isolation is what keeps\n" +
        "planning context out of execution, and the explicit skill list is what keeps\n" +
        "skill selection from being a guess.",
    subagentNoun: "`craftpath_task` call",
    // pi's system prompt lists each skill's path and says to read it; there is
    // no invocation, so naming the file is naming the mechanism.
    loadSkill: (name) => `read \`.pi/skills/${name}/SKILL.md\` in full`,

    /**
     * The config directory, not a file inside it.
     *
     * pi needs no settings.json -- extensions, skills and prompts are all
     * auto-discovered -- and craftpath's own install writes none, so probing
     * for one meant craftpath could not detect the install it had just done.
     */
    detect: async (root) => isDir(join(root, ".pi")),

    /**
     * A rule, as the only thing pi can discover: a skill.
     *
     * pi indexes skills by frontmatter and keeps only the description in
     * context, loading the body on demand -- so the wrapper is not decoration,
     * it is what makes the rule exist at all. The description is written to
     * trigger on the work a rule constrains rather than on its own name,
     * because a skill nothing matches is a skill nothing reads.
     */
    async writeRule(root: string, name: string, body: string): Promise<string | null> {
        const stem = name.replace(/\.md$/, "");
        const rel = `.pi/skills/${stem}/SKILL.md`;
        const path = join(root, rel);
        if (await Bun.file(path).exists()) return null;
        await Bun.write(
            path,
            `---\nname: ${stem}\ndescription: >-\n  A craftpath repository rule, binding on every change that alters behaviour.\n` +
                `  Load it before writing or modifying code, tests or configuration in this\n` +
                `  project. It is a skill only because pi has no path-scoped rules; it\n` +
                `  carries a rule's authority, not a skill's optionality.\n---\n\n${body}`,
        );
        return rel;
    },

    /**
     * Write the extension, replacing a stale one.
     *
     * Generated, never the project's: an older craftpath's extension speaks an
     * older protocol, and a guard that is present but wrong is the failure this
     * whole seam exists to avoid. Contrast the skills, which init never
     * overwrites because they are content a project is invited to edit.
     */
    async wireGuards(root: string): Promise<Wiring> {
        const path = join(root, EXTENSION);
        const file = Bun.file(path);
        if ((await file.exists()) && (await file.text()) === PI_EXTENSION) {
            return { added: 0, refused: null };
        }
        await mkdir(join(root, ".pi/extensions"), { recursive: true });
        await Bun.write(path, PI_EXTENSION);
        return { added: 1, refused: null };
    },

    /**
     * The extension, reported in the vocabulary doctor already speaks.
     *
     * Doctor's question is "can the guards run", and on pi that decomposes the
     * same way: the extension is the registration, and `craftpath` still has to
     * resolve on PATH for the shim inside it to reach a guard. Reporting the
     * command it will spawn lets doctor's existing resolution check apply
     * unchanged.
     */
    async wiredGuardCommands(root: string): Promise<string[]> {
        const file = Bun.file(join(root, EXTENSION));
        if (!(await file.exists())) return [];
        return (await file.text()).includes("guard-write") ? ["craftpath hook guard-write"] : [];
    },

    nextSteps: () => [
        'trust this project in pi (`pi -a`, or defaultProjectTrust: "always"), or the' +
            " extension -- and with it every guard -- never loads",
        "restart pi, then run /craftpath-work in chat",
    ],
};
