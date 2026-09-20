import { prBody } from "../core/pr";
import type { Context } from "./context";

export async function body(this: Context): Promise<void> {
    // Awaited write, not process.stdout.write: exiting straight after an
    // unflushed pipe write can truncate the body gh receives.
    await Bun.write(Bun.stdout, await prBody(process.cwd()));
}
