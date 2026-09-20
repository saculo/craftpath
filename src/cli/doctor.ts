import { doctor as report } from "../core/doctor";
import type { Context } from "./context";

export async function doctor(this: Context): Promise<void> {
    await report(process.cwd());
}
