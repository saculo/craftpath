import { init as runInit, installSkills, writeCommands } from "../core/init";
import type { Context } from "./context";

export async function init(this: Context): Promise<void> {
    await runInit(process.cwd());
}

export async function update(this: Context): Promise<void> {
    const n = await writeCommands(process.cwd());
    console.log(`rewrote   .claude/commands/craftpath/ (${n} slash commands)`);
    // Adds only what is missing: a skill the project edited is its own.
    const added = await installSkills(process.cwd());
    console.log(`added     ${added.skills} skills, ${added.rules} rules missing from .claude/`);
}
