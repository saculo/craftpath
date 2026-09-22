/**
 * Scratch directories for tests, and the cleanup that was missing.
 *
 * Every test file used to call `mkdtemp` and never remove the result. Locally
 * that accumulates: a few hundred inodes per run, silently, until /tmp runs out
 * of them and unrelated commands start failing with "No space left on device"
 * on a filesystem that is 80% free. CI never noticed, because a fresh runner
 * has no history.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/** A fresh scratch directory, remembered so `cleanScratch` can remove it. */
export async function scratch(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}

/**
 * Removes every scratch directory this process created.
 *
 * Registered with `afterAll` in each test file. `splice` empties the list as it
 * reads it, so a second call has nothing to do rather than failing on
 * directories the first call already removed -- `force` covers the rest.
 */
export async function cleanScratch(): Promise<void> {
    const dirs = created.splice(0);
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}
