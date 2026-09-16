/**
 * Best-effort deny of shell commands that write to .craftpath/state/**.
 *
 * DELIBERATE LIMITATION -- read this before "improving" it.
 *
 * Blocking a path is exact. Blocking a *shell command* means parsing arbitrary
 * bash, which cannot be done reliably. All of these defeat any regex:
 *
 *     bun -e "await Bun.write('.craftpath/sta'+'te/T1.json','{}')"
 *     D=.craftpath/state; echo '{}' > $D/T1.json
 *     base64 -d <<< '...' > .craftpath/state/T1.json
 *
 * So this is a speed bump against casual shortcuts, not a boundary. The layer
 * that actually holds is `craftpath validate` re-reading evidence logs and
 * checking them against recorded exit codes (mechanism M3): forging plausible
 * test output is a far higher bar than dodging a regex.
 *
 * Tuned to over-block rather than under-block. A false positive costs the model
 * one retry through the CLI, which is where it should have gone anyway.
 */
import { allow, block, normalize, readEvent } from "./io";

/** Mentions state/ at all. */
const STATE_RE = /\.craftpath\/state\b/;

/**
 * Anything that could plausibly mutate a file. Over-broad on purpose:
 * interpreter arguments are unparseable, so interpreters are included wholesale.
 */
const WRITE_RE = new RegExp(
    [
        />>?/,
        /\b(tee|dd|truncate|install)\b/,
        /\b(cp|mv|rm|rmdir|ln|touch|mkdir)\b/,
        /\bsed\b[^|]*\s-[a-zA-Z]*i/,
        /\b(perl|ruby|awk)\b[^|]*\s-[a-zA-Z]*i/,
        /\b(bun|node|deno|python3?|perl|ruby|php)\b/,
        /\bjq\b[^|]*\s(-i|--in-place)\b/,
        /\bgit\s+(checkout|restore|apply|stash)\b/,
    ]
        .map((r) => `(?:${r.source})`)
        .join("|"),
);

/**
 * The sanctioned tool, invoked AS A COMMAND.
 *
 * Must not match the `craftpath` substring inside the `.craftpath/` directory
 * name. A naive /\bcraftpath\b/ matches ".craftpath/state/..." and silently
 * disables this entire guard -- it blocked nothing while appearing healthy.
 * Caught only because the tests asserted on specific commands.
 */
const CLI_RE = /(?:^|[;|&]\s*|\$\(\s*)(?:[\w./-]*\/)?craftpath\s/;

const MESSAGE = [
    "Refused: this command appears to write to .craftpath/state/, which is owned by the Craftpath CLI.",
    "Use the sanctioned commands instead:",
    "  craftpath task start|verify|ack|done <id>",
    "  craftpath approve <phase>",
    '  craftpath amend <id> --reason "<why>"',
    "  craftpath reconcile --fix",
    "Reading state/ is fine -- cat, grep and craftpath status are all allowed.",
].join("\n");

/** Exported for testing without spawning a process. */
export function shouldBlock(command: string): boolean {
    const cmd = normalize(command);
    if (CLI_RE.test(cmd)) return false;
    return STATE_RE.test(cmd) && WRITE_RE.test(cmd);
}

export async function main(): Promise<never> {
    const event = await readEvent();
    const command = event.tool_input?.command;
    if (typeof command !== "string") allow();
    if (shouldBlock(command)) block(MESSAGE);
    allow();
}
