/**
 * Changes a newer craftpath makes to a project an older one set up.
 *
 * `update` runs every entry newer than the project's stamp and no newer than
 * the running CLI, oldest first, and moves the stamp only once they have all
 * succeeded. So a migration that fails is retried by the next `update` -- and
 * one that half-applied is run again over its own partial work, which is why
 * each `apply` must be safe to run twice.
 *
 * Each is safe to run twice, and changes nothing on a project that does not
 * need it.
 */
import { join } from "node:path";
import { CONFIG_PATH } from "./config";

export interface Migration {
    /** The craftpath version that introduced the change. */
    since: string;
    /** One line, printed as it runs. */
    describe: string;
    apply(root: string): Promise<void>;
}

/** The header comment 0.3.0's init wrote, describing [commands]. */
const OLD_HEADER = `# Craftpath configuration.
#
# Every command referenced by a task's \`verify\` is defined here, so plans stay
# repo-agnostic and there is exactly one place to change an invocation.
# Fill these in by hand -- a guessed command that silently does nothing is worse
# than a blank one.
`;

const NEW_HEADER = `# Craftpath configuration.
#
# A module is a directory of this project with its own commands. After a task's
# change, the changed files pick the modules it affects, plus every module that
# depends on them, and \`craftpath task verify\` runs the criterion's command --
# \`test\` or \`build\` -- in each, from that module's directory.
`;

/**
 * 0.4.1: [commands] and [skills] become one root module (T627).
 *
 * \`test\` and \`build\` move into [modules.app] with path "./"; a blank
 * command and [skills] are dropped. A configured command a module cannot
 * carry (\`lint\`, say) is refused by name rather than dropped: it is someone's
 * deliberate setting, and losing it silently is worse than asking.
 *
 * Text, not a TOML round-trip, so the project's comments and layout survive.
 */
async function commandsToModules(root: string): Promise<void> {
    const path = join(root, CONFIG_PATH);
    const file = Bun.file(path);
    if (!(await file.exists())) return;
    const text = await file.text();
    const parsed = Bun.TOML.parse(text) as {
        commands?: Record<string, { run?: string }>;
        skills?: unknown;
        modules?: Record<string, unknown>;
    };
    if (parsed.commands === undefined && parsed.skills === undefined) return;

    const runs = Object.fromEntries(
        Object.entries(parsed.commands ?? {}).map(([name, spec]) => [
            name,
            (spec.run ?? "").trim(),
        ]),
    );
    const stranded = Object.keys(runs).filter(
        (name) => name !== "test" && name !== "build" && runs[name] !== "",
    );
    if (stranded.length > 0) {
        throw new Error(
            `${CONFIG_PATH} configures ${stranded.map((n) => `[commands.${n}]`).join(", ")}, which a ` +
                "module cannot carry: a module has only test and build. Fold it into test, or delete " +
                "it, then run `craftpath update` again. Nothing was changed.",
        );
    }
    if (parsed.modules?.app !== undefined) {
        throw new Error(
            `${CONFIG_PATH} has both [commands] and a [modules.app] table. Move what [commands] ` +
                "still holds into the module by hand and delete [commands] and [skills].",
        );
    }

    // Drop every [commands.*] and [skills.*] table, header to next header.
    const kept: string[] = [];
    let dropping = false;
    for (const line of text.split("\n")) {
        const header = line.match(/^\s*\[([^\]]+)\]/);
        if (header) dropping = /^(commands|skills)(\.|$)/.test(header[1]!.trim());
        if (!dropping) kept.push(line);
    }
    const module =
        `[modules.app]\npath = "./"\ntest = ${JSON.stringify(runs.test ?? "")}\n` +
        `build = ${JSON.stringify(runs.build ?? "")}\n\n`;
    let next = kept.join("\n").replace(OLD_HEADER, NEW_HEADER);
    const gates = next.search(/^\[gates\]/m);
    next =
        gates === -1
            ? `${next.trimEnd()}\n\n${module}`
            : next.slice(0, gates) + module + next.slice(gates);
    await Bun.write(path, next.replace(/\n{3,}/g, "\n\n"));
}

export const MIGRATIONS: Migration[] = [
    {
        since: "0.4.1",
        describe: "move [commands] into a root module, drop [skills]",
        apply: commandsToModules,
    },
];

/**
 * The migrations a project stamped `stamped` needs to reach `running`, oldest
 * first. No stamp means set up before stamps existed, so every one (V4).
 */
export function pending(
    migrations: Migration[],
    stamped: string | null,
    running: string,
): Migration[] {
    return migrations
        .filter(
            (m) =>
                (stamped === null || Bun.semver.order(m.since, stamped) > 0) &&
                Bun.semver.order(m.since, running) <= 0,
        )
        .sort((a, b) => Bun.semver.order(a.since, b.since));
}
