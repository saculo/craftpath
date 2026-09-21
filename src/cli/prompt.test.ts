/**
 * The interactive harness picker.
 *
 * Its parsing is pure and tested here; only the reading of a line is I/O.
 */
import { describe, expect, test } from "bun:test";
import { CLAUDE_CODE } from "../harness/claude-code";
import { PI } from "../harness/pi";
import { parseChoice, promptFor } from "./prompt";

const OPTIONS = [CLAUDE_CODE, PI];

describe("reading an answer to the harness prompt", () => {
    test("one number, several, and separators people actually type", () => {
        expect(parseChoice("1", OPTIONS)).toEqual([CLAUDE_CODE]);
        expect(parseChoice("2", OPTIONS)).toEqual([PI]);
        expect(parseChoice("1,2", OPTIONS)).toEqual([CLAUDE_CODE, PI]);
        expect(parseChoice("1 2", OPTIONS)).toEqual([CLAUDE_CODE, PI]);
        expect(parseChoice(" 2, 1 ", OPTIONS)).toEqual([PI, CLAUDE_CODE]);
    });

    test("a name works as well as a number", () => {
        // A prompt that only accepts indices is one whose answer cannot be
        // pasted from the --harness flag it is standing in for.
        expect(parseChoice("pi", OPTIONS)).toEqual([PI]);
        expect(parseChoice("claude-code,pi", OPTIONS)).toEqual([CLAUDE_CODE, PI]);
    });

    test("an empty answer takes the default rather than nothing", () => {
        expect(parseChoice("", OPTIONS)).toEqual([CLAUDE_CODE]);
        expect(parseChoice("   ", OPTIONS)).toEqual([CLAUDE_CODE]);
    });

    test("a repeat is one install", () => {
        expect(parseChoice("1,1,claude-code", OPTIONS)).toEqual([CLAUDE_CODE]);
    });

    test("an answer outside the list is refused, not rounded", () => {
        expect(() => parseChoice("3", OPTIONS)).toThrow(/3/);
        expect(() => parseChoice("0", OPTIONS)).toThrow(/0/);
        expect(() => parseChoice("emacs", OPTIONS)).toThrow(/emacs/);
    });
});

describe("what the prompt shows", () => {
    test("every harness, numbered, with the default marked", () => {
        const text = promptFor(OPTIONS);
        expect(text).toContain("1. Claude Code");
        expect(text).toContain("2. pi");
        expect(text).toContain("default: 1");
    });

    test("it says several may be chosen, because that is the whole point", () => {
        expect(promptFor(OPTIONS).toLowerCase()).toContain("both");
    });
});
