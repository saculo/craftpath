/**
 * `craftpath update` -- rewrite what craftpath generates, add what is new,
 * then record the running version in the stamp.
 *
 * The harnesses are chosen by the caller: the CLI targets every harness the
 * project is set up for, never a default.
 */
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { Harness } from "../harness/index";
import { PreconditionError } from "../transitions";
import { CONFIG_PATH } from "./config";
import { managedFiles, writeCommands } from "./init";
import { type Ask, refresh } from "./manifest";
import { MIGRATIONS, type Migration, pending } from "./migrations";
import { restamp, stampedVersion } from "./stamp";

export async function update(
    root: string,
    harnesses: Harness[],
    version: string = pkg.version,
    migrations: Migration[] = MIGRATIONS,
    release: Record<string, string> = managedFiles(harnesses),
    ask: Ask | null = null,
): Promise<void> {
    const path = join(root, CONFIG_PATH);
    const file = Bun.file(path);
    // A project whose config was deleted is not one to recreate it for: init
    // does that, with detection. The refresh still runs.
    const config = (await file.exists()) ? await file.text() : null;

    // Before anything is written (V5): an older CLI would put its older
    // templates over a project a newer one set up.
    const stamped = config === null ? null : stampedVersion(config);
    if (stamped !== null && Bun.semver.order(stamped, version) > 0) {
        throw new PreconditionError(
            `This project was set up by craftpath ${stamped}, and this is craftpath ${version}. ` +
                "Upgrade craftpath rather than updating the project with an older one; nothing was changed.",
        );
    }

    for (const harness of harnesses) {
        const n = await writeCommands(root, harness);
        console.log(`rewrote   ${harness.commandsDir}/ (${n} commands)`);
        // Generated, so it is replaced rather than kept: a stale extension
        // speaks an older protocol while looking installed.
        const wiring = await harness.wireGuards(root);
        if (wiring.refused !== null) {
            console.error(`!! ${harness.label}: ${wiring.refused}; guards not wired`);
        } else if (wiring.added > 0) {
            console.log(`wired     ${harness.label} (${wiring.added})`);
        }
    }

    // Skills, rules and templates are the project's to edit, so only what it
    // did not edit is replaced; the rest is set aside below.
    const managed = await refresh(root, release, version, ask);
    for (const rel of managed.added) console.log(`added     ${rel}`);
    for (const rel of managed.refreshed) console.log(`refreshed ${rel}`);

    // Between the refresh and the stamp: a failure leaves the stamp where it
    // was, so the next update retries from the migration that failed.
    for (const migration of pending(migrations, stamped, version)) {
        console.log(`migrating ${migration.since}: ${migration.describe}`);
        try {
            await migration.apply(root);
        } catch (cause) {
            throw new PreconditionError(
                `The ${migration.since} migration failed: ${(cause as Error).message}\n` +
                    `Nothing after it ran, and the stamp still reads ${stamped ?? "nothing"}. ` +
                    "Fix the cause and run `craftpath update` again.",
            );
        }
    }

    if (config !== null) await restampConfig(path, config, version);

    // Last, so a conflict never stops the rest of the update (M5). Exit 2
    // rather than 0: an agent running this in its shell has to notice.
    if (managed.conflicts.length > 0) {
        throw new PreconditionError(
            `Edited here and changed by craftpath ${version}, so kept as they are:\n` +
                managed.conflicts
                    .map((rel) => `  ${rel}  (release's version: ${rel}.new)\n`)
                    .join("") +
                "Run `craftpath update` at a terminal to choose for each, or merge what you want\n" +
                "from each .new file into the original and delete the .new file.",
        );
    }
}

async function restampConfig(path: string, config: string, version: string): Promise<void> {
    const next = restamp(config, version);
    if (next === null) {
        console.error(
            `!! ${CONFIG_PATH} has a [craftpath] table in a shape craftpath did not write, ` +
                `so the stamp was not moved to ${version}. Replace it with:\n` +
                `   [craftpath]\n   version = "${version}"`,
        );
    } else if (next !== config) {
        await Bun.write(path, next);
        console.log(`stamped   ${CONFIG_PATH} (${version})`);
    }
}
