/**
 * Deny Edit/Write/MultiEdit targeting .craftpath/state/**.
 *
 * The exact half of the trust boundary (mechanism M2a). Its Bash counterpart is
 * best-effort -- see guard-bash.ts -- so this is the one that has to be exact,
 * which means matching on the RESOLVED path. A substring test read
 * `.craftpath/work/../state/T1.json` and `.craftpath/./state/T1.json` as
 * ordinary files while both name the same protected one.
 *
 * `node:path` is the only import added to the hook path: a native builtin with
 * no module graph behind it, unlike the ~24ms Zod costs. Nothing here touches
 * the filesystem, so the check stays pure and total.
 */
import { relative, resolve, sep } from "node:path";
import { STATE_MARKER, allow, block, normalize, projectRootFrom, readEvent } from "./io";

const MESSAGE = [
    "Refused: .craftpath/state/ is owned by the Craftpath CLI and cannot be edited directly.",
    "Use the sanctioned commands instead:",
    "  craftpath task start|verify|done <id>",
    '  craftpath amend <id> --reason "<why>"',
    "If the state is genuinely wrong, run: craftpath reconcile --fix",
].join("\n");

/**
 * The marker as a path segment, not a substring.
 *
 * `.craftpath/statement.md` contains `.craftpath/state` and is not state, so
 * the segment must end at a separator or at the end of the path.
 */
const MARKER_RE = /\.craftpath\/state(?:\/|$)/;

/** The project this hook is guarding. Each harness names it differently. */
function projectRoot(): string {
    return projectRootFrom(process.env, process.cwd());
}

/**
 * Whether this path lands inside `.craftpath/state/`.
 *
 * Two tests, deliberately OR-ed. Resolving is the exact one and catches `..`,
 * `.` and absolute paths. The lowercased marker test is the belt: it covers a
 * case-insensitive volume, where `.Craftpath/state/T1.json` opens the same file
 * that `relative()` -- which is case-sensitive string arithmetic -- reads as a
 * different directory; and it keeps the guard no weaker than the substring
 * version when `root` is wrong, which a relative path plus no harness-supplied
 * project directory would otherwise make possible.
 *
 * Still defeated by a symlink pointing into state/. Resolving that needs the
 * filesystem, and a guard that can throw is a guard that fails open.
 *
 * Exported so the rule can be unit-tested directly: the suite's only guard-write
 * case spawns the hook with a plain path, which says nothing about the shapes
 * that matter.
 */
export function insideState(path: string, root: string = projectRoot()): boolean {
    const target = resolve(root, normalize(path));
    const rel = relative(resolve(root, STATE_MARKER), target);
    if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`))) return true;
    return MARKER_RE.test(normalize(path).toLowerCase());
}

/** Every path this tool call would write to. Exported for the same reason. */
export function targets(input: Record<string, unknown>): string[] {
    const out: string[] = [];

    for (const key of ["file_path", "path", "notebook_path"]) {
        const v = input[key];
        if (typeof v === "string") out.push(v);
    }

    // MultiEdit and batch shapes carry a list of per-file edits.
    for (const key of ["edits", "files"]) {
        const entries = input[key];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            if (entry && typeof entry === "object") {
                const e = entry as Record<string, unknown>;
                const v = e.file_path ?? e.path;
                if (typeof v === "string") out.push(v);
            }
        }
    }

    return out;
}

export async function main(): Promise<never> {
    const event = await readEvent();
    for (const path of targets(event.tool_input ?? {})) {
        if (insideState(path)) block(MESSAGE);
    }
    allow();
}
