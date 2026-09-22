import { reconcile } from "../core/reconcile";
import type { Context } from "./context";

/**
 * Report drift between recorded state and the repository.
 *
 * Reporting only: repair is a decision, and `--fix` is where it is taken.
 */
export async function report(this: Context): Promise<void> {
    await reconcile(process.cwd());
}
