import { archive as move } from "../core/archive";
import type { Context } from "./context";

export async function archive(this: Context, flags: { work?: string }): Promise<void> {
    await move(process.cwd(), flags.work);
}
