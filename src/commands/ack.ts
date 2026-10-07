import { GENERATED, renderCommand } from "./generated";

/**
 * Explicit user acknowledgement of a manual criterion. The counterpart to
 * `approve`: a design task's output is proven by a person reading it, and this
 * is how that person signs it off without dropping into a terminal.
 */
export const ACK_COMMAND = renderCommand(`---
description: Acknowledge a manual acceptance criterion and continue selected work
argument-hint: <task> <criterion> <work-id>
disable-model-invocation: true
---
${GENERATED}

The user explicitly acknowledges one manual criterion of one task:

\`$ARGUMENTS\`

Arguments must be \`<task> <criterion> <work-id>\`, for example
\`D001 A1 W-0001-avatar-upload\`. Run exactly:

CP
craftpath task ack <task> <criterion> --work <work-id> --harness-approval
CP

Then continue the selected work immediately. Read the installed
\`{{CMD:work}}\` command and resume where the acknowledgement was awaited --
usually \`craftpath task done <task> --work <work-id>\` once every criterion is
satisfied. Do not ask the user to repeat the acknowledgement or to say
"resume".
`);
