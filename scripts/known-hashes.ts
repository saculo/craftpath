/**
 * Regenerates src/core/known-hashes.json: the sha256 of every managed file as
 * each released craftpath's `init` wrote it, plus this checkout's (M7).
 *
 *   bun scripts/known-hashes.ts
 *
 * Each `v*` tag is checked out into a scratch worktree and its own `init` is
 * run for every harness it supports, so the hashes are of the bytes a project
 * really received -- not of a re-rendering that a later change to render()
 * would silently alter. Not run by the suite: it needs git, the tags and a
 * network-free `bun install` per tag.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const REPO = join(import.meta.dir, "..");
const OUT = join(REPO, "src/core/known-hashes.json");

/** Where init puts managed files (M2), for every harness any release had. */
const MANAGED_DIRS = [".claude/skills", ".claude/rules", ".pi/skills", ".craftpath/templates"];

function sha256(bytes: Uint8Array): string {
    return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

/** Runs `cli init` in a fresh project and hashes every managed file it wrote. */
async function hashesOf(cli: string): Promise<Record<string, string>> {
    const project = await mkdtemp(join(tmpdir(), "craftpath-known-"));
    try {
        await $`git init -q`.cwd(project);
        await $`${process.execPath} ${cli} init --harness claude-code,pi < /dev/null`
            .cwd(project)
            .quiet();
        const files: Record<string, string> = {};
        for (const dir of MANAGED_DIRS) {
            const entries = await readdir(join(project, dir), {
                recursive: true,
                withFileTypes: true,
            }).catch(() => []);
            for (const d of entries) {
                if (!d.isFile() || d.name === ".gitkeep") continue;
                const path = join(d.parentPath, d.name);
                files[path.slice(project.length + 1)] = sha256(await Bun.file(path).bytes());
            }
        }
        return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    } finally {
        await rm(project, { recursive: true, force: true });
    }
}

const releases: Record<string, Record<string, string>> = {};

const tags = (await $`git tag -l ${"v*"}`.cwd(REPO).text()).split("\n").filter((t) => t !== "");
for (const tag of tags.sort((a, b) => Bun.semver.order(a.slice(1), b.slice(1)))) {
    const tree = await mkdtemp(join(tmpdir(), `craftpath-${tag}-`));
    try {
        await $`git worktree add -q --detach ${tree} ${tag}`.cwd(REPO).quiet();
        await $`${process.execPath} install --frozen-lockfile`.cwd(tree).quiet();
        releases[tag.slice(1)] = await hashesOf(join(tree, "bin/craftpath.ts"));
        console.log(`${tag}: ${Object.keys(releases[tag.slice(1)]!).length} files`);
    } finally {
        await $`git worktree remove --force ${tree}`.cwd(REPO).quiet().nothrow();
    }
}

// This checkout, so a change to a managed file is known before it is released
// (A3); after the release its tag records the same bytes again.
releases.unreleased = await hashesOf(join(REPO, "bin/craftpath.ts"));
console.log(`unreleased: ${Object.keys(releases.unreleased).length} files`);

await Bun.write(OUT, `${JSON.stringify({ releases }, null, 2)}\n`);
