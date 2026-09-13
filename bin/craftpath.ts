#!/usr/bin/env bun
/**
 * Craftpath CLI.
 *
 * CRITICAL: every import below is dynamic. Guards run on every Edit, Write and
 * Bash tool call -- measured ~5ms with lazy imports vs ~28ms once Zod is in the
 * module graph. A single static `import { z }` here would tax every tool use in
 * the session.
 */
import { Exit } from "../src/exit";

const USAGE = `craftpath <command>

  init                      scaffold .craftpath/, wire hooks, write commands
  update                    rewrite slash commands after upgrading craftpath

  work new "<title>"        allocate a work item and scaffold its artifacts
  status [--brief]          current work item, gates, tasks
  task add <id> --title "<t>" [--skills a,b] [--depends T001]
  approve <phase>           record a gate approval (requirement|plan|result)
  doctor                    verification health report
  validate [--complete]     structural, or completion checks
  version

  hook guard-write          internal; wired by init
  hook guard-bash           internal; wired by init
`;

async function main(argv: string[]): Promise<void> {
    const [command, ...rest] = argv;

    switch (command) {
        case "hook": {
            const which = rest[0];
            if (which === "guard-write") {
                const { main } = await import("../src/hooks/guard-write");
                await main();
            }
            if (which === "guard-bash") {
                const { main } = await import("../src/hooks/guard-bash");
                await main();
            }
            // Unknown guard: fail OPEN. A broken hook must not brick the session.
            process.exit(Exit.OK);
            break;
        }

        case "init": {
            const { init } = await import("../src/core/init");
            await init(process.cwd());
            process.exit(Exit.OK);
            break;
        }

        case "update": {
            const { writeCommands } = await import("../src/core/init");
            const n = await writeCommands(process.cwd());
            console.log(`rewrote   .claude/commands/craftpath/ (${n} slash commands)`);
            process.exit(Exit.OK);
            break;
        }

        case "work": {
            if (rest[0] !== "new" || !rest[1]) {
                console.error('usage: craftpath work new "<title>" [--light|--standard]');
                process.exit(Exit.USAGE_ERROR);
            }
            const { workNew } = await import("../src/core/work");
            const mode = rest.includes("--standard") ? "standard" : "light";
            await workNew(process.cwd(), rest[1]!, mode);
            process.exit(Exit.OK);
            break;
        }

        case "status": {
            const { status } = await import("../src/core/work");
            await status(process.cwd(), rest.includes("--brief"));
            process.exit(Exit.OK);
            break;
        }

        case "task": {
            if (rest[0] !== "add" || !rest[1]) {
                console.error(
                    'usage: craftpath task add <id> --title "<title>" [--skills a,b] [--depends T001,T002]',
                );
                process.exit(Exit.USAGE_ERROR);
            }
            const flag = (name: string): string | undefined => {
                const at = rest.indexOf(`--${name}`);
                return at === -1 ? undefined : rest[at + 1];
            };
            const list = (name: string): string[] | undefined =>
                flag(name)?.split(",").map((s) => s.trim()).filter(Boolean);

            const title = flag("title");
            if (!title) {
                console.error("craftpath task add requires --title");
                process.exit(Exit.USAGE_ERROR);
            }
            const { taskAdd } = await import("../src/core/task");
            await taskAdd(process.cwd(), rest[1]!, {
                title,
                skills: list("skills"),
                dependsOn: list("depends"),
            });
            process.exit(Exit.OK);
            break;
        }

        case "approve": {
            if (!rest[0]) {
                console.error("usage: craftpath approve <requirement|plan|result>");
                process.exit(Exit.USAGE_ERROR);
            }
            const { approve } = await import("../src/core/approve");
            await approve(process.cwd(), rest[0]!);
            process.exit(Exit.OK);
            break;
        }

        case "doctor": {
            const { doctor } = await import("../src/core/doctor");
            await doctor(process.cwd());
            process.exit(Exit.OK);
            break;
        }

        case "validate": {
            // M1. Stubbed so the Stop hook is wireable from M0 onward.
            //
            // Bare `validate` is the Stop hook (init.ts) and must exit 0 until
            // it is real -- a Stop hook that fails is noise on every pause.
            // `--complete` gates result, PR and archive, so it must refuse
            // rather than report a completion it cannot prove.
            if (rest.includes("--complete")) {
                console.error(
                    "validate --complete: not implemented until M1; completion is unproven",
                );
                process.exit(Exit.VALIDATION_FAILED);
            }
            console.error("validate: not implemented until M1");
            process.exit(Exit.OK);
            break;
        }

        case "version":
            console.log("craftpath 0.1.0");
            process.exit(Exit.OK);
            break;

        default:
            console.error(USAGE);
            process.exit(command ? Exit.USAGE_ERROR : Exit.OK);
    }
}

/**
 * Known failures carry their own exit code. Without this, an uncaught
 * PreconditionError exits 1 with a source dump -- and exit codes are the
 * contract hooks and CI branch on, so "refuses" would mean nothing.
 *
 * An unknown error still throws: a stack trace is the right output for a bug,
 * and swallowing it would hide the one case where the detail matters.
 */
function hasExitCode(error: unknown): error is Error & { exitCode: number } {
    return (
        error instanceof Error &&
        typeof (error as { exitCode?: unknown }).exitCode === "number"
    );
}

try {
    await main(process.argv.slice(2));
} catch (error) {
    if (!hasExitCode(error)) throw error;
    console.error(error.message);
    process.exit(error.exitCode);
}
