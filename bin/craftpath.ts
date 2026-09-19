#!/usr/bin/env bun
/**
 * Craftpath CLI.
 *
 * CRITICAL: every import below is dynamic. Guards run on every Edit, Write and
 * Bash tool call -- measured ~5ms with lazy imports vs ~28ms once Zod is in the
 * module graph. A single static `import { z }` here would tax every tool use in
 * the session.
 */
import { BLOCK, Exit } from "../src/exit";

const USAGE = `craftpath <command>

  init                      scaffold .craftpath/, wire hooks, write commands
  update                    after upgrading: rewrite slash commands, add new skills and rules

  work new "<title>"        allocate a work item and scaffold its artifacts
  status [--brief]          current work item, gates, tasks
  task add <id> --title "<t>" [--skills a,b] [--depends T001] [--reason "<why>"]
                            design task: --design <ux|architecture>
                                         --design-reason "<why>" --produces a,b
  task start <id>           begin a task; resolves dependency artifacts
  task verify <id>          run the criteria's commands and record evidence
  task ack <id> <criterion> sign off a manual criterion
  task done <id>            complete a task; refuses without evidence
  amend <id> --reason "<why>"  reopen a task; reopens the plan and result gates
  approve <phase> [--approver <email>]
                            record a gate approval (requirement|plan|result).
                            A gate that is not "auto" needs a terminal or --approver.
  doctor                    verification health report
  validate [--complete]     structural, or completion checks
  pr body                   PR description from what was proven; refuses until complete
  archive                   move a proven work item to .craftpath/archive/
  version

  hook guard-write          internal; wired by init
  hook guard-bash           internal; wired by init
  hook validate             internal; wired by init (Stop hook, blocks on exit 2)
`;

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
            if (which === "validate") {
                // Claude Code blocks on exit 2 and treats every other non-zero
                // code as a hook ERROR that never reaches the model. `validate`
                // exits 1 so humans and CI can branch on it, so wiring it to the
                // Stop hook directly meant structural corruption printed a red
                // line nobody saw and the session ended anyway. This wrapper is
                // the translation layer: same checks, hook-protocol exit codes.
                const { validate } = await import("../src/core/validate");
                try {
                    await validate(process.cwd());
                } catch (error) {
                    if (!hasExitCode(error)) throw error;
                    console.error((error as Error).message);
                    process.exit(BLOCK);
                }
                process.exit(Exit.OK);
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
            const { installSkills, writeCommands } = await import("../src/core/init");
            const n = await writeCommands(process.cwd());
            console.log(`rewrote   .claude/commands/craftpath/ (${n} slash commands)`);
            // Adds only what is missing: a skill the project edited is its own.
            const added = await installSkills(process.cwd());
            console.log(`added     ${added.skills} skills, ${added.rules} rules missing from .claude/`);
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
            const sub = rest[0];
            const id = rest[1];
            if (!sub || !id) {
                console.error(
                    "usage: craftpath task <add|start|verify|ack|done> <id> [options]",
                );
                process.exit(Exit.USAGE_ERROR);
            }

            const flag = (name: string): string | undefined => {
                const at = rest.indexOf(`--${name}`);
                return at === -1 ? undefined : rest[at + 1];
            };
            const list = (name: string): string[] | undefined =>
                flag(name)
                    ?.split(",")
                    .map((value) => value.trim())
                    .filter(Boolean);

            if (sub === "add") {
                const title = flag("title");
                if (!title) {
                    console.error("craftpath task add requires --title");
                    process.exit(Exit.USAGE_ERROR);
                }
                const { taskAdd } = await import("../src/core/task");
                await taskAdd(process.cwd(), id, {
                    title,
                    skills: list("skills"),
                    dependsOn: list("depends"),
                    design: flag("design"),
                    designReason: flag("design-reason"),
                    produces: list("produces"),
                    reason: flag("reason"),
                });
            } else if (sub === "start") {
                const { taskStart } = await import("../src/core/task");
                await taskStart(process.cwd(), id);
            } else if (sub === "verify") {
                const { taskVerify } = await import("../src/core/task");
                await taskVerify(process.cwd(), id);
            } else if (sub === "done") {
                const { taskDone } = await import("../src/core/task");
                await taskDone(process.cwd(), id);
            } else if (sub === "ack") {
                const criterion = rest[2];
                if (!criterion) {
                    console.error("usage: craftpath task ack <id> <criterion>");
                    process.exit(Exit.USAGE_ERROR);
                }
                const { taskAck } = await import("../src/core/task");
                await taskAck(process.cwd(), id, criterion);
            } else {
                console.error(`unknown task subcommand: ${sub}`);
                process.exit(Exit.USAGE_ERROR);
            }
            process.exit(Exit.OK);
            break;
        }

        case "amend": {
            const at = rest.indexOf("--reason");
            const reason = at === -1 ? undefined : rest[at + 1];
            if (!rest[0] || rest[0].startsWith("--") || !reason) {
                console.error('usage: craftpath amend <id> --reason "<why>"');
                process.exit(Exit.USAGE_ERROR);
            }
            const { taskAmend } = await import("../src/core/task");
            await taskAmend(process.cwd(), rest[0]!, reason!);
            process.exit(Exit.OK);
            break;
        }

        case "approve": {
            if (!rest[0] || rest[0].startsWith("--")) {
                console.error(
                    "usage: craftpath approve <requirement|plan|result> [--approver <email>]",
                );
                process.exit(Exit.USAGE_ERROR);
            }
            const at = rest.indexOf("--approver");
            const { approve } = await import("../src/core/approve");
            await approve(process.cwd(), rest[0]!, {
                approver: at === -1 ? undefined : rest[at + 1],
            });
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
            const { validate, validateComplete } = await import("../src/core/validate");
            await (rest.includes("--complete") ? validateComplete : validate)(process.cwd());
            process.exit(Exit.OK);
            break;
        }

        case "pr": {
            if (rest[0] !== "body") {
                console.error("usage: craftpath pr body");
                process.exit(Exit.USAGE_ERROR);
            }
            const { prBody } = await import("../src/core/pr");
            // Awaited write, not process.stdout.write: exiting straight after an
            // unflushed pipe write can truncate the body gh receives.
            await Bun.write(Bun.stdout, await prBody(process.cwd()));
            process.exit(Exit.OK);
            break;
        }

        case "archive": {
            const { archive } = await import("../src/core/archive");
            await archive(process.cwd());
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

try {
    await main(process.argv.slice(2));
} catch (error) {
    if (!hasExitCode(error)) throw error;
    console.error(error.message);
    process.exit(error.exitCode);
}
