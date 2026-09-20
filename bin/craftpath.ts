#!/usr/bin/env bun
/**
 * Craftpath CLI.
 *
 * Routing, flag parsing and help text are stricli's; this file is the entry
 * point and the exit-code boundary.
 *
 * Every import below is dynamic, and that is load-bearing rather than tidy.
 * The guards run on every Edit, Write and Bash tool call, so a static import of
 * a command -- and through it Zod, or stricli's route map -- would tax every
 * tool use in the session. `hook` is dispatched before stricli for the same
 * reason; see src/cli/hook.ts.
 */
const argv = process.argv.slice(2);

if (argv[0] === "hook") {
    await (await import("../src/cli/hook")).hook(argv.slice(1));
}

const { Exit } = await import("../src/exit");

// Bare `craftpath` is someone asking what this is, not a usage error.
if (argv.length === 0) {
    const { USAGE } = await import("../src/cli/app");
    console.error(USAGE);
    process.exit(Exit.OK);
}

const { run } = await import("@stricli/core");
const { app, exitCodeFor } = await import("../src/cli/app");
const { buildContext } = await import("../src/cli/context");

const context = buildContext();
await run(app, argv, context);
process.exit(exitCodeFor(context.process.exitCode));
