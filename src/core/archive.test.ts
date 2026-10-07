/**
 * archive checks the living specs against the spec delta by requirement id.
 *
 * An id is an identifier, not a substring: `AUTH-R1` is not mentioned by a
 * spec that only carries `AUTH-R10`, and removing `AUTH-R1` is not blocked by
 * `AUTH-R10` still being there.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch, scratch } from "../../test/scratch";
import { specProblems } from "./archive";

afterAll(cleanScratch);

const WORK = "W-0001-auth";

async function repo(delta: string, spec: string): Promise<string> {
    const root = await scratch("craftpath-archive-");
    await Bun.write(join(root, ".craftpath/work", WORK, "spec-delta.md"), delta);
    await Bun.write(join(root, ".craftpath/specs/auth.md"), spec);
    return root;
}

const delta = (section: string, id: string) =>
    ["ADDED", "MODIFIED", "REMOVED"]
        .map((s) => `## ${s}\n${s === section ? `- ${id} — sign-in\n` : "- (none)\n"}`)
        .join("\n");

describe("spec ids are matched as identifiers", () => {
    test("an ADDED id is not satisfied by a longer id that contains it", async () => {
        const root = await repo(delta("ADDED", "AUTH-R1"), "# Auth\n\n- AUTH-R10 — lockout\n");

        expect(await specProblems(root, WORK)).toEqual([expect.stringContaining("ADDED AUTH-R1,")]);
    });

    test("a REMOVED id is not blocked by a longer id that contains it", async () => {
        const root = await repo(delta("REMOVED", "AUTH-R1"), "# Auth\n\n- AUTH-R10 — lockout\n");

        expect(await specProblems(root, WORK)).toEqual([]);
    });

    test("an ADDED id written into the spec is found, wherever it sits on the line", async () => {
        const root = await repo(delta("ADDED", "AUTH-R1"), "# Auth\n\n**AUTH-R1**: sign-in\n");

        expect(await specProblems(root, WORK)).toEqual([]);
    });
});
