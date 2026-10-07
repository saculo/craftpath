/**
 * Fixture repositories: real git repos in scratch directories, initialised by
 * the real CLI, with the project's modules and gate policy written into its
 * own config.toml -- so whatever a run approves is approved through real
 * policy, not a test-only bypass.
 */
import { join } from "node:path";
import { scratch } from "../../test/scratch";
import { cli } from "./cli";

export interface Module {
    path: string;
    test?: string;
    build?: string;
    depends_on?: string[];
}

export interface FixtureOptions {
    /** Harnesses to install into. Default: claude-code. */
    harness?: ("claude-code" | "pi")[];
    /** Replaces the root module `init` writes. */
    modules?: Record<string, Module>;
    gates?: Partial<Record<"requirement" | "plan" | "result", "auto" | "manual">>;
    /** Project files written before init, relative to the root. */
    files?: Record<string, string>;
}

const git = (root: string, ...args: string[]) =>
    Bun.$`git -C ${root} -c user.email=eval@example.com -c user.name=Eval ${args}`.quiet();

function modulesToml(modules: Record<string, Module>): string {
    return Object.entries(modules)
        .map(([name, m]) =>
            [
                `[modules.${name}]`,
                `path = ${JSON.stringify(m.path)}`,
                `test = ${JSON.stringify(m.test ?? "")}`,
                `build = ${JSON.stringify(m.build ?? "")}`,
                ...(m.depends_on ? [`depends_on = ${JSON.stringify(m.depends_on)}`] : []),
                "",
            ].join("\n"),
        )
        .join("\n");
}

/** A committed, initialised repository on master. Returns its root. */
export async function fixture(options: FixtureOptions = {}): Promise<string> {
    const root = await scratch("craftpath-eval-");
    await git(root, "init", "-q", "-b", "master");
    await git(root, "config", "user.email", "eval@example.com");
    await git(root, "config", "user.name", "Eval");
    for (const [path, text] of Object.entries(options.files ?? {})) {
        await Bun.write(join(root, path), text);
    }

    const init = await cli(root, [
        "init",
        "--harness",
        (options.harness ?? ["claude-code"]).join(","),
    ]);
    if (init.exit !== 0) throw new Error(`craftpath init failed (${init.exit}): ${init.stderr}`);

    const path = join(root, ".craftpath/config.toml");
    let config = await Bun.file(path).text();
    if (options.modules) {
        // Table headers at the start of a line: the header comment carries a
        // commented-out `[modules.web]` example.
        const start = config.search(/^\[modules\./m);
        const end = config.search(/^\[gates\]/m);
        config = config.slice(0, start) + modulesToml(options.modules) + "\n" + config.slice(end);
    }
    for (const [gate, policy] of Object.entries(options.gates ?? {})) {
        config = config.replace(new RegExp(`^${gate} = ".*"`, "m"), `${gate} = "${policy}"`);
    }
    await Bun.write(path, config);

    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "base");
    return root;
}

/** A copy of the repository, history included, to restore from later. */
export async function snapshot(root: string): Promise<string> {
    const dir = await scratch("craftpath-snapshot-");
    await Bun.$`cp -a ${root}/. ${dir}`.quiet();
    return dir;
}

/** A fresh repository restored from a snapshot. */
export async function restore(saved: string): Promise<string> {
    const root = await scratch("craftpath-eval-");
    await Bun.$`cp -a ${saved}/. ${root}`.quiet();
    return root;
}
