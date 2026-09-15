/**
 * Skills craftpath installs into a project, by directory name.
 *
 * This is what ships. craftpath's own `.claude/` is internal tooling for
 * developing craftpath: init never reads it, and nothing in it reaches a project.
 */
import { ARCHITECTURE_SKILL } from "./architecture";
import { BACKEND_SKILL } from "./backend";
import { FRONTEND_SKILL } from "./frontend";
import { INFRASTRUCTURE_SKILL } from "./infrastructure";
import { PLANNING_SKILL } from "./planning";
import { TESTING_SKILL } from "./testing";
import { UX_SKILL } from "./ux";

export const SKILLS: Record<string, string> = {
    architecture: ARCHITECTURE_SKILL,
    backend: BACKEND_SKILL,
    frontend: FRONTEND_SKILL,
    infrastructure: INFRASTRUCTURE_SKILL,
    planning: PLANNING_SKILL,
    testing: TESTING_SKILL,
    ux: UX_SKILL,
};
