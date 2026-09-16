/**
 * `craftpath doctor` -- verification health.
 *
 * Reports rather than gates (§8). Legacy repos with weak tests are exactly
 * where explicit verification discipline pays off, so refusing to operate on an
 * imperfect repo is wrong. Every health state exits 0; a doctor that fails the
 * build is a doctor people stop running.
 */
import { join } from "node:path";
import { type CommandSpec } from "../schema";
import { CONFIG_PATH, isConfigured, loadConfig } from "./config";
import { installCommand } from "./install";

/** §8: "flags any command over 5 minutes -- a slow gate is a gate that gets skipped." */
export const SLOW_MS = 5 * 60 * 1000;

export type CommandStatus = "PASS" | "FAIL" | "MISSING" | "SLOW";
export type Health = "healthy" | "degraded" | "unusable";

export interface Outcome {
    exit: number;
    ms: number;
}

/**
 * How one command's result reads.
 *
 * Pure, so the SLOW branch is testable without waiting five minutes for it.
 */
export function classify(spec: CommandSpec, outcome: Outcome | null): CommandStatus {
    if (!isConfigured(spec) || outcome === null) return "MISSING";
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
export function guardsActive(
    hookCommands: string[],
    resolve: (bin: string) => string | null = (bin) => Bun.which(bin),
): boolean {
    if (hookCommands.length === 0) return true; // nothing wired, nothing to break
    return hookCommands.every((command) => resolve(command.split(/\s+/)[0]!) !== null);
}

/** The command strings of every hook registered in .claude/settings.json. */
async function wiredHookCommands(root: string): Promise<string[]> {
    const file = Bun.file(join(root, ".claude/settings.json"));
    if (!(await file.exists())) return [];
    try {
        const settings = (await file.json()) as {
            hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
        };
        return Object.values(settings.hooks ?? {})
            .flat()
            .flatMap((entry) => entry.hooks ?? [])
            .map((h) => h.command)
            .filter((c): c is string => typeof c === "string");
    } catch {
        return [];
    }
}

async function run(spec: CommandSpec): Promise<Outcome | null> {
    if (!isConfigured(spec)) return null;
    const started = Bun.nanoseconds();
    const result = await Bun.$`sh -c ${spec.run}`.quiet().nothrow();
    return { exit: result.exitCode, ms: (Bun.nanoseconds() - started) / 1e6 };
}

function seconds(ms: number): string {
    return `${(ms / 1000).toFixed(1)}s`;
}

export async function doctor(root: string): Promise<void> {
    const config = await loadConfig(root);
    const names = Object.keys(config.commands).sort();

    // Sequential, not parallel: two suites racing for the same database is a
    // flakiness source, and a false FLAKY reading is worse than a slow report.
    const rows: { name: string; status: CommandStatus; ms: number | null }[] = [];
    for (const name of names) {
        const spec = config.commands[name]!;
        const outcome = await run(spec);
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

    if (!guardsActive(await wiredHookCommands(root))) {
        console.log("");
        console.log(
            "Guards are NOT ACTIVE. .claude/settings.json wires hooks that cannot be\n" +
            "resolved, and hooks fail open, so writes to .craftpath/state/ are not\n" +
            `blocked. Fix with:  ${installCommand()}`,
        );
    }
}
