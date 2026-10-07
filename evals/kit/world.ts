/**
 * The world: everything a run can change, read into one value.
 *
 * `files` is every file outside .git by content hash, so two snapshots diff
 * to exactly what a command touched. `work` is the open work items as
 * craftpath's state records them, so a flow can ask about status without
 * parsing CLI output.
 */
import { join } from "node:path";

export interface World {
    files: Record<string, string>;
    work: Record<string, { tasks: Record<string, string> }>;
    git: { branch: string; head: string };
}

export interface Diff {
    created: string[];
    changed: string[];
    removed: string[];
}

export async function world(root: string): Promise<World> {
    const files: Record<string, string> = {};
    for await (const rel of new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })) {
        if (rel === ".git" || rel.startsWith(".git/")) continue;
        files[rel] = new Bun.CryptoHasher("sha256")
            .update(await Bun.file(join(root, rel)).arrayBuffer())
            .digest("hex");
    }

    const work: World["work"] = {};
    const open = Object.keys(files)
        .map((f) => /^\.craftpath\/work\/([^/]+)\//.exec(f)?.[1])
        .filter((id): id is string => id !== undefined);
    for (const id of [...new Set(open)].sort()) {
        const tasks: Record<string, string> = {};
        for (const f of Object.keys(files).sort()) {
            const match = new RegExp(`^\\.craftpath/state/${id}/([TD]\\d{3})\\.json$`).exec(f);
            if (match)
                tasks[match[1]!] = (
                    (await Bun.file(join(root, f)).json()) as { status: string }
                ).status;
        }
        work[id] = { tasks };
    }

    const read = async (...args: string[]) =>
        (await Bun.$`git -C ${root} ${args}`.quiet().nothrow()).stdout.toString().trim();
    return {
        files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
        work,
        git: {
            branch: await read("branch", "--show-current"),
            head: await read("rev-parse", "HEAD"),
        },
    };
}

export function diff(before: World, after: World): Diff {
    const created: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];
    for (const [file, hash] of Object.entries(after.files)) {
        if (!(file in before.files)) created.push(file);
        else if (before.files[file] !== hash) changed.push(file);
    }
    for (const file of Object.keys(before.files)) if (!(file in after.files)) removed.push(file);
    return { created: created.sort(), changed: changed.sort(), removed: removed.sort() };
}
