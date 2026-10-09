/**
 * The commands a project declares, read by `init` to fill config.toml.
 *
 * D21 narrowed: detect from a declaration, never from a smell. `bun run test`
 * written because package.json declares a `test` script is not a guess; `npm
 * test` written because a directory looked JavaScript-ish is. And when two
 * ecosystems both declare one, which of them holds the project's tests is
 * exactly the guess this refuses to make, so nothing is filled.
 *
 * Only reads files. Whether the command actually works is for `doctor` and the
 * first task completed to find out.
 */
import { join } from "node:path";

export interface Detected {
    test?: string;
}

type Probe = (root: string) => Promise<Detected | null>;

/** One probe per ecosystem. Null means no declaration, not an empty one. */
const PROBES: Probe[] = [
    async (root) => {
        const scripts = (await json(join(root, "package.json")))?.scripts;
        if (typeof scripts !== "object" || scripts === null) return null;
        return "test" in scripts ? { test: "bun run test" } : null;
    },
    async (root) => ((await exists(root, "gradlew")) ? { test: "./gradlew test" } : null),
    async (root) => ((await exists(root, "Cargo.toml")) ? { test: "cargo test" } : null),
    async (root) => ((await exists(root, "go.mod")) ? { test: "go test ./..." } : null),
    async (root) => {
        const file = Bun.file(join(root, "pyproject.toml"));
        if (!(await file.exists())) return null;
        try {
            const tool = (Bun.TOML.parse(await file.text()) as { tool?: object }).tool;
            return tool !== undefined && "pytest" in tool ? { test: "pytest" } : null;
        } catch {
            return null;
        }
    },
];

export async function detectCommands(root: string): Promise<Detected> {
    const found = (await Promise.all(PROBES.map((probe) => probe(root)))).filter(
        (d): d is Detected => d !== null,
    );
    return found.length === 1 ? found[0]! : {};
}

async function exists(root: string, name: string): Promise<boolean> {
    return await Bun.file(join(root, name)).exists();
}

/** A file that does not parse declares nothing. */
async function json(path: string): Promise<Record<string, unknown> | null> {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    try {
        return (await file.json()) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * The branch work is merged into, as the repository says, or null outside git.
 *
 * The remote's default branch first, which is what pull requests target; then
 * main or master when only one of them exists; then whatever is checked out,
 * which in a fresh repository is the only branch there is.
 */
export async function detectBaseBranch(root: string): Promise<string | null> {
    const git = (...args: string[]) => Bun.$`git -C ${root} ${args}`.quiet().nothrow();
    if ((await git("rev-parse", "--git-dir")).exitCode !== 0) return null;

    const remote = await git("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
    if (remote.exitCode === 0)
        return remote
            .text()
            .trim()
            .replace(/^origin\//, "");

    const local = ["main", "master"];
    const present: string[] = [];
    for (const branch of local) {
        if (
            (await git("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`)).exitCode === 0
        ) {
            present.push(branch);
        }
    }
    if (present.length === 1) return present[0]!;

    const current = (await git("branch", "--show-current")).text().trim();
    return current === "" ? null : current;
}
