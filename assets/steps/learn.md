---
description: Propose what a work item taught -- ADRs and lines for CLAUDE.md / AGENTS.md -- for the user to pick
argument-hint: <work id>
---
{{DELEGATE}}
# Propose what to keep from a work item

1. Run `{{SCRIPT:learn}} {{ARGS}}`. It creates `KNOWLEDGE.md` from the
   template (or keeps the existing one) and prints what to learn from, the
   existing ADRs and instruction files, and the next free candidate id.
   **If it is refused or fails, stop and report the reason word for word. Do
   nothing else.**
2. Read every source it lists, the existing ADRs and the instruction files,
   in the work item's worktree. Change nothing but `KNOWLEDGE.md`. Follow
   *What is worth keeping* below.
3. Write each candidate into `KNOWLEDGE.md`, starting from the id the script
   printed, in the form the template's comment shows. Write the **exact
   text** to keep: the user ticks the candidates as you wrote them, and they
   are applied word for word. Keep existing candidates as they are. If
   nothing is worth keeping, write `None`. Delete the guidance comment.
4. Run `{{SCRIPT:check}} knowledge <work id>` and fix what it reports.
5. Stop. Report where `KNOWLEDGE.md` is and list the candidates. The user
   ticks (`[x]`) the ones to keep, may edit their text, and then runs
   `{{CMD:learn-apply}} <work id>`; after that, `{{CMD:pr}} <work id>`.

The user's request: {{REQUEST}}

## What is worth keeping

Most of what a work item produced is already where it belongs: in the code,
the tests and the commits. Propose only what would otherwise be lost, and
what would change how the next person or agent works here.

A candidate is worth proposing when **all** of these hold:

- **It holds beyond this work item.** "T-0002 needed a retry" is history;
  "calls to the payment API time out under load and need a retry" is
  knowledge.
- **It is not already written down** -- in the code, a comment, an existing
  ADR, `CLAUDE.md` or `AGENTS.md`.
- **It would have changed what someone did here.** A review point that was
  a mistake an agent is likely to repeat, a surprise in a task's Notes, a
  decision whose rejected option someone will propose again.

### `[ADR]` -- a decision

A choice between real options that someone will later want the reason for:
typically a `DESIGN.md` decision, or one made in a task's Notes. Context says
what forced the choice, Decision what was chosen, Consequences what follows
-- including the cost. Not an ADR: a fact about the code, or a choice with no
real alternative.

### `[CLAUDE.md]` / `[AGENTS.md]` -- a line for agents

One instruction, written as it should read in the file, for an agent working
on this repository: how to run something, a trap to avoid, a convention the
code follows. Target a file the project already has; if it has neither,
the harness's own (`CLAUDE.md` on Claude Code, `AGENTS.md` on pi). Not a
line: anything a linter or a test already enforces, or advice true of every
project.

Fewer, sharper candidates are better than many. Each one is something the
user has to read and decide on.
