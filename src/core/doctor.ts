/**
 * `craftpath doctor` -- verification health.
 *
 * Reports rather than gates (§8). Legacy repos with weak tests are exactly
 * where explicit verification discipline pays off, so refusing to operate on an
 * imperfect repo is wrong. Every health state exits 0; a doctor that fails the
 * build is a doctor people stop running.
 */
import { join } from "node:path";
import type { CommandSpec } from "../schema";
import { CONFIG_PATH, isConfigured, loadConfig } from "./config";
import { installCommand } from "./install";

/** §8: "flags any command over 5 minutes -- a slow gate is a gate that gets skipped." */
export const SLOW_MS = 5 * 60 * 1000;

export type CommandStatus = "PASS" | "FAIL" | "MISSING" | "SLOW";
export type Health = "healthy" | "degraded" | "unusable";

export interface Outcome {
    exit: number;
    ms: number;
    /** Killed at the threshold rather than finished. Reads as SLOW, not FAIL. */
    timedOut?: boolean;
}

/**
 * How one command's result reads.
 *
 * Pure, so the SLOW branch is testable without waiting five minutes for it.
 */
export function classify(spec: CommandSpec, outcome: Outcome | null): CommandStatus {
    if (!isConfigured(spec) || outcome === null) return "MISSING";
    // A killed command did not fail, it never answered. SLOW is the honest
    // reading, and it is what §8 says a gate this slow has already become.
    if (outcome.timedOut) return "SLOW";
    if (outcome.exit !== 0) return "FAIL";
    return outcome.ms > SLOW_MS ? "SLOW" : "PASS";
}

export function healthOf(statuses: CommandStatus[]): Health {
    if (statuses.length === 0 || statuses.every((s) => s === "MISSING")) return "unusable";
    return statuses.every((s) => s === "PASS") ? "healthy" : "degraded";
}

/**
 * Whether the guards `init` wired can actually run.
 *
 * Claude Code hooks fail open (D24), so an unresolvable hook command does not
 * error -- it silently stops protecting `.craftpath/state/` while
 * settings.json still claims it is wired. That is invisible until someone
 * checks, which is what this is for.
 *
 * `resolve` is injectable so the branch is testable without mutating PATH.
 */
export type Guards = "active" | "unresolvable" | "unwired";

/** `... craftpath[.ts] hook <name>` -- craftpath's own guard, however spelled. */
const CRAFTPATH_HOOK = /(?:^|[\s/])craftpath(?:\.ts)?\s+hook\s+[\w-]+\s*$/;

/**
 * Three states, because they have three different remedies.
 *
 * `unwired` used to read as healthy: an empty list returned true, on the
 * reasoning "nothing wired, nothing to break". But a project whose
 * .claude/settings.json was deleted or never created has no protection at all,
 * and reporting the worst state exactly like the best one is the opposite of
 * this command's job.
 */
export function guardsState(
    hookCommands: string[],
    resolve: (bin: string) => string | null = (bin) => Bun.which(bin),
): Guards {
    const guards = hookCommands.filter((command) => CRAFTPATH_HOOK.test(command));
    if (guards.length === 0) return "unwired";
    return guards.every((command) => resolve(command.split(/\s+/)[0]!) !== null)
        ? "active"
        : "unresolvable";
}

/**
 * The command strings of every hook registered for one event.
 *
 * Per event, not flattened across all of them: the Stop hook is not a guard, so
 * a project with only `craftpath hook validate` wired read as "the guards are
 * present but broken" when the truth is that no guard is wired at all.
 */
async function wiredHookCommands(root: string, event: string): Promise<string[]> {
    const file = Bun.file(join(root, ".claude/settings.json"));
    if (!(await file.exists())) return [];
    try {
        const settings = (await file.json()) as {
            hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
        };
        return (settings.hooks?.[event] ?? [])
            .flatMap((entry) => entry.hooks ?? [])
            .map((h) => h.command)
            .filter((c): c is string => typeof c === "string");
    } catch {
        return [];
    }
}

/**
 * Runs one command, in the project, with a deadline.
 *
 * `Bun.spawn` rather than `Bun.$`, for the one thing the shell helper cannot
 * do: a timeout. Without it §8's promise to "flag any command over 5 minutes"
 * required the command to finish, so a hung suite hung doctor -- the one tool
 * whose job is reporting honestly on the harness.
 *
 * `cwd: root` is the other half. doctor(root) took a root and ignored it here,
 * the only place that touches the filesystem.
 */
export async function run(
    spec: CommandSpec,
    root: string,
    timeoutMs: number = SLOW_MS,
): Promise<Outcome | null> {
    if (!isConfigured(spec)) return null;
    const started = Bun.nanoseconds();
    const proc = Bun.spawn(["sh", "-c", spec.run], {
        cwd: root,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
    });
    await proc.exited;
    return {
        // Killed by us leaves exitCode null; the flag is what classify reads.
        exit: proc.exitCode ?? 1,
        ms: (Bun.nanoseconds() - started) / 1e6,
        timedOut: proc.killed && proc.exitCode === null,
    };
}

function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

export async function doctor(root: string, timeoutMs: number = SLOW_MS): Promise<void> {
    const config = await loadConfig(root);
    const names = Object.keys(config.commands).sort();

    // Sequential, not parallel: two suites racing for the same database is a
    // flakiness source, and a false FLAKY reading is worse than a slow report.
    const rows: { name: string; status: CommandStatus; ms: number | null }[] = [];
    for (const name of names) {
        const spec = config.commands[name]!;
        const outcome = await run(spec, root, timeoutMs);
        rows.push({ name, status: classify(spec, outcome), ms: outcome?.ms ?? null });
    }

    const health = healthOf(rows.map((r) => r.status));
    console.log(`Verification health: ${health.toUpperCase()}`);
    console.log("");

    if (rows.length === 0) {
        console.log(`  no commands defined in ${CONFIG_PATH}`);
    }
    for (const row of rows) {
        const timing = row.ms === null ? "" : seconds(row.ms).padStart(8);
        console.log(`  ${row.name.padEnd(24)} ${row.status.padEnd(9)}${timing}`);
    }

    console.log("");
    const unverifiable = rows.filter((r) => r.status !== "PASS").map((r) => r.name);
    if (unverifiable.length > 0) {
        console.log(
            `Work may continue. Criteria verified by ${unverifiable.join(", ")} ` +
                `cannot reach fully verified status without a manual acknowledgement.`,
        );
    }

    // Reported, never fatal: every health state exits 0 (§8).
    const guards = guardsState(await wiredHookCommands(root, "PreToolUse"));
    if (guards === "unresolvable") {
        console.log("");
        console.log(
            "Guards are NOT ACTIVE. .claude/settings.json wires hooks that cannot be\n" +
                "resolved, and hooks fail open, so writes to .craftpath/state/ are not\n" +
                `blocked. Fix with:  ${installCommand()}`,
        );
    }
    if (guards === "unwired") {
        console.log("");
        console.log(
            "Guards are NOT WIRED. No PreToolUse hook in .claude/settings.json runs\n" +
                "craftpath, so nothing refuses a direct write to .craftpath/state/ and the\n" +
                "trust boundary is not enforced in this project at all.\n" +
                "Fix with:  craftpath init",
        );
    }
}
