/**
 * Writing craftpath's files into a project without trampling the user's edits.
 *
 * `.craftpath/manifest.json` records the hash of every file craftpath wrote.
 * On a re-run a file that still has that hash is craftpath's to replace; one
 * that does not was edited, so it is kept and the new version is written
 * beside it as `<file>.new` for the user to merge.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const MANIFEST = ".craftpath/manifest.json";

export type Outcome = "wrote" | "updated" | "unchanged" | "kept";

const sha = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

export class Installer {
    private constructor(
        private readonly root: string,
        private readonly manifest: Record<string, string>,
    ) {}

    static async open(root: string): Promise<Installer> {
        const file = Bun.file(join(root, MANIFEST));
        let files: Record<string, string> = {};
        if (await file.exists()) {
            try {
                files = ((await file.json()) as { files?: Record<string, string> }).files ?? {};
            } catch {
                // An unreadable manifest only costs a .new file per edited file.
            }
        }
        return new Installer(root, files);
    }

    async write(path: string, text: string): Promise<Outcome> {
        const target = join(this.root, path);
        const file = Bun.file(target);
        if (!(await file.exists())) {
            await put(target, text);
            this.manifest[path] = sha(text);
            return "wrote";
        }
        const current = await file.text();
        if (current === text) {
            this.manifest[path] = sha(text);
            return "unchanged";
        }
        if (this.manifest[path] === sha(current)) {
            await put(target, text);
            this.manifest[path] = sha(text);
            return "updated";
        }
        await put(`${target}.new`, text);
        return "kept";
    }

    async save(version: string): Promise<void> {
        const files = Object.fromEntries(
            Object.entries(this.manifest).sort(([a], [b]) => a.localeCompare(b)),
        );
        await put(join(this.root, MANIFEST), `${JSON.stringify({ version, files }, null, 2)}\n`);
    }
}

async function put(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, text);
}
