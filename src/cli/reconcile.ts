import { reconcile } from "../core/reconcile";
import type { Context } from "./context";

/**
 * Report drift between recorded state and the repository, or repair it.
 *
 * The flag is the whole difference: without it this writes nothing, because
 * repair is a decision and the report is what informs it.
 */
export async function report(this: Context, flags: { fix: boolean }): Promise<void> {
    await reconcile(process.cwd(), { fix: flags.fix });
}
