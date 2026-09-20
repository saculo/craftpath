import { BLOCK, Exit, hasExitCode } from "../exit";

/**
 * The hooks init wires into Claude Code.
 *
 * Not a stricli command, and dispatched before stricli loads. Two reasons, both
 * load-bearing:
 *
 *  - Cost. These run on every Edit, Write and Bash tool call. Building the
 *    route map to reach them measured 27ms against 13ms for dispatching here,
 *    on a path that takes no flags and is never typed by a human -- about three
 *    seconds of pure tax across a 200-call session.
 *  - Failing open. An unrecognised guard name must exit 0. Claude Code blocks
 *    on exit 2 and treats every other non-zero code as a hook ERROR that never
 *    reaches the model, so a route map refusing it as an unknown command would
 *    end sessions rather than report itself.
 */
export async function hook(args: string[]): Promise<never> {
    switch (args[0]) {
        case "guard-write": {
            const { main } = await import("../hooks/guard-write");
            return await main();
        }
        case "guard-bash": {
            const { main } = await import("../hooks/guard-bash");
            return await main();
        }
        case "validate": {
            // `validate` exits 1 so humans and CI can branch on it, but 1 is a
            // hook ERROR nobody sees. This wrapper is the translation layer:
            // same checks, hook-protocol exit codes.
            const { validate } = await import("../core/validate");
            try {
                await validate(process.cwd());
            } catch (error) {
                if (!hasExitCode(error)) throw error;
                console.error(error.message);
                return process.exit(BLOCK);
            }
            return process.exit(Exit.OK);
        }
        default:
            return process.exit(Exit.OK);
    }
}

