import { archive as move } from "../core/archive";
import type { Context } from "./context";

export async function archive(this: Context): Promise<void> {
    await move(process.cwd());
}
