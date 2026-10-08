/**
 * The shipped scenarios are runnable -- checked for free, in CI.
 *
 * A real run is paid; a scenario whose fixture does not build or whose setup
 * fails should be found here, not after the money is spent.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../../test/scratch";
import { cli } from "../kit/cli";
import { GRADERS } from "./graders";
import { prepareFixture } from "./run";
import { fixtureFiles, loadScenarios } from "./scenario";

afterAll(cleanScratch);

const HERE = new URL(".", import.meta.url).pathname;

describe("shipped scenarios", async () => {
    const scenarios = await loadScenarios(join(HERE, "scenarios"));

    test("include the first three: a feature, a bug fix, and a refused done", () => {
        expect(scenarios.map((s) => s.id)).toEqual(
            expect.arrayContaining([
                "L1-small-feature",
                "L2-bugfix-reproduce-first",
                "L5-done-refused",
            ]),
        );
    });

    for (const scenario of scenarios) {
        test(`${scenario.id}: graders exist, the fixture builds, its suite passes, and setup runs`, async () => {
            expect(scenario.graders.filter((g) => !(g in GRADERS))).toEqual([]);
            const files = await fixtureFiles(join(HERE, "fixtures"), scenario.fixture);

            const root = await prepareFixture(scenario, "claude-code", files);

            const suite = await Bun.$`bun test`.cwd(root).quiet().nothrow();
            // Every fixture starts green -- an untested bug included -- unless setup made it red.
            if (!scenario.setup) expect(suite.exitCode).toBe(0);
            expect((await cli(root, "status")).exit).toBe(0);
        }, 60_000);
    }
});
