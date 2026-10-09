---
name: craftpath-learn-apply
disable-model-invocation: true
context: fork
background: false
description: Write the knowledge candidates the user ticked -- ADRs in docs/adr, lines in CLAUDE.md / AGENTS.md
argument-hint: <work id>
---
# Apply the chosen knowledge

1. Run `python3 .craftpath/scripts/learn-apply.py "$ARGUMENTS"`. It writes every ticked candidate
   not applied yet -- an ADR in `docs/adr/`, a line appended under
   `## Learned` in `CLAUDE.md` or `AGENTS.md` -- marks each applied and
   commits them with `KNOWLEDGE.md`. With nothing ticked it applies nothing
   and commits `KNOWLEDGE.md` alone, as the record of what was not kept. **If it is refused or fails, stop and report the reason word
   for word. Do nothing else.**
2. Stop. Report what it applied, as it printed it. Change nothing yourself.
   The next step: `/craftpath-pr <work id>`.

The user's request: $ARGUMENTS
