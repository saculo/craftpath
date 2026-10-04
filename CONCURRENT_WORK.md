# Concurrent open work items

## Goal

Allow Craftpath to retain multiple open work items while making every operation
unambiguously target one item. This permits several requirements to be planned
or in progress at once. Parallel implementation should use separate Git
worktrees.

## Current constraint

Craftpath infers the current work item from the sole directory under
`.craftpath/work/`. `work new` refuses to create another item, and the core
lookup throws when more than one is present. Commands such as task execution,
approval, validation, and archive consequently all assume exactly one open
item.

## Proposed interface

Add an optional work selector to all work-scoped commands:

```sh
craftpath status
craftpath status --work 0002-auth
craftpath approve plan --work 0002-auth
craftpath task start T001 --work 0002-auth
craftpath task verify T001 --work 0002-auth
craftpath archive --work 0002-auth
```

Selection rules:

1. With exactly one open item, omission of `--work` selects it for backwards
   compatibility.
2. With multiple open items, commands that operate on one item require
   `--work <id>` and otherwise fail with a list of available IDs.
3. `craftpath status` without `--work` lists all open items with their ID,
   title, derived phase, and gate summary.
4. A supplied work ID must be open and have matching state under
   `.craftpath/state/<id>/`.

Do not store a mutable repository-wide “active work” setting. It is ambiguous
across terminals and agents; an explicit command argument is deterministic.

## Implementation plan

### 1. Tests first

Add failing tests proving that:

- `work new` can create a second open work item.
- status without a selector lists multiple open items.
- status with `--work` reports only the selected item.
- a work-scoped operation with multiple open items and no selector fails
  clearly.
- each selected command changes only that work item’s task state, approvals,
  evidence, and artifacts.
- archiving one work item leaves other open work items available.
- trailer validation and reconciliation remain restricted to the selected work
  ID.

### 2. Generalize core lookup

In `src/core/work.ts`, replace the `onlyOpen()` / `openWorkId()` assumption with
APIs equivalent to:

- `openWorkIds(root)` — return all open work IDs.
- `resolveWorkId(root, requestedId?)` — use the requested open ID, select the
  sole item when exactly one exists, or reject ambiguity.
- `readWork(root, workId)` — read state for an explicitly selected ID.

Retain structural validation for missing or invalid state, but no longer treat
multiple valid open directories as corrupt.

### 3. Thread selection through operations

Update `task.ts`, `approve.ts`, `validate.ts`, `archive.ts`, `reconcile.ts`,
and status to receive a resolved work ID rather than independently assuming
one open item. Keep every state and artifact read/write under the selected:

- `.craftpath/work/<work-id>/`
- `.craftpath/state/<work-id>/`

### 4. Add CLI support

Add `--work <id>` to stateful commands, including status, approval, task
operations, validate, archive, and PR-body generation. Resolve the ID at the
CLI boundary where practical, then pass it through core operations.

### 5. Git concurrency

`work new` currently creates and checks out `work/<id>`. Multiple work items
can be recorded in the same repository checkout, but their implementations
should be concurrent only in separate Git worktrees:

```sh
git worktree add ../project-auth work/0002-auth
```

Initially, document Git worktrees as the supported workflow. A later
`craftpath worktree new` convenience command can automate creation if needed.

### 6. Documentation and compatibility

Existing repositories need no migration: their single open item is selected
implicitly. Update README and generated agent instructions that currently say
to resume the one open item or never create a duplicate. Replace the current
multiple-open-items-as-corruption recovery guidance with the selector workflow.

## Boundary

This change supports multiple open/planned work items and explicit selection.
It does not make overlapping source changes conflict-free; worktrees and normal
Git integration practices remain responsible for that.

## Workflow runtime: ideas adapted from VirtusLab Orca

