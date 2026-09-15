import { GENERATED, renderCommand } from "./generated";

export const STATUS_COMMAND = renderCommand(`---
description: Where the current work item stands and what to do next
---
${GENERATED}

Run \`craftpath status\` and report:

- the current work item, its mode, and its gate state
- which tasks are done, in progress, and blocked -- and by what
- the next unblocked task
- any task left \`in_progress\` from an interrupted session

For an interrupted task, do not trust partial state: re-run
\`craftpath task verify <id>\` and let the evidence decide whether it is actually
finished. Verification is cheap relative to reconstructing what happened.

Then state the single next action. Do not start it unless asked.
`);
