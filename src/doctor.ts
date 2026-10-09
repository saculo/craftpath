/**
 * `craftpath doctor` -- is this project set up for the flow to work?
 *
 * Each check prints `ok` or `FAIL` with what to do; exit 1 when any failed.
 */
import { join } from "node:path";

const GUARD = ".craftpath/scripts/guard.py";
const TIMEOUT_MS = 5 * 60 * 1000;

interface Config {
    git?: { base_branch?: string };
    modules?: Record<string, { path?: string; test?: string }>;
}

export async function doctor(root: string): Promise<number> {
    const results: [Status, string][] = [];
    const check = (ok: Status, line: string) => results.push([ok, line]);

    check(...(await python()));

    const config = await readConfig(root);
    if (config === null) {
        check(false, ".craftpath/config.toml is missing or invalid -- run `craftpath init`");
        return report(results);
    }
    const base = config.git?.base_branch ?? "main";
    const git = (...args: string[]) => Bun.$`git -C ${root} ${args}`.quiet().nothrow();
    if ((await git("rev-parse", "--verify", "--quiet", `${base}^{commit}`)).exitCode !== 0) {
        check(
            false,
            `base branch "${base}" does not exist -- set base_branch in .craftpath/config.toml`,
        );
    } else if ((await git("cat-file", "-e", `${base}:${GUARD}`)).exitCode !== 0) {
        check(
            false,
            `craftpath's files are not committed on ${base} -- work items are created from it`,
        );
    } else {
        check(true, `craftpath's files are committed on ${base}`);
    }

    if (await exists(join(root, ".claude"))) check(...(await claudeGuard(root)));
    if (await exists(join(root, ".pi"))) {
        for (const result of await piChecks(root)) check(...result);
    }

    for (const [name, module] of Object.entries(config.modules ?? {})) {
        check(...(await moduleTest(root, name, module)));
    }
    check(...(await gh(root)));
    return report(results);
}

/** A check passes, fails, or warns about something only one step needs. */
type Status = boolean | "warn";

function report(results: [Status, string][]): number {
    const label = (ok: Status) => (ok === "warn" ? "warn" : ok ? "ok  " : "FAIL");
    for (const [ok, line] of results) console.log(`${label(ok)}  ${line}`);
    return results.every(([ok]) => ok !== false) ? 0 : 1;
}

/** Only /craftpath-pr needs gh, so a missing or logged-out gh is a warning. */
async function gh(root: string): Promise<[Status, string]> {
    const bin = Bun.which("gh");
    if (bin === null) return ["warn", "gh is not installed -- /craftpath-pr needs it"];
    const p = Bun.spawn([bin, "auth", "status"], { cwd: root, stdout: "ignore", stderr: "ignore" });
    return (await p.exited) === 0
        ? [true, "gh is logged in"]
        : ["warn", "gh is not logged in -- /craftpath-pr needs it: run `gh auth login`"];
}

async function python(): Promise<[boolean, string]> {
    const p = Bun.spawn(["python3", "--version"], { stdout: "pipe", stderr: "pipe" });
    const text =
        `${await new Response(p.stdout).text()}${await new Response(p.stderr).text()}`.trim();
    if ((await p.exited) !== 0)
        return [false, "python3 not found -- craftpath's scripts need Python 3.11+"];
    const [, major, minor] = /Python (\d+)\.(\d+)/.exec(text) ?? [];
    const version = `${major}.${minor}`;
    const ok = Number(major) > 3 || (Number(major) === 3 && Number(minor) >= 11);
    return [
        ok,
        ok ? `python3 ${version}` : `python3 ${version} -- craftpath's scripts need 3.11 or newer`,
    ];
}

async function readConfig(root: string): Promise<Config | null> {
    try {
        return Bun.TOML.parse(
            await Bun.file(join(root, ".craftpath/config.toml")).text(),
        ) as Config;
    } catch {
        return null;
    }
}

/** What the flow needs on pi: the hooks extension, the guard in it, and subagents. */
async function piChecks(root: string): Promise<[boolean, string][]> {
    const results: [boolean, string][] = [];
    const extension = await Bun.file(join(root, ".pi/extensions/claude-hooks.ts")).exists();
    results.push(
        extension
            ? [true, "pi hooks extension installed"]
            : [false, "pi hooks extension missing -- run `craftpath init --harness pi`"],
    );
    let settings: { hooks?: { PreToolUse?: unknown }; packages?: unknown[] } = {};
    try {
        settings = JSON.parse(await Bun.file(join(root, ".pi/settings.json")).text());
    } catch {
        // missing or unreadable: nothing wired, nothing installed
    }
    const wired = JSON.stringify(settings.hooks?.PreToolUse ?? []).includes(GUARD);
    results.push(
        wired
            ? [true, "pi guard wired (PreToolUse)"]
            : [
                  false,
                  "pi guard not wired in .pi/settings.json -- run `craftpath init --harness pi`",
              ],
    );
    const subagents = (settings.packages ?? []).some((p) =>
        JSON.stringify(p).includes("pi-subagents-lite"),
    );
    results.push(
        subagents
            ? [true, "pi-subagents-lite installed"]
            : [
                  false,
                  "pi-subagents-lite is not installed, so steps cannot run as subagents -- " +
                      "run `pi install -l npm:pi-subagents-lite`",
              ],
    );
    return results;
}

async function claudeGuard(root: string): Promise<[boolean, string]> {
    try {
        const settings = JSON.parse(await Bun.file(join(root, ".claude/settings.json")).text());
        const wired = JSON.stringify(settings.hooks?.PreToolUse ?? []).includes(GUARD);
        if (wired) return [true, "Claude Code guard wired (PreToolUse)"];
    } catch {
        // missing or unreadable: not wired
    }
    return [false, "Claude Code guard not wired in .claude/settings.json -- run `craftpath init`"];
}

async function moduleTest(
    root: string,
    name: string,
    module: { path?: string; test?: string },
): Promise<[boolean, string]> {
    if (!module.test?.trim())
        return [false, `module ${name}: no test command in .craftpath/config.toml`];
    const p = Bun.spawn(["sh", "-c", module.test], {
        cwd: join(root, module.path ?? "./"),
        stdout: "ignore",
        stderr: "ignore",
        timeout: TIMEOUT_MS,
    });
    const exit = await p.exited;
    return exit === 0
        ? [true, `module ${name}: test passes`]
        : [false, `module ${name}: test fails (exit ${exit})`];
}

async function exists(path: string): Promise<boolean> {
    return (await Bun.$`test -e ${path}`.quiet().nothrow()).exitCode === 0;
}
