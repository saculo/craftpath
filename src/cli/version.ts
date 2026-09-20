import pkg from "../../package.json" with { type: "json" };
import type { Context } from "./context";

/**
 * The version the package declares, never a copy of it.
 *
 * This was a hardcoded string while package.json carried no version at all,
 * which is fine right up to the first tag and silently wrong forever after.
 */
export async function version(this: Context): Promise<void> {
    console.log(`craftpath ${pkg.version}`);
}
