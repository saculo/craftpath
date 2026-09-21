/**
 * The Claude Code harness.
 *
 * Guards are external processes named on PATH, wired through
 * `.claude/settings.json`: `PreToolUse` for the two guards, `Stop` for the
 * completion check. Claude Code blocks a tool call on exit 2 and treats every
 * other non-zero code as a hook error the model never sees -- so the guards
 * fail OPEN, and a hook command that cannot be resolved silently stops
 * protecting `.craftpath/state/` while settings.json still claims it is wired.
 * That is why `wiredGuardCommands` exists and why doctor checks resolution.
 */
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Harness, Wiring } from "./index";

const SETTINGS = ".claude/settings.json";

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
    if (
        hooks !== undefined &&
        (typeof hooks !== "object" || hooks === null || Array.isArray(hooks))
    ) {
        return "hooks is not an object";
    }
    for (const event of ["PreToolUse", "Stop"]) {
        const value = (hooks as Record<string, unknown> | undefined)?.[event];
        if (value !== undefined && !Array.isArray(value)) return `hooks.${event} is not a list`;
    }
    return null;
}

async function readSettings(path: string): Promise<{ settings: Settings; refused: string | null }> {
    const file = Bun.file(path);
    if (!(await file.exists())) return { settings: {}, refused: null };
    let settings: Settings;
    try {
        settings = JSON.parse(await file.text()) as Settings;
    } catch {
        return { settings: {}, refused: "it is not valid JSON" };
    }
    return { settings, refused: hooksProblem(settings) };
}

export const CLAUDE_CODE: Harness = {
    id: "claude-code",
    label: "Claude Code",

    skillsDir: ".claude/skills",
    rulesDir: ".claude/rules",
    // A file at commands/craftpath/work.md registers as /craftpath:work -- the
    // directory is the namespace, so the file name carries none of it.
    commandsDir: ".claude/commands/craftpath",
    scaffoldDirs: [".claude/hooks"], // project hook scripts, if you add any

    commandFile: (name) => name,
    invocation: (name) => `/craftpath:${name}`,
    ruleLocation: (name) => `.claude/rules/${name}`,

    subagent:
        "Start a fresh subagent for that task and explicitly preload every declared skill.\n" +
        "Do not rely on fuzzy or automatic skill selection.",
    subagentNoun: "subagent",
    loadSkill: (name) => `load the \`${name}\` skill`,

    /** The config directory, for the same reason as pi: see that descriptor. */
    detect: async (root) => {
        try {
            return (await stat(join(root, ".claude"))).isDirectory();
        } catch {
            return false;
        }
    },

    async writeRule(root: string, name: string, body: string): Promise<string | null> {
        const rel = `.claude/rules/${name}`;
        const path = join(root, rel);
        if (await Bun.file(path).exists()) return null;
        await Bun.write(path, body);
        return rel;
    },

    async wireGuards(root: string): Promise<Wiring> {
        const path = join(root, SETTINGS);
        const { settings, refused } = await readSettings(path);
        // Never overwrite config we could not merge into: it is the user's, and
        // it may hold settings this code knows nothing about.
        if (refused !== null) return { added: 0, refused };

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

        await mkdir(join(root, ".claude"), { recursive: true });
        await Bun.write(path, JSON.stringify(settings, null, 2) + "\n");
        return { added, refused: null };
    },

    async wiredGuardCommands(root: string): Promise<string[]> {
        const { settings, refused } = await readSettings(join(root, SETTINGS));
        if (refused !== null) return [];
        const entries = (settings.hooks?.PreToolUse ?? []) as { hooks?: { command?: string }[] }[];
        return entries
            .flatMap((entry) => entry.hooks ?? [])
            .map((h) => h.command)
            .filter((c): c is string => typeof c === "string");
    },

    nextSteps: () => ["restart Claude Code, then run /craftpath:work in chat"],
};
