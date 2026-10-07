/**
 * craftpath as a subprocess, exactly as an agent or a person runs it.
 *
 * In-process calls skip the argument parser, the exit-code mapping and
 * stdout; the evals are about the whole thing. Harness root variables from the
 * environment running the evals are stripped, so a fixture is never resolved
 * against the checkout that launched it.
 */
const BIN = new URL("../../bin/craftpath.ts", import.meta.url).pathname;
const HARNESS_ROOTS = ["CRAFTPATH_PROJECT_DIR", "CLAUDE_PROJECT_DIR", "PI_PROJECT_DIR"];

export interface Run {
    exit: number;
    stdout: string;
    stderr: string;
}

/** `work new "Avatar upload"` -> ["work", "new", "Avatar upload"]. Quotes group; nothing else is shell. */
export function argv(line: string): string[] {
    const args: string[] = [];
    for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
        args.push(match[1] ?? match[2] ?? match[3]!);
    }
    return args;
}

export async function cli(
    root: string,
    args: string | string[],
    options: { stdin?: string; env?: Record<string, string> } = {},
): Promise<Run> {
    const env: Record<string, string | undefined> = { ...process.env, ...options.env };
    for (const name of HARNESS_ROOTS) if (!(name in (options.env ?? {}))) delete env[name];
    const p = Bun.spawn(
        [process.execPath, BIN, ...(typeof args === "string" ? argv(args) : args)],
        {
            cwd: root,
            env,
            stdin: new Blob([options.stdin ?? ""]),
            stdout: "pipe",
            stderr: "pipe",
        },
    );
    const [stdout, stderr] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
    ]);
    return { exit: await p.exited, stdout, stderr };
}
