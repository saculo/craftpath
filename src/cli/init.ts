import { detect } from "../harness/index";
import { chooseHarnesses } from "../harness/select";
import { init as runInit, installSkills, writeCommands } from "../core/init";
import type { Context } from "./context";
import { askHarnesses } from "./prompt";

export interface InitFlags {
    harness?: string;
}

/**
 * `craftpath init [--harness claude-code,pi]`.
 *
 * With no flag and a terminal, the operator is asked. With no flag and no
 * terminal -- CI, a script, this repo's own suite -- `chooseHarnesses` falls
 * back to what the project already carries, because prompting there hangs and
 * guessing would re-target a project that already made a choice.
 */
export async function init(this: Context, flags: InitFlags): Promise<void> {
    const root = process.cwd();
    const ask = process.stdin.isTTY === true ? askHarnesses : null;
    await runInit(root, await chooseHarnesses(root, flags.harness, ask));
}

/**
 * `craftpath update` -- rewrite what craftpath generates, add what is new.
 *
 * Targets every harness the project is set up for, never a default: an update
 * that silently installed a harness the project never chose would be an
 * install wearing an upgrade's name. A project with none detected is one that
 * has not run `init` yet, and is told so rather than quietly initialised.
 */
export async function update(this: Context, flags: InitFlags): Promise<void> {
    const root = process.cwd();
    const harnesses =
        flags.harness !== undefined
            ? await chooseHarnesses(root, flags.harness, null)
            : await detect(root);

    if (harnesses.length === 0) {
        console.error(
            "No harness detected in this project, so there is nothing to update.\n" +
                "Run `craftpath init` to choose one.",
        );
        return;
    }

    for (const harness of harnesses) {
        const n = await writeCommands(root, harness);
        console.log(`rewrote   ${harness.commandsDir}/ (${n} commands)`);
        // Adds only what is missing: a skill the project edited is its own.
        const added = await installSkills(root, harness);
        console.log(
            `added     ${added.skills} skills, ${added.rules} rules missing from ${harness.label}`,
        );
        // Generated, so it is replaced rather than kept: a stale extension
        // speaks an older protocol while looking installed.
        const wiring = await harness.wireGuards(root);
        if (wiring.refused !== null) {
            console.error(`!! ${harness.label}: ${wiring.refused}; guards not wired`);
        } else if (wiring.added > 0) {
            console.log(`wired     ${harness.label} (${wiring.added})`);
        }
    }
}
