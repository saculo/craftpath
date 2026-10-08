/**
 * The files craftpath ships and `init` copies into a project.
 *
 * Read from disk rather than embedded, so a script is a script and a template
 * is a template -- editable, diffable, and tested as what it is.
 */
import { join } from "node:path";

export const ASSETS = new URL("../assets", import.meta.url).pathname;

/** Every file under `dir` of the assets, as relative path -> text. */
export async function assetFiles(assets: string, dir: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const root = join(assets, dir);
    for await (const rel of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true, dot: true })) {
        files[rel] = await Bun.file(join(root, rel)).text();
    }
    return files;
}
