---
description: Write the knowledge candidates the user ticked -- ADRs in docs/adr, lines in CLAUDE.md / AGENTS.md
argument-hint: <work id>
---
{{DELEGATE}}
# Apply the chosen knowledge

1. Run `{{SCRIPT:learn-apply}} {{ARGS}}`. It writes every ticked candidate
   not applied yet -- an ADR in `docs/adr/`, a line appended under
   `## Learned` in `CLAUDE.md` or `AGENTS.md` -- marks each applied and
   commits them. **If it is refused or fails, stop and report the reason word
   for word. Do nothing else.**
2. Stop. Report what it applied, as it printed it. Change nothing yourself.
   The next step: `{{CMD:pr}} <work id>`.

The user's request: {{REQUEST}}
