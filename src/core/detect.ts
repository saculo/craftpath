/**
 * The commands a project declares, read by `init` to fill config.toml.
 *
 * D21 narrowed: detect from a declaration, never from a smell. `bun run test`
 * written because package.json declares a `test` script is not a guess; `npm
 * test` written because a directory looked JavaScript-ish is. And when two
 * ecosystems both declare one, which of them holds the project's tests is
 * exactly the guess D21 exists to prevent, so nothing is filled.
 *
 * Only reads files. Whether the command actually works is for `doctor` and the
 * first `task verify` to find out.
 */
import { join } from "node:path";

export interface Detected {
    test?: string;
    lint?: string;
}

type Probe = (root: string) => Promise<Detected | null>;

/** One probe per ecosystem. Null means no declaration, not an empty one. */
const PROBES: Probe[] = [
    async (root) => {
        const scripts = (await json(join(root, "package.json")))?.scripts;
        if (typeof scripts !== "object" || scripts === null) return null;
        const found: Detected = {};
        if ("test" in scripts) found.test = "bun run test";
        if ("lint" in scripts) found.lint = "bun run lint";
        return Object.keys(found).length > 0 ? found : null;
    },
    async (root) => ((await exists(root, "gradlew")) ? { test: "./gradlew test" } : null),
    async (root) =>
        (await exists(root, "Cargo.toml"))
            ? { test: "cargo test", lint: "cargo clippy -- -D warnings" }
            : null,
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
