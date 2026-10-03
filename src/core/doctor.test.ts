import { afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_CODE } from "../harness/claude-code";
import { cleanScratch, scratch } from "../../test/scratch";
import { doctor } from "./doctor";

// Scratch directories accumulate in /tmp forever otherwise; see test/scratch.ts.
afterAll(cleanScratch);

const TAIL =
    '\n[gates]\nrequirement = "auto"\nplan = "auto"\nresult = "manual"\n\n' +
    '[git]\nwork_branch_prefix = "work/"\n';

/** What doctor prints for a project holding only this config. */
async function doctorOf(config: string, dirs: string[] = []): Promise<string> {
    const root = await scratch("craftpath-doctor-");
    for (const dir of dirs) await mkdir(join(root, dir), { recursive: true });
    await Bun.write(join(root, ".craftpath/config.toml"), config + TAIL);
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
        await doctor(root, 5000, [CLAUDE_CODE]);
    } finally {
        console.log = log;
    }
    return lines.join("\n");
}

describe("doctor", () => {
    test("reports each module's commands", async () => {
        const out = await doctorOf(
            '[modules.api]\npath = "./api"\ntest = "pwd | grep -q /api$"\n\n[modules.web]\npath = "./"\nbuild = ""\n',
            ["api"],
        );

        // test runs in api's directory and passes; build is not declared.
        expect(out).toMatch(/api\.test\s+PASS/);
        expect(out).toMatch(/api\.build\s+MISSING/);
        expect(out).toMatch(/web\.test\s+MISSING/);
    });

    test("a blank build does not lower the health", async () => {
        const out = await doctorOf('[modules.app]\npath = "./"\ntest = "true"\nbuild = ""\n');

        expect(out).toContain("Verification health: HEALTHY");
        expect(out).toMatch(/app\.build\s+MISSING/);
        expect(out).not.toMatch(/verified by[^\n]*app\.build/);
    });

    test("a blank test still lowers the health", async () => {
        const out = await doctorOf('[modules.app]\npath = "./"\ntest = ""\nbuild = "true"\n');

        expect(out).not.toContain("Verification health: HEALTHY");
    });
});
