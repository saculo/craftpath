import { GENERATED, renderCommand } from "./generated";

/**
 * Explicit user approval for a Craftpath gate. `$ARGUMENTS` is intentionally
 * passed through to the internal CLI: the slash-command invocation, not a
 * model decision, is the workflow approval event.
 */
export const APPROVE_COMMAND = renderCommand(`---
description: Approve a Craftpath gate and immediately continue selected work
---
${GENERATED}

The user explicitly approves one gate and one work item:

\`$ARGUMENTS\`

Arguments must be \`<gate> <work-id>\`, for example \`plan 0001-authentication\`.
Treat the first argument as the gate and the second as the work ID. Run exactly:

CP
craftpath approve <gate> --work <work-id> --approver "$(git config user.email)" --harness-approval
CP

Then continue the selected work immediately. Read the installed
\`/craftpath:work\` command and resume at the phase unlocked by this approval;
do not ask the user to repeat the approval or to say “resume”.

During execution, preserve its complete task contract: every task runs in a
fresh context through {{SUBAGENT}}, with every declared skill loaded; use
\`craftpath task start\`, follow RED → GREEN → REFACTOR, verify evidence, commit
with trailers, and mark the task done. Do not implement work directly in this
parent context.
`);
