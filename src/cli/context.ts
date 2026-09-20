import type { ApplicationContext, CommandContext, StricliProcess } from "@stricli/core";

/**
 * What stricli hands every command.
 *
 * Deliberately no richer than stricli's own: commands here take their input
 * from `process.cwd()` and write with `console.log`, exactly as they did when
 * this was a switch statement.
 */
export type Context = CommandContext;

/**
 * The exit code lands on an object craftpath owns rather than on `process`.
 *
 * That is not cosmetic. Bun normalises a negative `process.exitCode` to its
 * wrapped byte on read, so stricli's `InvalidArgument` (-4) would come back as
 * 252 and the mapping in `app.ts` would silently do nothing.
 */
export interface CliProcess extends StricliProcess {
    exitCode?: number | string | null;
}

export function buildContext(): ApplicationContext & { readonly process: CliProcess } {
    return {
        process: {
            stdout: process.stdout,
            stderr: process.stderr,
            env: process.env,
            exitCode: undefined,
        },
    };
}
