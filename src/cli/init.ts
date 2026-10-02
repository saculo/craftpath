import { detect } from "../harness/index";
import { chooseHarnesses } from "../harness/select";
import { init as runInit } from "../core/init";
import { update as runUpdate } from "../core/update";
import { UsageError } from "../exit";
import type { Ask } from "../core/manifest";
import type { Context } from "./context";
import { askHarnesses, askLine } from "./prompt";

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
export interface UpdateFlags extends InitFlags {
    keep: boolean;
    take: boolean;
}

export async function update(this: Context, flags: UpdateFlags): Promise<void> {
    // Before anything is read or written: a refusal must leave the project as it was.
    if (flags.keep && flags.take) throw new UsageError("--keep and --take are mutually exclusive");
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

    // A flag answers every conflict at once, as `K` or `T` would. Otherwise at
    // a terminal a conflict is a question; without one, a `.new` file and
    // exit 2, because a prompt nobody can answer hangs an agent's shell.
    const ask: Ask | null = flags.keep
        ? async () => "K"
        : flags.take
          ? async () => "T"
          : process.stdin.isTTY === true
            ? askLine
            : null;
    await runUpdate(root, harnesses, undefined, undefined, undefined, ask);
}
