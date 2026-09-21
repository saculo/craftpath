import { GENERATED, renderCommand } from "./generated";

export const INVESTIGATE_COMMAND = renderCommand(`---
description: Diagnose a bug and produce a requirement -- without fixing it
argument-hint: <symptoms, logs, or failing test>
---
${GENERATED}

Investigate: $ARGUMENTS

**Do not modify application code.** This command produces a diagnosis and a
requirement. The fix goes through \`{{CMD:work}}\` afterwards so it gets the
same planning and verification as any other change.

Separating diagnosis from repair lets a human triage the finding before anyone
writes code, and means the fix is planned rather than improvised.

CP
craftpath work new "<symptom in a few words>"
CP

Copy \`.craftpath/templates/finding.md\` into the work item and fill it in as you
go. It has the sections below already laid out.

1. **Reproduce** -- a failing test or an exact command. If you cannot reproduce
   it, say so plainly and record what you tried. That is a real result, not a
   failure.
2. **Evidence** -- logs, stack traces, git history, recent changes to the area.
   Facts only; keep interpretation for the next step.
3. **Hypotheses** -- each with what would confirm or rule it out. Write them
   before you start eliminating, so you notice when you are down to none.
4. **Root cause** -- the mechanism, not the symptom. If the evidence does not
   support a single cause, say which hypotheses remain open rather than picking
   the most plausible one.
5. **Requirement** -- fill in \`requirement.md\` with a scenario that fails today
   and would pass once fixed. That scenario becomes the acceptance criterion for
   the fix, so make it precise.

Then stop and report. Do not start the fix, and do not add tasks.

If the root cause reveals a class of bug rather than one instance, say so. That
is usually a missing rule or lint check, not a one-line fix.
`);
