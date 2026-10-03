/**
 * Which modules a change affects.
 *
 * A module is a directory of the project with its own commands (T620). After
 * implementation, the changed files decide which modules own the change, and
 * `depends_on` widens that to every module built on them: a change to a
 * shared library has to be proven in everything that uses it, not only where
 * the edit landed.
 */
import type { Config } from "../schema";
import { PreconditionError } from "../transitions";

type Modules = Config["modules"];

/** `./apps/web` as git prints paths under it: `apps/web`; the root is "". */
function prefixOf(path: string): string {
    return path === "./" ? "" : path.slice(2);
}

/**
 * The module owning `file`: the one whose directory holds it, the deepest when
 * several do, so a root module owns only what no other module claims.
 */
function ownerOf(modules: Modules, file: string): string | null {
    let owner: string | null = null;
    let depth = -1;
    for (const [name, module] of Object.entries(modules)) {
        const prefix = prefixOf(module.path);
        const holds = prefix === "" || file === prefix || file.startsWith(`${prefix}/`);
        if (holds && prefix.length > depth) {
            owner = name;
            depth = prefix.length;
        }
    }
    return owner;
}

/**
 * The modules owning a changed file plus every module depending on them,
 * transitively, in an order where each module comes after its dependencies.
 * Among modules free to go in either order, declaration order holds.
 *
 * A file no module owns affects nothing; deciding whether that is an error is
 * the caller's business.
 */
export function affectedModules(modules: Modules, changed: string[]): string[] {
    const affected = new Set<string>();
    const reach = (name: string): void => {
        if (affected.has(name)) return;
        affected.add(name);
        for (const [other, module] of Object.entries(modules)) {
            if (module.depends_on.includes(name)) reach(other);
        }
    };
    for (const file of changed) {
        const owner = ownerOf(modules, file.replace(/^\.\//, ""));
        if (owner !== null) reach(owner);
    }

    const ordered: string[] = [];
    const place = (name: string): void => {
        if (ordered.includes(name)) return;
        for (const dep of modules[name]!.depends_on) if (affected.has(dep)) place(dep);
        ordered.push(name);
    };
    for (const name of Object.keys(modules)) if (affected.has(name)) place(name);
    return ordered;
}

/**
 * Every file this branch changed: committed since it left `base`, edited and
 * not committed, and new and not yet tracked. Project-relative, as git prints
 * them.
 *
 * Against the merge-base, not `base` itself, so commits `base` gained after
 * the branch point are not counted as this branch's change.
 */
export async function changedFiles(root: string, base: string): Promise<string[]> {
    const exists = await Bun.$`git -C ${root} rev-parse --verify --quiet ${`${base}^{commit}`}`
        .quiet()
        .nothrow();
    if (exists.exitCode !== 0) {
        throw new PreconditionError(
            `The base branch "${base}" does not exist, so there is nothing to tell this ` +
                "branch's changes apart from. Set `base_branch` under [git] in " +
                ".craftpath/config.toml to the branch work is merged into.",
        );
    }
    const mergeBase = (await Bun.$`git -C ${root} merge-base ${base} HEAD`.quiet().text()).trim();
    const tracked = await Bun.$`git -C ${root} diff --name-only ${mergeBase}`.quiet().text();
    const untracked = await Bun.$`git -C ${root} ls-files --others --exclude-standard`
        .quiet()
        .text();
    const files = `${tracked}\n${untracked}`.split("\n").filter((line) => line !== "");
    return [...new Set(files)];
}
