import { DEFAULT_HARNESS, detect } from "../harness/index";
import { doctor as report, SLOW_MS } from "../core/doctor";
import type { Context } from "./context";

/**
 * `craftpath doctor`.
 *
 * Reports on every harness the project is set up for. A project with none
 * detected is reported against the default, so the "guards are NOT WIRED"
 * message still reaches someone who has not run `init` yet.
 */
export async function doctor(this: Context): Promise<void> {
    const root = process.cwd();
    const detected = await detect(root);
    await report(root, SLOW_MS, detected.length > 0 ? detected : [DEFAULT_HARNESS]);
}
