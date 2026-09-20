import { validate, validateComplete } from "../core/validate";
import type { Context } from "./context";

/**
 * Structural checks, or completion checks -- never both, and never one silently
 * standing in for the other. A typo'd `--complet` used to fall through to
 * structural validation and exit 0, which reads as "proven complete"; stricli
 * refuses the unknown flag before this function is ever reached.
 */
export async function check(this: Context, flags: { complete: boolean }): Promise<void> {
    await (flags.complete ? validateComplete : validate)(process.cwd());
}
