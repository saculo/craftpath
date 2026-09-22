/**
 * The command `init` and `doctor` print when the guards cannot run.
 *
 * It is the one string in craftpath that has to be pasteable as-is: it appears
 * exactly when the trust boundary is not enforced, and a fix nobody can run is
 * a warning people learn to skip.
 */
import { describe, expect, test } from "bun:test";
import { installCommandFor } from "./install";

describe("installed from the registry", () => {
    test("names the package, not the path it happens to be unpacked at", () => {
        expect(installCommandFor("/home/me/.bun/install/global/node_modules/craftpath")).toBe(
            "bun add -g craftpath",
        );
    });

    test("anywhere under node_modules, however nested", () => {
        expect(
            installCommandFor("/opt/x/node_modules/.store/craftpath@1/node_modules/craftpath"),
        ).toBe("bun add -g craftpath");
    });
});

describe("running from a checkout", () => {
    test("names the checkout, so a contributor's edits are what gets linked", () => {
        expect(installCommandFor("/home/me/Projects/craftpath")).toBe(
            "bun add -g /home/me/Projects/craftpath",
        );
    });

    test("a path with spaces is quoted, because it is meant to be pasted", () => {
        expect(installCommandFor("/home/me/My Projects/craftpath")).toBe(
            'bun add -g "/home/me/My Projects/craftpath"',
        );
    });

    test("a directory merely NAMED node_modules is not an install", () => {
        // `node_modules` has to be a path SEGMENT. A checkout at
        // ~/src/node_modules-experiments is still a checkout.
        expect(installCommandFor("/home/me/node_modules-experiments/craftpath")).toStartWith(
            "bun add -g /home/me/",
        );
    });
});
