import { UsageError } from "../exit";
import { status as runStatus, workNew } from "../core/work";
import type { Context } from "./context";

/**
 * Positionals are an array rather than a fixed tuple so that a forgotten quote
 * gets the message that fixes it. Stricli would say "too many arguments"; the
 * mistake is almost always missing quotes, and saying so costs one line.
 */
export async function newWork(
    this: Context,
    flags: { light: boolean; standard: boolean },
    ...title: string[]
): Promise<void> {
    if (title.length !== 1) {
        throw new UsageError(
            title.length === 0
                ? 'usage: craftpath work new "<title>" [--light|--standard]'
                : `expected one title, got ${title.length}. ` +
                      `Quote it: craftpath work new "${title.join(" ")}"`,
        );
    }
    if (flags.light && flags.standard) {
        throw new UsageError("--light and --standard are mutually exclusive");
    }
    await workNew(process.cwd(), title[0]!, flags.standard ? "standard" : "light");
}

export async function status(this: Context, flags: { brief: boolean }): Promise<void> {
    await runStatus(process.cwd(), flags.brief);
}
