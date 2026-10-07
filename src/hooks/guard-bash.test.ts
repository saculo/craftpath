/**
 * guard-bash regressions from the audit.
 *
 * Still best effort -- a regex cannot secure arbitrary shell, and the layer
 * that holds is validate re-reading evidence. But the sign-off half matches
 * craftpath's own command surface, and that surface includes the ways people
 * launch it: npx, bunx, and a Bun script path. A craftpath invocation exempts
 * itself from the state-write rule, never a redirect written inside it.
 */
import { describe, expect, test } from "bun:test";
import { shouldBlock } from "./guard-bash";

const POLICY = { requirement: "auto", plan: "manual", result: "manual" };

describe("sign-offs are recognised however craftpath is launched", () => {
    for (const cmd of [
        "npx craftpath approve plan",
        "bunx craftpath approve plan",
        "bunx --bun craftpath approve result",
        "bun bin/craftpath.ts approve plan",
        "bun ./node_modules/.bin/craftpath approve plan",
        "npx craftpath task ack T001 A1",
        "cd /repo && bunx craftpath task ack T001 A1 --work W-0001",
    ]) {
        test(`blocks: ${cmd}`, () => expect(shouldBlock(cmd, POLICY)).toBe(true));
    }

    for (const cmd of [
        "npx craftpath approve requirement",
        "bunx craftpath status",
        "bun bin/craftpath.ts task verify T001 --work W-0001",
        "craftpath task ack T001 A1 --work W-0001 --harness-approval",
    ]) {
        test(`allows: ${cmd}`, () => expect(shouldBlock(cmd, POLICY)).toBe(false));
    }
});

describe("a redirect inside a craftpath call is still a state write", () => {
    for (const cmd of [
        "craftpath status > .craftpath/state/W-0001-a/T001.json",
        "craftpath status --brief >> .craftpath/state/W-0001-a/work.json",
        "bunx craftpath pr body > .craftpath/state/W-0001-a/T001.json",
    ]) {
        test(`blocks: ${cmd}`, () => expect(shouldBlock(cmd, POLICY)).toBe(true));
    }

    test("allows a redirect that does not touch state", () => {
        expect(shouldBlock("craftpath pr body --work W-0001 > /tmp/pr-body.md", POLICY)).toBe(
            false,
        );
    });
});
