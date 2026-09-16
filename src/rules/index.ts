/**
 * Rules craftpath installs into a project's `.claude/rules/`, by file name.
 *
 * This is what ships. craftpath's own `.claude/` is internal tooling for
 * developing craftpath: init never reads it, and nothing in it reaches a project.
 */
import { TDD_RULE } from "./tdd";

export const RULES: Record<string, string> = {
    "tdd.md": TDD_RULE,
};
