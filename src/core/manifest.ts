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
}

export type Manifest = Record<string, ManifestEntry>;

export function sha256(bytes: string | Uint8Array): string {
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export async function readManifest(root: string): Promise<Manifest | null> {
    const file = Bun.file(join(root, MANIFEST_PATH));
    if (!(await file.exists())) return null;
    return ((await file.json()) as { files: Manifest }).files;
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
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    await Bun.write(join(root, MANIFEST_PATH), `${JSON.stringify({ files: sorted }, null, 2)}\n`);
}
