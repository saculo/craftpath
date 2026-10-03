/**
 * `.craftpath/manifest.json` -- what craftpath wrote into a project, so that
 * `update` can tell a file the project edited from one it never touched.
 *
 * Kept apart from config.toml so that recording a file never changes
 * `configHash`, and with it every piece of evidence (M1).
 */
import { join } from "node:path";

export const MANIFEST_PATH = ".craftpath/manifest.json";

export interface ManifestEntry {
    /** sha256 of the exact bytes written (M4). */
    sha256: string;
    /** The craftpath version that wrote them. */
    version: string;
    /**
     * sha256 of a release's version the project chose not to take (M6). That
     * version is not offered again; a later release that changes the file is.
     */
    declined?: string;
}

/** Asks one question at a terminal and returns the answer as typed. */
export type Ask = (question: string) => Promise<string>;

export type Manifest = Record<string, ManifestEntry>;

export function sha256(bytes: string | Uint8Array): string {
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function readManifest(root: string): Promise<Manifest | null> {
    const file = Bun.file(join(root, MANIFEST_PATH));
    if (!(await file.exists())) return null;
    return ((await file.json()) as { files: Manifest }).files;
}

/** Writes the manifest, sorted by path so a diff shows only what changed. */
export async function writeManifest(root: string, files: Manifest): Promise<void> {
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    await Bun.write(join(root, MANIFEST_PATH), `${JSON.stringify({ files: sorted }, null, 2)}\n`);
}

/**
 * Adds an entry for each written path, hashing what is on disk now. Leaves the
 * file untouched when nothing was written, so a re-run changes nothing.
 */
export async function recordWritten(root: string, paths: string[], version: string): Promise<void> {
    if (paths.length === 0) return;
    const files = (await readManifest(root)) ?? {};
    for (const rel of paths) {
        files[rel] = { sha256: sha256(await Bun.file(join(root, rel)).bytes()), version };
    }
    await writeManifest(root, files);
}

/** What one `refresh` did. Conflicts are left for the caller to report. */
export interface Refreshed {
    added: string[];
    refreshed: string[];
    /** Edited here and changed by the release: kept, release set aside as `.new`. */
    conflicts: string[];
}

/**
 * Brings each managed file up to `release` without losing an edit.
 *
 * A file is edited when its bytes differ from the hash recorded when
 * craftpath last wrote it, and changed by the release when the release's
 * bytes differ from that same hash:
 *
 * - missing: written and recorded;
 * - unedited, changed: overwritten and recorded;
 * - edited, unchanged: left alone, there is nothing new to offer;
 * - edited, changed: a conflict. At a terminal (`ask`) the project decides;
 *   without one the file is kept and the release's version is written beside
 *   it as `<file>.new` (M5), with its entry unmoved so the next update sees
 *   the same conflict until someone settles it.
 *
 * A file with no entry -- no manifest yet, or one init kept -- has no record
 * to compare against, so it counts as edited unless it equals the release.
 * A release version the project already declined is not a conflict (M6).
 */
export async function refresh(
    root: string,
    release: Record<string, string>,
    version: string,
    ask: Ask | null = null,
): Promise<Refreshed> {
    const before = (await readManifest(root)) ?? {};
    const files: Manifest = { ...before };
    const done: Refreshed = { added: [], refreshed: [], conflicts: [] };
    const conflicts: { rel: string; text: string; next: string }[] = [];

    for (const [rel, text] of Object.entries(release)) {
        const path = join(root, rel);
        const next = sha256(text);
        const recorded = before[rel]?.sha256;
        const file = Bun.file(path);

        if (!(await file.exists())) {
            await Bun.write(path, text);
            files[rel] = { sha256: next, version };
            done.added.push(rel);
            continue;
        }

        const current = sha256(await file.bytes());
        if (current === next) {
            // Already the release's bytes, however they got there.
            if (recorded !== next) files[rel] = { sha256: next, version };
        } else if (current === recorded) {
            await Bun.write(path, text);
            files[rel] = { sha256: next, version };
            done.refreshed.push(rel);
        } else if (next !== recorded && next !== before[rel]?.declined) {
            conflicts.push({ rel, text, next });
        }
    }

    // Settled one at a time, after every unconflicted file is written, so a
    // question never stands between the project and the rest of the update.
    // `K` and `T` answer this conflict and every one after it.
    let all: "k" | "t" | null = null;
    for (const { rel, text, next } of conflicts) {
        const path = join(root, rel);
        let choice: "k" | "t" | null = all;
        if (choice === null && ask !== null) {
            const answer = await settle(ask, path, rel, text, version);
            choice = answer === "K" || answer === "k" ? "k" : "t";
            if (answer === "K" || answer === "T") all = choice;
        }

        if (choice === null) {
            await Bun.write(`${path}.new`, text);
            done.conflicts.push(rel);
            continue;
        }
        if (choice === "t") {
            await Bun.write(path, text);
            files[rel] = { sha256: next, version };
        } else {
            // With no entry, the release's hash stands as the record: the
            // project's bytes are not craftpath's, and recording them as such
            // would let the next release overwrite them silently.
            files[rel] = {
                sha256: files[rel]?.sha256 ?? next,
                version: files[rel]?.version ?? version,
                declined: next,
            };
        }
        await Bun.file(`${path}.new`)
            .delete()
            .catch(() => {});
    }

    if (JSON.stringify(files) !== JSON.stringify(before)) await writeManifest(root, files);
    return done;
}

const ANSWERS = ["k", "t", "K", "T"] as const;
type Answer = (typeof ANSWERS)[number];

/** Asks about one conflict until the answer is a decision; `d` shows the diff first. */
async function settle(
    ask: Ask,
    path: string,
    rel: string,
    text: string,
    version: string,
): Promise<Answer> {
    const question =
        `${rel} was edited locally, and craftpath ${version} changes it.\n` +
        "  [d] show diff   [k] keep mine   [t] take new version   [K] keep all   [T] take all ";
    for (;;) {
        const answer = (await ask(question)).trim();
        if ((ANSWERS as readonly string[]).includes(answer)) return answer as Answer;
        if (answer === "d") {
            const diff =
                await Bun.$`diff -u --label ${rel} --label ${`${rel} (craftpath ${version})`} ${path} - < ${new Response(text)}`
                    .nothrow()
                    .quiet();
            console.log(diff.stdout.toString());
        }
    }
}
