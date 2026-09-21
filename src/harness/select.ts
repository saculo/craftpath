/**
 * Which harnesses `init` installs into.
 *
 * Three sources, in a deliberate order: what the operator said, what a person
 * at a terminal answers, and -- only when neither is available -- what the
 * project already looks like.
 */
import { DEFAULT_HARNESS, type Harness, HARNESSES, detect } from "./index";

/** Asks a person to pick. Null when there is nobody to ask. */
export type Ask = ((options: Harness[]) => Promise<Harness[]>) | null;

const known = (): string => Object.keys(HARNESSES).sort().join(", ");

/**
 * Parse `--harness claude-code,pi`.
 *
 * Duplicates collapse: `--harness pi,pi` is one install, and treating it as two
 * would double every count init reports.
 */
export function parseHarnesses(value: string): Harness[] {
    const names = value
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n !== "");
    if (names.length === 0) {
        throw new Error(`--harness needs at least one of: ${known()}`);
    }

    const chosen = new Map<string, Harness>();
    for (const name of names) {
        const harness = HARNESSES[name];
        if (harness === undefined) {
            throw new Error(`unknown harness ${JSON.stringify(name)}; known: ${known()}`);
        }
        chosen.set(harness.id, harness);
    }
    return [...chosen.values()];
}

/**
 * The harnesses to install into.
 *
 * Detection is the LAST resort, not the first. A project can carry `.claude/`
 * for reasons that have nothing to do with craftpath, and re-deriving the
 * target on every `craftpath update` would let an unrelated directory move a
 * project's files. What the operator chose is the answer; detection only keeps
 * an unattended re-run from re-targeting a project that already made a choice.
 */
export async function chooseHarnesses(
    root: string,
    flag: string | undefined,
    ask: Ask,
): Promise<Harness[]> {
    if (flag !== undefined) return parseHarnesses(flag);

    if (ask !== null) {
        const chosen = await ask(Object.values(HARNESSES));
        if (chosen.length === 0) {
            throw new Error(`pick at least one harness: ${known()}`);
        }
        return chosen;
    }

    const detected = await detect(root);
    return detected.length > 0 ? detected : [DEFAULT_HARNESS];
}
