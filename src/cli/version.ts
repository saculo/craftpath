import type { Context } from "./context";

/** Imports nothing: `craftpath version` must work outside a craftpath repo. */
export async function version(this: Context): Promise<void> {
    console.log("craftpath 0.1.0");
}
