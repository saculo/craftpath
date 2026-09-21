/**
 * Asking which harnesses to install into.
 *
 * A numbered list read from stdin rather than a raw-mode TUI: `init` is a
 * one-shot command run once per project, and a full-screen selector would be
 * more machinery than the question is worth -- and one more thing to fail in a
 * terminal that is not what it claims to be.
 *
 * `--harness` remains the answer for anything scripted; this is only what a
 * person at a terminal gets instead of a guess.
 */
import { createInterface } from "node:readline/promises";
import type { Harness } from "../harness/index";

/** The question, with the options numbered as `parseChoice` expects them. */
export function promptFor(options: Harness[]): string {
    const lines = options.map((h, i) => `  ${i + 1}. ${h.label}`);
    return [
        "Which harnesses should craftpath install into?",
        "",
        ...lines,
        "",
        "Pick one or several -- both is a normal answer, and each gets the same",
        "skills, rules and commands in the shape it can read.",
        `Numbers or names, comma separated (default: 1):`,
    ].join("\n");
}

/**
 * Read one answer.
 *
 * Numbers and names both, because the prompt stands in for `--harness`, and an
 * answer that cannot be pasted into the flag it replaces teaches the operator
 * two vocabularies for one question.
 *
 * Empty takes the default rather than nothing: someone pressing Enter is
 * accepting the suggestion, not asking for an install with no harness -- which
 * would leave a project with state and no way to work on it.
 */
export function parseChoice(answer: string, options: Harness[]): Harness[] {
    const tokens = answer
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter((t) => t !== "");
    if (tokens.length === 0) return [options[0]!];

    const chosen = new Map<string, Harness>();
    for (const token of tokens) {
        const index = /^\d+$/.test(token) ? Number(token) : null;
        const harness = index !== null ? options[index - 1] : options.find((h) => h.id === token);
        if (harness === undefined) {
            throw new Error(
                `${JSON.stringify(token)} is not one of the options; ` +
                    `use 1-${options.length} or one of: ${options.map((h) => h.id).join(", ")}`,
            );
        }
        chosen.set(harness.id, harness);
    }
    return [...chosen.values()];
}

/** Ask, and keep asking while the answer names something that is not offered. */
export async function askHarnesses(options: Harness[]): Promise<Harness[]> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        for (;;) {
            const answer = await rl.question(`${promptFor(options)} `);
            try {
                return parseChoice(answer, options);
            } catch (error) {
                // A typo should cost a retry, not the whole install.
                console.error(error instanceof Error ? error.message : String(error));
            }
        }
    } finally {
        rl.close();
    }
}
