/**
 * Resolve harness tokens in craftpath's shipped prose.
 *
 * Commands and skills are written once. The sentences that cannot be
 * harness-neutral carry a token, and this resolves them at install time.
 *
 * Tokens rather than a forked document per harness, because the documents are
 * long and mostly identical: a fork means every future edit has to be made
 * twice, and the copy that is missed is the one a project is reading.
 *
 * An unknown token throws. It is written into a project otherwise, where it
 * reads as a literal instruction to the model and nobody finds out until the
 * model follows it.
 */
import type { Harness } from "./index";

const TOKEN = /( *)\{\{([A-Z_]+)(?::([^}]+))?\}\}/g;

/**
 * Indent a multi-line value to sit under the list item it replaces.
 *
 * `2. {{SUBAGENT}}` expands to several lines, and Markdown reads an
 * unindented continuation as a new paragraph that ends the list -- so steps 3
 * to 5 stop looking like steps. The indent is taken from what preceded the
 * token, which is the column the list content already starts at.
 */
function hang(value: string, column: number): string {
    if (column === 0 || !value.includes("\n")) return value;
    return value.split("\n").join(`\n${" ".repeat(column)}`);
}

export function render(text: string, harness: Harness): string {
    let column = 0;
    return text.replaceAll(TOKEN, (match, lead: string, name: string, arg: string | undefined) => {
        // The column the token sits at: the text before it on its line, which
        // for a list item is the marker ("2. ") plus any indent.
        const lineStart = text.lastIndexOf("\n", text.indexOf(match)) + 1;
        column = text.slice(lineStart, text.indexOf(match) + lead.length).length;
        const put = (value: string): string => lead + hang(value, column);
        switch (name) {
            case "SKILLS_DIR":
                return put(harness.skillsDir);
            case "SUBAGENT":
                return put(harness.subagent);
            case "SUBAGENT_NOUN":
                return put(harness.subagentNoun);
            case "RULE": {
                if (arg === undefined) throw new Error(`${match} needs a rule name`);
                return put(harness.ruleLocation(arg));
            }
            case "CMD": {
                if (arg === undefined) throw new Error(`${match} needs a command name`);
                if (!COMMAND_NAMES.includes(arg)) {
                    throw new Error(
                        `${match} names no command; known: ${COMMAND_NAMES.join(", ")}`,
                    );
                }
                return put(harness.invocation(arg));
            }
            default:
                throw new Error(`unknown harness token ${match}`);
        }
    });
}

/**
 * The commands craftpath installs, by file name.
 *
 * Here rather than in `core/init` so `render` can reject a `{{CMD:...}}` that
 * names nothing -- a typo that would otherwise ship as a slash command the
 * model is told to run and that does not exist.
 */
export const COMMAND_NAMES = ["work", "investigate", "pr", "status"];
