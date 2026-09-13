/**
 * Loading and interrogating `.craftpath/config.toml`.
 *
 * Parsed with `Bun.TOML.parse` rather than a dynamic import: imports are
 * module-cached, and config is a file that changes. Caching it would return a
 * value no longer on disk, which matters directly for `config_hash` staleness.
 */
import { join } from "node:path";
import { CorruptStateError } from "../transitions";
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
 * Without `selector_flag`, a criterion's `selector` is decorative: the suite
 * runs whole, and `proves()` refuses to let suite-wide evidence satisfy a
 * selector-scoped criterion. So running it would burn minutes to produce a
 * record that cannot satisfy anything.
 */
export function canRunSelector(spec: CommandSpec): boolean {
    return isConfigured(spec) && spec.selector_flag !== undefined;
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
