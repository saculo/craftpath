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

function usage(message: string): never {
    console.error(message);
    process.exit(Exit.USAGE_ERROR);
}

/**
 * argv -> positionals and flags, refusing anything not declared.
 *
 * Both halves fix a real defect. Unknown flags were ignored, so a typo'd
 * `--standrd` silently selected light mode and `--light` was advertised in the
 * usage string and never read. And a flag's value was "the next argv entry"
 * whatever it was, so `--title --skills backend` produced a task titled
 * "--skills" -- past the schema, because it is a valid string.
 *
 * Positionals are collected wherever they appear, so `work new --standard
 * "Avatar upload"` finds the title rather than taking argv[1] and naming the
 * work item after the flag.
 *
 * The cost is that a value genuinely beginning with `--` cannot be passed. No
 * flag here takes one, and refusing is the safer default of the two.
 */
function parseArgs(
    argv: string[],
    spec: Record<string, "value" | "boolean">,
): { positionals: string[]; flags: Record<string, string | boolean> } {
    const positionals: string[] = [];
    const flags: Record<string, string | boolean> = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (!arg.startsWith("--")) {
            positionals.push(arg);
            continue;
        }

        const name = arg.slice(2);
        const kind = spec[name];
        if (kind === undefined) {
            const known = Object.keys(spec).map((f) => `--${f}`);
            usage(
                `unknown flag: ${arg}` +
                (known.length > 0 ? ` (this command takes ${known.join(", ")})` : ""),
            );
        }
        if (kind === "boolean") {
            flags[name] = true;
            continue;
        }

        const value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
            usage(`${arg} needs a value`);
        }
        flags[name] = value;
        i++;
    }
    return { positionals, flags };
}

/** A flag's value, or undefined. Booleans never read as values. */
const text = (
    flags: Record<string, string | boolean>,
    name: string,
): string | undefined => (typeof flags[name] === "string" ? flags[name] : undefined);

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
            const WORK_USAGE = 'usage: craftpath work new "<title>" [--light|--standard]';
            if (rest[0] !== "new") usage(WORK_USAGE);

            const { positionals, flags } = parseArgs(rest.slice(1), {
                light: "boolean",
                standard: "boolean",
            });
            if (positionals.length !== 1) {
                usage(
                    positionals.length === 0
                        ? WORK_USAGE
                        : `expected one title, got ${positionals.length}. ` +
                          `Quote it: craftpath work new "${positionals.join(" ")}"`,
                );
            }
            if (flags.light === true && flags.standard === true) {
                usage("--light and --standard are mutually exclusive");
            }

            const { workNew } = await import("../src/core/work");
            await workNew(process.cwd(), positionals[0]!, flags.standard === true ? "standard" : "light");
            process.exit(Exit.OK);
            break;
        }

        case "status": {
            const { flags } = parseArgs(rest, { brief: "boolean" });
            const { status } = await import("../src/core/work");
            await status(process.cwd(), flags.brief === true);
            process.exit(Exit.OK);
            break;
        }

        case "task": {
            const { positionals, flags } = parseArgs(rest, {
                title: "value",
                skills: "value",
                depends: "value",
                design: "value",
                "design-reason": "value",
                produces: "value",
                reason: "value",
            });
            const [sub, id] = positionals;
            if (!sub || !id) {
                usage("usage: craftpath task <add|start|verify|ack|done> <id> [options]");
            }

            const flag = (name: string): string | undefined => text(flags, name);
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
                const criterion = positionals[2];
                if (!criterion) usage("usage: craftpath task ack <id> <criterion>");
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
            const { positionals, flags } = parseArgs(rest, { reason: "value" });
            const reason = text(flags, "reason");
            if (!positionals[0] || !reason) {
                usage('usage: craftpath amend <id> --reason "<why>"');
            }
            const { taskAmend } = await import("../src/core/task");
            await taskAmend(process.cwd(), positionals[0]!, reason!);
            process.exit(Exit.OK);
            break;
        }

        case "approve": {
            const { positionals, flags } = parseArgs(rest, { approver: "value" });
            if (!positionals[0]) {
                usage("usage: craftpath approve <requirement|plan|result> [--approver <email>]");
            }
            const { approve } = await import("../src/core/approve");
            await approve(process.cwd(), positionals[0]!, {
                approver: text(flags, "approver"),
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
            // A typo'd `--complet` used to fall through to structural
            // validation and exit 0, which reads as "proven complete".
            const { flags } = parseArgs(rest, { complete: "boolean" });
            const { validate, validateComplete } = await import("../src/core/validate");
            await (flags.complete === true ? validateComplete : validate)(process.cwd());
            process.exit(Exit.OK);
            break;
        }

        case "pr": {
            if (rest[0] !== "body" || rest.length > 1) usage("usage: craftpath pr body");
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
