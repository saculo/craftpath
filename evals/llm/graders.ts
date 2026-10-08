/**
 * Graders decide a trial. Deterministic first: craftpath already records the
 * evidence, so most of what matters is computed from the repository and the
 * trace rather than judged.
 */
import type { Scenario } from "./scenario";
import type { Event } from "./launch";

export interface GraderContext {
    root: string;
    scenario: Scenario;
    harness: "claude-code" | "pi";
    events: Event[];
    timedOut: boolean;
}

export interface Verdict {
    pass: boolean;
    detail?: string;
}

export type Grader = (ctx: GraderContext) => Promise<Verdict> | Verdict;

export const GRADERS: Record<string, Grader> = {
    /** The run finished inside its minute budget. */
    no_timeout: ({ timedOut }) => ({ pass: !timedOut }),
};
