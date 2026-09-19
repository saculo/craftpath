/**
 * Deny Edit/Write/MultiEdit targeting .craftpath/state/**.
 *
 * The exact half of the trust boundary (mechanism M2a). Path matching is
 * unambiguous, so this guard is airtight for file-editing tools. Its Bash
 * counterpart is not -- see guard-bash.ts.
 */
import { STATE_MARKER, allow, block, normalize, readEvent } from "./io";

const MESSAGE = [
    "Refused: .craftpath/state/ is owned by the Craftpath CLI and cannot be edited directly.",
    "Use the sanctioned commands instead:",
    "  craftpath task start|verify|done <id>",
    '  craftpath amend <id> --reason "<why>"',
    "If the state is genuinely wrong, run: craftpath reconcile --fix",
].join("\n");

/** Every path this tool call would write to. */
function targets(input: Record<string, unknown>): string[] {
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
        if (normalize(path).includes(STATE_MARKER)) block(MESSAGE);
    }
    allow();
}