[Orca](https://github.com/VirtusLab/orca) is a deterministic AI-development
flow runner. Its stage-bound runtime is a useful model for the harness-facing
Craftpath redesign, but Craftpath should retain its stronger requirement,
acceptance, evidence, and human-approval model.

### Make a work item a durable flow run

Model each open work item as a durable run, bound to:

- a work ID;
- a selected flow/version;
- a branch and, for concurrent implementation, a worktree;
- a structured progress log;
- harness/backend session identities; and
- the currently waiting condition, if any.

The runner's durable state must be enough to recover after a harness restart,
an interrupted agent call, or a lost backend session. A rerun should resume the
first incomplete stage rather than replaying successful work or asking the
user to explain what to resume.

### Use named, idempotent stages

Borrow Orca's central rule: a stage is a named, resumable unit of side effects.
Craftpath stages should be explicit and small enough to recover safely, for
example:

1. `requirements`
2. `context`
3. `plan`
4. `await-plan-approval`
5. `task/T001/implement`
6. `task/T001/verify`
7. `task/T001/commit-and-complete`
8. `integration`
9. `result`
10. `await-result-approval`
11. `pr`
12. `archive`

A completed stage records structured output and a commit anchor where it
changes the repository. On re-entry, the runtime checks its recorded result
and skips the stage. A failed or interrupted stage remains incomplete and is
retried/reconciled deliberately.

The task lifecycle remains Craftpath-owned: an implementation stage must still
show RED before GREEN where a criterion is testable; verification still records
command evidence; completion still requires evidence and the correct Git
trailers. Stages orchestrate those invariants; they do not replace them.

### Replace shell handoffs with waiting states and `advance`

The harness owns the public interface. It invokes an internal operation similar
to `advance(workId)` after every user-facing action. `advance` runs stages until
one of these outcomes:

- `waiting_for_approval` with the gate and a human-readable summary;
- `waiting_for_user_input` for a genuine ambiguity;
- `blocked` with actionable failure evidence;
- `completed`; or
- a normal in-progress result while the harness is streaming a task.

`/craftpath:approve plan --work <id>` is a user gesture that records approval
and immediately calls `advance(<id>)`. It never requires a separate “resume
T001” request. Likewise, opening `/craftpath:work --work <id>` is a resume
operation, not a fresh planning request.

### Persist and recover agent sessions

Use separate role/session records, inspired by Orca's backend-neutral sessions:

- a planning session for requirement/context/plan work;
- a fresh isolated implementation session per task, seeded only with the task,
  declared skills, requirement scenario, and declared dependency artifacts;
- a reviewer session when review is enabled.

Record backend name, model, and durable session ID with the stage. If a backend
cannot resume that session, start a replacement and seed it from the durable
stage/task inputs plus a concise progress summary. Do not depend on the chat
window surviving.

### Branch/worktree binding and concurrency

A run must refuse to advance from a different branch or worktree than the one
it owns, unless an explicit recovery operation rebinds it. Concurrent execution
uses one worktree and one harness session per work ID, plus a per-work lock to
prevent two agents advancing the same run simultaneously. Independent work IDs
may advance concurrently; shared-resource conflicts are handled through normal
Git integration and declared module/resource locks where needed.

### Flow definitions and roles

Keep a small built-in standard flow first, but make the orchestration policy
configurable rather than embedding it in prose prompts. A flow should declare:

- stages and their dependencies;
- the agent role and allowed tools/capabilities for each stage;
- retry and stop conditions;
- review/format/integration gates; and
- whether a stage requires a human event.

This takes Orca's useful position that enforced sequencing belongs in code, not
in a request asking a model to remember it. Craftpath's task files remain the
approved specification; a flow is the execution policy.

### Review and bounded repair loops

Add optional per-task review and final integration review as stages. Reviewer
findings become structured inputs to a bounded repair loop (for example, a
configured maximum number of attempts), rather than unbounded agent dialogue.
A flow must surface unresolved findings as a blocker for a human decision.

### What not to copy

- Do not make Craftpath's correctness depend only on stage commits. Preserve
  criterion-level verification evidence and task trailers.
- Do not auto-approve write-capable agents merely because they are inside a
  flow. Harness capabilities and existing guards remain enforcement points.
- Do not use a prompt hash as the identity of a work item: Craftpath's explicit
  allocated work ID is clearer for parallel work, approvals, and audit.
- Orca describes itself as a single-developer workflow. Its stage-resume model
  is valuable, but Craftpath needs explicit work selection, locks, and
  worktrees for multiple active runs.

Sources:

- https://github.com/VirtusLab/orca
- https://github.com/VirtusLab/orca/blob/master/adr/0018-stage-bound-flow-runtime.md
- https://github.com/VirtusLab/orca/blob/master/adr/0013-persistent-plans.md

## Current scope decision

Do not implement the Orca-inspired stage runtime, persistent agent sessions, or
review-loop expansion as part of the concurrent-work change. The immediate
scope remains:

1. multiple open work items with explicit `--work` selection;
2. harness-first commands that call Craftpath internals;
3. one worktree and one harness session per concurrently executing work item;
   and
4. automatic harness continuation after a user approval.

For Pi, do not retain Craftpath's bespoke `craftpath_task` subagent runner.
Use Pi's standard `subagent` extension instead, configured with a project-local
Craftpath worker agent and invoked with `agentScope: "both"`. The standard
extension already supplies isolated subprocess contexts, streaming progress,
abort propagation, structured JSON capture, and bounded parallel dispatch.

Keep the Craftpath Pi extension only for Craftpath-specific responsibilities:
guards, completion validation, harness-facing Craftpath commands, work
selection, and orchestration. It should delegate execution through the
standard `subagent` tool instead of spawning `pi` itself.

The standard extension is currently an upstream example, not a Pi built-in or
an installed package in this environment. Craftpath must therefore make it an
explicit, version-pinned harness dependency (or vendor the supported extension
at installation), rather than assume every Pi user has it. Its current worker
invocations use `--no-session`; that is acceptable for isolated one-shot task
execution in this scope. Durable subagent-session recovery is deferred with the
broader workflow-runtime work.

Do not use its parallel mode to edit the same worktree. Use it for independent
read-only scouting/review, or run implementation tasks concurrently only after
Craftpath has scheduled them onto separate worktrees and verified they do not
share declared resources.
