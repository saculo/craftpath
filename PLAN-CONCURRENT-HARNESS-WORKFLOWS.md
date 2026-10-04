# Plan — Concurrent Harness Workflows and Evaluated Pi Delegation

## Problem

Craftpath currently assumes exactly one directory under `.craftpath/work/` and
therefore exactly one open work item. Its user-facing flow is also split between
agent prompts and shell commands: a user approves a manual gate in a terminal,
then must explicitly ask the agent to resume.

On Pi, Craftpath additionally owns a bespoke `craftpath_task` tool that spawns
`pi` directly. A subprocess that returns generic text such as “How can I help?”
exits successfully and is treated as a successful tool run. The parent agent,
not a deterministic workflow controller, decides whether that means a blocker.
The observed result is an `in_progress` task that does not advance despite no
project or Docker failure.

## Goal

Make the harness the user-facing workflow controller while retaining Craftpath
as the durable, auditable core. Support multiple open work items, explicit work
selection, and concurrent execution in separate Git worktrees. For Pi, use the
standard `subagent` extension for child-process execution and retain Craftpath
only for Craftpath-specific orchestration, guards, validation, and state.

The resulting normal interaction is:

```text
/craftpath:work "Add authentication"
# Harness plans until a human gate.

/craftpath:approve plan --work 0002-authentication
# Approval is recorded and the selected work advances immediately.
```

The user must never need to say “resume T001” after an explicit approval.

## Non-goals

- Do not implement the broader Orca-inspired persistent stage/session runtime
  in this change.
- Do not permit concurrent edits in the same worktree.
- Do not make a model response by itself proof that a task completed.
- Do not weaken manual-gate approval: a model cannot self-approve a manual
  gate.
- Do not use live LLM calls as required unit-test infrastructure.

## Design decisions

### Work selection

Work IDs are explicit command/harness inputs. There is no repository-global
“active work” setting.

- With one open item, it is selected for backwards compatibility.
- With multiple open items, a work-scoped operation requires `--work <id>`.
- `status` without `--work` lists all open items.
- Each harness session keeps its selected work only as session-local UI state;
  it never mutates repository-global selection.

### Concurrency boundary

A concurrently executing work item owns one branch and one Git worktree. A
per-work lock prevents two harnesses advancing the same work ID concurrently.
Independent work IDs can advance in parallel; source conflicts and shared
resources remain Git/integration concerns.

### Harness/core boundary

The Craftpath CLI/core becomes machine-facing. Harness commands are the public
interface. The harness obtains state through structured core operations and
runs a deterministic `advance(workId)` loop after every public action.

`advance(workId)` continues only until it reaches one of:

- `waiting_for_approval`;
- `waiting_for_user_input`;
- `blocked` with actionable recorded failure;
- `completed`.

### Pi delegation boundary

Pi's standard `subagent` extension owns isolated child Pi processes, streaming,
abort propagation, and dispatch. Craftpath must not spawn `pi` directly.

Craftpath's Pi extension remains responsible for guards, completion validation,
Craftpath commands, work selection, and orchestration. It invokes the standard
`subagent` tool through Pi's nested tool mechanism and validates the returned
worker outcome.

The standard extension is not currently installed by default. Craftpath must
make it an explicit, version-pinned dependency or explicitly require and detect
it. `doctor` must report the missing capability with installation/remediation
instructions; it must never silently fall back to `craftpath_task`.

### Worker outcome contract

A project-local `craftpath-worker` definition receives only:

- the selected task's full brief;
- its declared skills;
- requirement scenario; and
- declared artifacts from completed dependencies.

Its final response has a machine-readable outcome envelope:

```json
{
  "status": "completed | blocked | failed",
  "summary": "short factual result",
  "blocker": "required only for blocked or failed"
}
```

The orchestrator rejects malformed output and known generic/no-op responses as
`failed` execution attempts. It does not treat a zero process exit as proof of
task completion. Completion remains determined by Craftpath evidence,
verification, and required Git trailers.

## Implementation sequence

### P0 — Restore trustworthy baseline tests

