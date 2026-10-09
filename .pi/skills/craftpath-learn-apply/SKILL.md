---
name: craftpath-learn-apply
disable-model-invocation: true
description: Write the knowledge candidates the user ticked -- ADRs in docs/adr, lines in CLAUDE.md / AGENTS.md
argument-hint: <work id>
---
**Run this whole step in a fresh subagent.** Call the `Agent` tool (from
pi-subagents-lite) with agent `general-purpose`, `run_in_background: false`,
and as its prompt everything below this paragraph followed by the user's
request exactly as given after this skill. Then report the subagent's result
to the user, word for word, and stop. Do not do the step yourself.

# Apply the chosen knowledge

1. Run `python3 .craftpath/scripts/learn-apply.py "<the user's request>"`. It writes every ticked candidate
   not applied yet -- an ADR in `docs/adr/`, a line appended under
   `## Learned` in `CLAUDE.md` or `AGENTS.md` -- marks each applied and
   commits them with `KNOWLEDGE.md`. With nothing ticked it applies nothing
   and commits `KNOWLEDGE.md` alone, as the record of what was not kept. **If it is refused or fails, stop and report the reason word
   for word. Do nothing else.**
2. Stop. Report what it applied, as it printed it. Change nothing yourself.
   The next step: `/skill:craftpath-pr <work id>`.

The user's request: the user's request, given after this skill
