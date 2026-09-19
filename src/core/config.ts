/**
 * Loading and interrogating `.craftpath/config.toml`.
 *
 * Parsed with `Bun.TOML.parse` rather than a dynamic import: imports are
 * module-cached, and config is a file that changes. Caching it would return a
 * value no longer on disk, which matters directly for `config_hash` staleness.
 */
import { join } from "node:path";
import { CorruptStateError, PreconditionError } from "../transitions";
import { Config, type CommandSpec } from "../schema";

export const CONFIG_PATH = ".craftpath/config.toml";

/**
 * A command is usable only when it has a non-empty `run`.
 *
 * Blank is the value `init` writes (D21 -- no stack detection, because a
 * guessed command that silently does nothing is worse than a blank one), so
 * "configured" and "present in the file" are different questions.
 */
export function isConfigured(spec: CommandSpec): boolean {
    return spec.run.trim().length > 0;
}

/**
 * Whether this runner can be pointed at a single test.
 *
 * Without `selector_template`, a criterion's `selector` is decorative: the
 * suite runs whole, and `proves()` refuses to let suite-wide evidence satisfy a
 * selector-scoped criterion. So running it would burn minutes to produce a
 * record that cannot satisfy anything.
 */
export function canRunSelector(spec: CommandSpec): boolean {
    return isConfigured(spec) && spec.selector_template !== undefined;
}

/**
 * POSIX single-quoting.
 *
 * Selectors come out of task files, which are model space, and the command is
 * handed to `sh -c`. Without this, a selector is an injection point into a
 * shell running with the developer's privileges.
 */
function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The shell command to run, optionally scoped to one test.
 *
 * A template rather than a bare flag because runners disagree about more than
 * the flag's name: Maven needs `-Dtest=X` with no space, and `go test` needs
 * the package *after* the selector. One placeholder covers every shape without
 * an enum of runners to extend.
 *
 * `name` is the config key, carried only so the refusal can say which command
 * needs the template. A criterion-level failure that does not name it leaves
 * the reader guessing which of several to fix.
 */
export function commandFor(spec: CommandSpec, selector?: string, name?: string): string {
    if (selector === undefined) return spec.run;
    if (spec.selector_template === undefined) {
        // Precondition, not corrupt state: exit 3 means the recorded state is
        // damaged and `reconcile` is the remedy, and a caller branching on it
        // would try to repair a config that is perfectly valid. Nothing is
        // broken here -- the plan asked for scoping this runner cannot express.
        throw new PreconditionError(
            `command ${name === undefined ? "" : `"${name}" `}has no ` +
            `selector_template, so it cannot be scoped to "${selector}". Add one ` +
            `(e.g. selector_template = "-t {selector}") in ${CONFIG_PATH}, or ` +
            `mark the criterion manual.`,
        );
    }
    const scoped = spec.selector_template.replaceAll("{selector}", shellQuote(selector));
    return `${spec.run} ${scoped}`;
}

export async function loadConfig(root: string): Promise<Config> {
    const path = join(root, CONFIG_PATH);
    const file = Bun.file(path);

    if (!(await file.exists())) {
        throw new CorruptStateError(
            `${CONFIG_PATH} is missing. Run \`craftpath init\` to create it.`,
        );
    }

    let raw: unknown;
    try {
        raw = Bun.TOML.parse(await file.text());
    } catch (cause) {
        throw new CorruptStateError(
            `${CONFIG_PATH} is not valid TOML: ${(cause as Error).message}`,
        );
    }

    const parsed = Config.safeParse(raw);
    if (!parsed.success) {
        throw new CorruptStateError(
            `${CONFIG_PATH} is not valid configuration: ${parsed.error.issues
                .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
                .join("; ")}`,
        );
    }
    return parsed.data;
}

/**
 * The `[gates]` policy, by gate name.
 *
 * Unreadable config, or a gate the file does not mention, reads as `"manual"`.
 * The failure modes are asymmetric: defaulting to `auto` would let a broken
 * config silently hand the agent every sign-off in the workflow, while
 * defaulting to `manual` costs a person one command.
 */
export async function gatePolicies(root: string): Promise<Record<string, string>> {
    try {
        const config = await loadConfig(root);
        return { ...config.gates };
    } catch {
        return {};
    }
}