The suite currently has an environmental false failure:
`validate CLI > --complete refuses to report success it cannot prove` runs in
this uninitialised checkout and receives exit code 3 instead of exercising
incomplete-work validation.

Make the test use an isolated initialized fixture. Confirm RED/GREEN is about
incomplete-proof behavior, not missing project setup. No feature implementation
starts until `bun test` is green.

Acceptance:

- `validate CLI > --complete refuses to report success it cannot prove`
  initializes a fixture and observes the intended incomplete-work refusal.

### P1 — Multiple open work items and explicit resolution

Replace the single-open-item assumption in `src/core/work.ts`.

- Add `openWorkIds(root)`.
- Add `resolveWorkId(root, requestedId?)`.
- Add explicit `readWork(root, workId)` APIs.
- Let `work new` create another open item.
- Preserve implicit selection only when exactly one is open.
- Reject ambiguous operations with IDs and a `--work` remedy.
- Update task, approval, validation, archive, reconciliation, PR, and status
  APIs to receive a resolved work ID.
- Add `--work` to all work-scoped CLI commands.
- Make unselected `status` render a concise list when more than one is open.

Acceptance selectors:

- `work new > permits a second open work item`
- `work resolution > selects the sole open work item for compatibility`
- `work resolution > refuses an ambiguous work-scoped operation with available ids`
- `work resolution > selects the explicitly requested open item`
- `status > lists all open work items when no selector is supplied`
- `task isolation > changes only the explicitly selected work state`
- `approval isolation > records an approval only on the selected work`
- `archive isolation > archives one selected work without closing another`
- `trailer check is scoped to the selected work item`

### P2 — Harness-first public commands

Add harness-facing `approve` and resume/advance command flows for both Claude
Code and Pi. Generated command text must make the internal CLI an implementation
detail rather than an operator workflow.

- `/craftpath:work` (Claude) / `/craftpath-work` (Pi) creates, selects, or
  resumes work and invokes `advance(workId)`.
- `/craftpath:approve <gate> [--work <id>]` records a user approval and invokes
  `advance(workId)` in the same harness action.
- `/craftpath:status [--work <id>]` lists/selects work without requiring a
  shell command.
- Manual approval remains an explicit harness user action. The harness obtains
  confirmation before passing a trusted human approval signal to core.
- Keep raw CLI commands available as internal primitives and for automation,
  but remove them from normal user instructions.

Acceptance selectors:

- `generated harness commands > installs approve for every harness`
- `approval command > resolves the selected work and immediately advances it`
- `manual approval > cannot be issued by an agent shell call`
- `harness status > lists multiple work items and preserves explicit selection`
- `resume command > advances the selected work without requiring task prose`

### P3 — Replace Pi's bespoke child-process runner

Remove `craftpath_task` and its direct `spawn("pi", ...)` behavior from
`src/harness/pi-extension.ts`.

- Generate/install a project-local `craftpath-worker` agent definition.
- Require the standard `subagent` tool.
- Invoke it through `ctx.executeTool("subagent", ...)`, using the project
  worker and project agent scope.
- Preserve guards and validation in the Craftpath extension.
- Ensure missing tool/worker capability returns an actionable failure and is
  visible to `doctor`.
- Do not invoke standard-subagent parallel dispatch for code changes in one
  worktree.

Acceptance selectors:

- `pi extension > does not spawn pi for task delegation`
- `pi extension > delegates Craftpath work to the registered subagent tool`
- `pi extension > reports a missing subagent capability with remediation`
- `pi install > writes the Craftpath worker definition`
- `doctor > reports Pi delegation unavailable when the subagent extension is absent`
- `rendered Pi workflow > names the standard subagent mechanism, not craftpath_task`

### P4 — Deterministic task-execution orchestration

Implement an orchestration seam that receives a work ID and an injectable
subagent executor. It must own state transitions around execution instead of
asking a parent LLM to interpret arbitrary output.

- Start an unblocked task.
- Build the worker input from task, skills, requirement, and completed
  dependency artifacts.
