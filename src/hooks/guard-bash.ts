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
 *
 * This hook also denies the two commands that ARE a human sign-off --
 * `craftpath approve` on a non-auto gate, and `craftpath task ack`. That half
 * is exact, because it matches craftpath's own command surface rather than
 * arbitrary bash, and it is what makes `plan = "manual"` mean something: before
 * it, the policy was enforced by a sentence of prose the agent was asked to
 * obey about itself.
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

/**
 * Shell operators that end one command and begin another.
 *
 * This finds which parts of a chain are craftpath's own -- it is not an attempt
 * to parse bash. The remainder is judged as ONE string again below, so a
 * separator inside a quoted argument costs nothing.
 */
const SEP = /(?:&&|\|\||[;|&\n])/;

/**
 * Everything in the command that is not a craftpath invocation, as one string.
 *
 * The exemption belongs to craftpath's own calls, not to whatever is chained to
 * them. Testing the CLI pattern against the whole command allowed
 * `craftpath status && echo x > .craftpath/state/T1.json` wholesale, and the
 * allow-list's own `cd /repo && craftpath status` shows chaining is an expected
 * shape rather than an exotic one.
 *
 * Judged together rather than segment by segment on purpose: per-segment would
 * be WEAKER than no splitting at all, because
 * `bun -e "x; Bun.write('.craftpath/state/T1.json','{}')"` puts the path in one
 * piece and the interpreter in another.
 */
function nonCli(cmd: string): string {
    return cmd
        .split(SEP)
        .filter((segment) => !CLI_RE.test(segment.trim()))
        .join(" ");
}

/** `craftpath approve <gate>` -- captures the gate so the policy can be read. */
const APPROVE_RE =
    /(?:^|[;|&]\s*|\$\(\s*)(?:[\w./-]*\/)?craftpath\s+approve\s+([a-z]+)/;

/** `craftpath task ack <id> <criterion>` -- a person signing off a manual criterion. */
const ACK_RE = /(?:^|[;|&]\s*|\$\(\s*)(?:[\w./-]*\/)?craftpath\s+task\s+ack\b/;

const SIGNOFF_MESSAGE = [
    "Refused: this is a human sign-off, so it has to come from a human's terminal.",
    "Stop here, show your work, and ask for one of:",
    "  craftpath approve <gate>          # in the user's own shell",
    "  craftpath task ack <id> <crit>    # a manual criterion, read by a person",
    "",
    "A gate whose `[gates]` policy is `auto` is yours to run and is not blocked.",
].join("\n");

const MESSAGE = [
    "Refused: this command appears to write to .craftpath/state/, which is owned by the Craftpath CLI.",
    "Use the sanctioned commands instead:",
    "  craftpath task start|verify|done <id>",
    '  craftpath amend <id> --reason "<why>"',
    "  craftpath reconcile --fix",
    "Reading state/ is fine -- cat, grep and craftpath status are all allowed.",
].join("\n");

/**
 * Whether this command is a human sign-off the agent must not perform itself.
 *
 * Unlike the state-write guard above, this half IS exact: it matches craftpath's
 * own command surface, not arbitrary bash. `policy` comes from `[gates]`, and an
 * absent or unreadable policy reads as `manual` -- a config that cannot be
 * parsed must not silently hand over every sign-off in the workflow.
 */
function isSignOff(cmd: string, policy: Record<string, string>): boolean {
    if (ACK_RE.test(cmd)) return true;

    const gate = APPROVE_RE.exec(cmd)?.[1];
    return gate !== undefined && policy[gate] !== "auto";
}

/**
 * The single decision, and the reason for it.
 *
 * One function rather than two because the two rules are not independent: a
 * `craftpath` invocation exempts ITSELF from the state-write rule (never the
 * commands chained around it), and the sign-off rule is the one exception to
 * that exemption. Splitting them meant `main`
 * re-ran the check without the policy, so an `auto` gate -- which the workflow
 * explicitly tells the agent to approve itself -- was refused with the wrong
 * message. Both callers now share this, so they cannot disagree again.
 */
function verdict(
    command: string,
    policy: Record<string, string>,
): "allow" | "sign-off" | "state-write" {
    const cmd = normalize(command);
    if (isSignOff(cmd, policy)) return "sign-off";
    const rest = nonCli(cmd);
    return STATE_RE.test(rest) && WRITE_RE.test(rest) ? "state-write" : "allow";
}

/**
 * Exported for testing without spawning a process.
 *
 * `policy` is passed in rather than read here so this stays synchronous and
 * total: the same input always gives the same answer.
 */
export function shouldBlock(command: string, policy: Record<string, string> = {}): boolean {
    return verdict(command, policy) !== "allow";
}

/**
 * `[gates]` read without Zod, without the config module, and without throwing.
 *
 * The hook path must stay import-free (~4ms bare vs ~28ms once Zod is in the
 * module graph) and it fires on every Bash call, so this is a bare TOML parse
 * that returns {} on any failure -- which `isSignOff` reads as `manual`.
 */
async function policies(): Promise<Record<string, string>> {
    try {
        const text = await Bun.file(".craftpath/config.toml").text();
        const parsed = Bun.TOML.parse(text) as { gates?: Record<string, unknown> };
        return Object.fromEntries(
            Object.entries(parsed.gates ?? {}).map(([k, v]) => [k, String(v)]),
        );
    } catch {
        return {};
    }
}

export async function main(): Promise<never> {
    const event = await readEvent();
    const command = event.tool_input?.command;
    if (typeof command !== "string") allow();

    switch (verdict(command, await policies())) {
        case "sign-off":
            block(SIGNOFF_MESSAGE);
        // fallthrough is impossible: block() returns never.
        case "state-write":
            block(MESSAGE);
        default:
            allow();
    }
}
