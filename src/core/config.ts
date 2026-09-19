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
