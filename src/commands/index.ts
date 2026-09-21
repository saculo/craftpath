/**
 * The slash commands craftpath installs, by file name.
 *
 * Their bodies carry harness tokens (see `harness/render.ts`) and are resolved
 * per harness at install time.
 */
import { INVESTIGATE_COMMAND } from "./investigate";
import { PR_COMMAND } from "./pr";
import { STATUS_COMMAND } from "./status";
import { WORK_COMMAND } from "./work";

export const COMMANDS: Record<string, string> = {
    "work.md": WORK_COMMAND,
    "investigate.md": INVESTIGATE_COMMAND,
    "pr.md": PR_COMMAND,
    "status.md": STATUS_COMMAND,
};
