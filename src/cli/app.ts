import {
    ExitCode as Stricli,
    buildApplication,
    buildCommand,
    buildRouteMap,
    text_en,
    type Application,
} from "@stricli/core";
import { Exit, hasExitCode } from "../exit";
import type { Context, NoFlags } from "./context";

export const USAGE = `craftpath <command>

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

const id = { brief: "task id", placeholder: "id", parse: String };
const str = (brief: string) => ({ kind: "parsed", parse: String, brief, optional: true }) as const;
const required = (brief: string) => ({ kind: "parsed", parse: String, brief }) as const;
const bool = (brief: string) => ({ kind: "boolean", brief, default: false }) as const;

const work = buildRouteMap({
    routes: {
        new: buildCommand({
            loader: async () => (await import("./work")).newWork,
            parameters: {
                positional: {
                    kind: "array",
                    parameter: { brief: "work item title", placeholder: "title", parse: String },
                },
                flags: { light: bool("light mode"), standard: bool("standard mode") },
            },
            docs: { brief: "allocate a work item and scaffold its artifacts" },
        }),
    },
    docs: { brief: "work items" },
});

/** The three task transitions that take nothing but an id. */
const transition = (
    loader: () => Promise<(this: Context, flags: NoFlags, id: string) => Promise<void>>,
    brief: string,
) =>
    buildCommand({
        loader,
        parameters: { positional: { kind: "tuple", parameters: [id] } },
        docs: { brief },
    });

const task = buildRouteMap({
    routes: {
        add: buildCommand({
            loader: async () => (await import("./task")).add,
            parameters: {
                positional: { kind: "tuple", parameters: [id] },
                flags: {
                    title: required("what the task does"),
                    skills: str("comma-separated skills to bind"),
                    depends: str("comma-separated task ids this one waits on"),
                    design: str("design kind: ux or architecture"),
                    designReason: str("why the decision needs its own task"),
                    produces: str("comma-separated artifacts this task writes"),
                    reason: str("why this task is being added after plan approval"),
                },
            },
            docs: { brief: "add a task to the open work item" },
        }),
        start: transition(
            async () => (await import("./task")).start,
            "begin a task; resolves dependency artifacts",
        ),
        verify: transition(
            async () => (await import("./task")).verify,
            "run the criteria's commands and record evidence",
        ),
        done: transition(
            async () => (await import("./task")).done,
            "complete a task; refuses without evidence",
        ),
        ack: buildCommand({
            loader: async () => (await import("./task")).ack,
            parameters: {
                positional: {
                    kind: "tuple",
                    parameters: [
                        id,
                        { brief: "criterion id", placeholder: "criterion", parse: String },
                    ],
                },
            },
            docs: { brief: "sign off a manual criterion" },
        }),
    },
    docs: { brief: "tasks" },
});

/** A command that takes no arguments at all. */
const bare = (loader: () => Promise<(this: Context) => Promise<void>>, brief: string) =>
    buildCommand({ loader, parameters: {}, docs: { brief } });

const root = buildRouteMap({
    routes: {
        init: bare(
            async () => (await import("./init")).init,
            "scaffold .craftpath/, wire hooks, write commands",
        ),
        update: bare(
            async () => (await import("./init")).update,
            "rewrite slash commands, add new skills and rules",
        ),
        work,
        status: buildCommand({
            loader: async () => (await import("./work")).status,
            parameters: { flags: { brief: bool("one line instead of the full report") } },
            docs: { brief: "current work item, gates, tasks" },
        }),
        task,
        amend: buildCommand({
            loader: async () => (await import("./task")).amend,
            parameters: {
                positional: { kind: "tuple", parameters: [id] },
                flags: { reason: required("why the task is being reopened") },
            },
            docs: { brief: "reopen a task; reopens the plan and result gates" },
        }),
        approve: buildCommand({
            loader: async () => (await import("./approve")).approve,
            parameters: {
                positional: {
                    kind: "tuple",
                    parameters: [
                        { brief: "requirement|plan|result", placeholder: "phase", parse: String },
                    ],
                },
                flags: { approver: str("email of the human approving this gate") },
            },
            docs: { brief: "record a gate approval" },
        }),
        doctor: bare(async () => (await import("./doctor")).doctor, "verification health report"),
        validate: buildCommand({
            loader: async () => (await import("./validate")).check,
            parameters: { flags: { complete: bool("completion checks instead of structural") } },
            docs: { brief: "structural, or completion checks" },
        }),
        pr: buildRouteMap({
            routes: {
                body: bare(
                    async () => (await import("./pr")).body,
                    "PR description from what was proven",
                ),
            },
            docs: { brief: "pull request output" },
        }),
        archive: bare(
            async () => (await import("./archive")).archive,
            "move a proven work item to .craftpath/archive/",
        ),
        version: bare(async () => (await import("./version")).version, "print the version"),
    },
    docs: { brief: "craftpath" },
});

/**
 * Known failures print their message alone. Without this, stricli formats an
 * exception as its stack -- and a PreconditionError is a refusal, not a crash,
 * so a source dump would bury the one line that says what to do instead.
 *
 * An unknown error keeps its stack: that is the right output for a bug, and
 * swallowing it would hide the one case where the detail matters.
 */
const message = (exc: unknown): string =>
    hasExitCode(exc) ? exc.message : (text_en.formatException?.(exc) ?? String(exc));

export const app: Application<Context> = buildApplication(root, {
    name: "craftpath",
    // So that `designReason` is spelled `--design-reason` on the command line
    // and in generated help, which is how every craftpath doc already writes it.
    scanner: { caseStyle: "allow-kebab-for-camel" },
    determineExitCode: (exc) => (hasExitCode(exc) ? exc.exitCode : Exit.VALIDATION_FAILED),
    localization: {
        text: {
            ...text_en,
            // A mistyped flag gets stricli's "did you mean --standard?", which
            // is the better answer for a near miss. A command that does not
            // exist is the one case where the whole list is what was wanted --
            // and the list has to name the flags, because that is where anyone
            // looking for --design or --approver goes first.
            noCommandRegisteredForInput: () => USAGE,
            exceptionWhileRunningCommand: message,
            commandErrorResult: message,
        },
    },
});

/**
 * Stricli reports argument errors through its own negative codes and does NOT
 * route them through `determineExitCode` -- that hook only sees what a command
 * threw. Both halves have to land on craftpath's taxonomy, or a typo'd flag
 * would exit 252 where every caller expects 4.
 */
export function exitCodeFor(stored: number | string | null | undefined): number {
    const code = typeof stored === "number" ? stored : Number(stored ?? 0);
    if (Number.isNaN(code)) return Exit.VALIDATION_FAILED;
    if (code >= 0) return code;
    // The caller typed it wrong.
    if (code === Stricli.InvalidArgument || code === Stricli.UnknownCommand) {
        return Exit.USAGE_ERROR;
    }
    // Everything else negative is craftpath or stricli malfunctioning.
    return Exit.VALIDATION_FAILED;
}