- Invoke the executor.
- Parse and validate the worker outcome envelope.
- Record execution attempt metadata and failure reason durably.
- On `completed`, run configured verification and use existing completion rules.
- On malformed/generic/failed output, record a failed attempt and apply bounded
  retry policy or return an actionable blocked state.
- On `blocked`, surface the explicit blocker without claiming a tool failure.

Acceptance selectors:

- `task advance > starts the next unblocked task for the selected work`
- `task advance > passes only declared task inputs to the worker`
- `task advance > generic worker output is a recorded failed attempt`
- `task advance > malformed worker outcome cannot complete a task`
- `task advance > a completed worker outcome still requires verification evidence`
- `task advance > failed verification remains evidence and blocks completion`
- `task advance > an explicit worker blocker is surfaced without retrying as success`
- `task advance > never advances a different work id`

### P5 — Worktree ownership and concurrent scheduling

Add worktree metadata and a per-work execution lock after P1/P4 have stable
interfaces.

- Bind a selected work to branch/worktree identity.
- Refuse `advance` if invoked from the wrong worktree.
- Acquire/release a work-scoped lock around advancement.
- Permit independent work IDs to advance concurrently only from different
  worktrees.
- Surface lock owner/status through harness status.

Acceptance selectors:

- `worktree binding > refuses to advance work from another worktree`
- `work lock > refuses a second simultaneous advance of the same work`
- `work lock > permits advances of independent work ids`

## Evaluation strategy

### Deterministic code evaluations (required)

Use fakes for the standard-subagent executor and harness UI. These tests must
exercise complete state transitions, generated files, structured outcomes, and
core evidence rather than assert only prompt substrings.

Test fixtures cover:

1. one-work backwards compatibility;
2. two open work items with selection isolation;
3. approval followed by automatic advancement;
4. successful worker outcome followed by verification;
5. generic `How can I help?` output;
6. malformed JSON outcome;
7. explicit worker blocker;
8. worker process/tool failure;
9. failed verification; and
10. concurrent attempt/lock contention.

Every fixture asserts both returned outcome and durable files under the selected
`.craftpath/work/<id>/` and `.craftpath/state/<id>/` paths.

### Harness integration evaluations (required)

For Pi, load the generated Craftpath extension against a fake ExtensionAPI that
implements nested `executeTool`, tool availability, UI confirmation, and
cancellation. Assert the actual delegation request and structured response
handling. This replaces current shallow checks that merely look for a registered
tool name or a substring in generated TypeScript.

For Claude Code, assert generated command and hook contracts, including explicit
work selection and user-approval flow. Keep backend-specific subagent execution
behind the same orchestrator interface.

### LLM behavior evaluations (required but offline)

Add versioned transcript/tool-call fixtures. The evaluator grades actions, not
natural-language style:

- selected work ID is correct;
- a manual gate is never self-approved;
- approval triggers advance in the same user command;
- Pi delegates through `subagent` using `craftpath-worker`;
- task worker receives declared inputs only;
- generic output is classified as failure;
- no output tells the user to manually “resume T001.”

These are deterministic replay/contract tests. Optional live-model smoke runs
may be provided separately, clearly marked non-blocking, and must not be the
only proof of a workflow property.

## Migration and compatibility

- Existing projects with one open item require no data migration and keep
  implicit work selection.
- A stale generated Pi extension is replaced by `craftpath update`.
- Projects without the standard Pi subagent dependency receive an explicit
  doctor/command failure with installation instructions; no silent fallback.
- Existing state without execution-attempt records parses with an empty attempt
  list.
- Documentation changes replace the one-open-item and shell-resume workflow
  with harness-first commands.

## Completion criteria

- `bun test` is green, including the repaired baseline test.
- All acceptance selectors above exist and were observed RED before their
  implementation changed.
- The deterministic Pi extension integration evaluation proves no direct
  `pi` spawn and proves generic subagent output fails safely.
- A two-work fixture proves state, approval, evidence, and archive isolation.
- A harness approval fixture proves approval automatically invokes advancement.
- README and installed command help present harness commands as the normal user
  interface and CLI commands as internal/automation primitives.
