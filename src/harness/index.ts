/**
 * The harness seam.
 *
 * Everything craftpath actually guarantees -- the work item, the gates, the
 * task graph, the evidence and the checks `validate` runs over it -- is
 * harness-independent, and deliberately so: acceptance is proven by re-reading
 * recorded exit codes in a terminal, not by anything a coding agent does.
 *
 * Four things are not harness-independent, and they all live behind this
 * interface:
 *
 *  1. where skills, rules and commands are installed,
 *  2. how a command is spelled when a human invokes it,
 *  3. how the guards are wired, and how to tell whether they are,
 *  4. what the operator has to do after `init` before any of it runs.
 *
 * A second harness is therefore an added descriptor plus a per-harness command
 * rendering -- not a fork of init, doctor and the workflow document.
 */
import { CLAUDE_CODE } from "./claude-code";

/** What one `wireGuards` call did, or why it could do nothing. */
export interface Wiring {
    /** Hooks added by this call. Zero on a re-run, which is not a failure. */
    added: number;
    /**
     * Why the harness config was left untouched, or null.
     *
     * A string here means the trust boundary is NOT enforced in this project
     * while its config still looks installed, so callers must surface it rather
     * than counting `added: 0` as success.
     */
    refused: string | null;
}

export interface Harness {
    /** Stable id, used as the registry key and as `init --harness <id>`. */
    id: string;
    /** How the harness is named to a human, in warnings and next steps. */
    label: string;

    /** Where a SKILL.md lives, as `<skillsDir>/<name>/SKILL.md`. */
    skillsDir: string;
    /**
     * Where path-scoped rules live, or null when the harness has no such
     * concept and the rule has to travel some other way.
     */
    rulesDir: string | null;
    /** Where generated command files are written. */
    commandsDir: string;
    /**
     * Further directories to create and keep, beyond the three above.
     *
     * For the harness's own conveniences -- a place for a project to put its
     * own hook scripts, say -- which craftpath does not write into but whose
     * absence changes the layout a project sees.
     */
    scaffoldDirs: string[];

    /**
     * The file name a command is written under.
     *
     * Separate from `commandsDir` because namespacing differs: Claude Code
     * takes it from the directory, so `work.md` stays `work.md`; a harness with
     * a flat prompt directory has to carry the namespace in the file name.
     */
    commandFile(name: string): string;
    /** How a human types that command, for docs and next steps. */
    invocation(name: string): string;

    /** Whether this harness is configured in the project at `root`. */
    detect(root: string): Promise<boolean>;

    /** Wire craftpath's guards. Idempotent; never clobbers config it cannot parse. */
    wireGuards(root: string): Promise<Wiring>;
    /**
     * The commands wired to run before a tool call, however spelled.
     *
     * Doctor decides which of them are craftpath's and whether they resolve;
     * this only has to find them, which is the part that is harness-shaped.
     */
    wiredGuardCommands(root: string): Promise<string[]>;

    /** What the operator must still do, printed by `init`. */
    nextSteps(): string[];
}

export const HARNESSES: Record<string, Harness> = {
    [CLAUDE_CODE.id]: CLAUDE_CODE,
};

/**
 * What `init` targets when nothing says otherwise.
 *
 * Claude Code, because every project initialised before the seam existed is one
 * -- a default that re-targeted on detection would silently move an existing
 * project's files on the next `craftpath update`.
 */
export const DEFAULT_HARNESS = CLAUDE_CODE;

export function harnessFor(id: string): Harness {
    const harness = HARNESSES[id];
    if (harness === undefined) {
        throw new Error(
            `unknown harness ${JSON.stringify(id)}; known: ${Object.keys(HARNESSES).join(", ")}`,
        );
    }
    return harness;
}

/**
 * Which harnesses this project is already set up for.
 *
 * Returns every match rather than the first: a repo used from two harnesses is
 * an ordinary case, and picking one would leave the other's skills stale on the
 * next `update` with no warning that it happened.
 */
export async function detect(root: string): Promise<Harness[]> {
    const found: Harness[] = [];
    for (const harness of Object.values(HARNESSES)) {
        if (await harness.detect(root)) found.push(harness);
    }
    return found;
}
