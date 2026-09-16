# Plan — M1 bookkeeping kernel

**Status: DRAFT for review.** Written with the `planning` skill.
Covers point 4: the commands that turn craftpath from a scaffolder into
something that proves things.

## Requirement

§17's M1 exit criteria: *illegal states unrepresentable; `task done` cannot be
forced without evidence or a signed ack; a stale config invalidates prior
evidence.*

Everything derived is already built and tested in `src/transitions.ts` —
`isBlocked`, `criterionSatisfied`, `isStale`, `waves`, and the `start` / `verify`
/ `ack` / `done` / `amend` transitions. **None of it has a caller.** M1 is
almost entirely the I/O layer around functions that already work: read prose and
state from disk, execute a command, write evidence back, and refuse when the
preconditions those functions already encode are unmet.

That shapes the whole plan. If a task here finds itself changing
`transitions.ts`, that is a signal to stop — the logic was settled in M0 and a
change means either a real design gap or a task doing too much.

`/craftpath:work` currently carries this warning, and M1 is what removes it:

> **Not built yet.** `craftpath approve`, `amend`, `archive`, `pr body` and every
> `craftpath task` subcommand land in M1.

### Depends on other plans

| Needs | From |
|---|---|
| A resolvable `craftpath` binary | `PLAN-install.md` |
| `workNew`, `status`, task file reading | `PLAN-work-ts.md` |
| Config loading, `isConfigured`, `canRunSelector` | `PLAN-config-doctor.md` |

Those three land first. This plan assumes all of them.

### Scenarios

| # | Scenario | Covered by |
|---|---|---|
| S1 | A task is added to an open work item and appears in `status` | T401-A1 |
| S2 | Starting a blocked task is refused, naming the blocker | T402-A2 |
| S3 | Running a selector captures its exit code and its log | T403-A1, A2 |
| S4 | A failing command records evidence that does not satisfy the criterion | T403-A4 |
| S5 | A manual criterion is satisfied only by a signed ack | T404-A1 |
| S6 | `task done` is refused while any criterion is unsatisfied | T405-A1 |
| S7 | `task done` is refused when the trailer is absent from the branch | T405-A2 |
| S8 | Editing config.toml makes prior evidence stale, reopening completion | T403-A5 |
| S9 | A gate approval is recorded durably, not just in conversation | T406-A1 |
| S10 | `validate` passes on a half-finished work item | T407-A1 |
| S11 | `validate --complete` refuses while anything is unproven | T408-A1 |
| S12 | An amended task loses its evidence and returns to pending | T409-A1 |

---

## T401 — Add a task to the open work item

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`craftpath task add <id> --title "..." [--skills a,b] [--depends T001]` writes
`work/<work>/tasks/<id>-<slug>.md` from the template and creates the matching
`state/<work>/<id>.json` at `pending`.

The prose file is model space; the state file is kernel. Both are created here
so they cannot disagree from birth.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given an open work item with no tasks, when `task add T001` runs with a
      title, then tasks/T001-*.md exists and state/<work>/T001.json parses as
      TaskState with status pending and empty evidence.
    verified_by:
      - cmd: test
        selector: "task add > creates prose and kernel state together"
  - id: A2
    text: >
      Given T001 already exists, when `task add T001` runs again, then it exits
      2 and neither file is modified.
    verified_by:
      - cmd: test
        selector: "task add > refuses a duplicate task id"
  - id: A3
    text: >
      Given no open work item, when `task add T001` runs, then it exits 2 and
      creates nothing.
    verified_by:
      - cmd: test
        selector: "task add > refuses when no work item is open"
  - id: A4
    text: >
      Given `--depends T009` naming a task that does not exist, when task add
      runs, then it exits 2 naming the unknown dependency and creates nothing.
    verified_by:
      - cmd: test
        selector: "task add > refuses a dependency that does not exist"
```

### Out of scope

- Writing acceptance criteria. The template carries the shape; the model fills
  it in. Code owns ids and status, the model owns criterion text (§1).
- Validating criterion quality. That is the `planning` skill's job at G2.

---

## T402 — Start a task

**Type:** feature · **Skills:** `backend` · **Depends on:** T401

`craftpath task start <id>` is a thin shell over `transitions.start`, which
already refuses a blocked task and treats a repeat as resume.

Also the point where `produces` from done dependencies would be resolved, if
`PLAN-design-tasks.md` has landed. Noted, not assumed — see Q2.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given T001 pending with no dependencies, when task start runs, then its
      state status becomes in_progress.
    verified_by:
      - cmd: test
        selector: "task start > moves a pending task to in progress"
  - id: A2
    text: >
      Given T002 depending on a pending T001, when `task start T002` runs, then
      it exits 2, names T001 as the blocker, and T002 stays pending.
    verified_by:
      - cmd: test
        selector: "task start > refuses a blocked task and names the blocker"
  - id: A3
    text: >
      Given T001 already in_progress, when task start runs again, then it exits
      0 and the status is unchanged.
    verified_by:
      - cmd: test
        selector: "task start > starting twice is a resume not an error"
  - id: A4
    text: >
      Given T001 done, when task start runs, then it exits 2 and directs the
      caller to amend.
    verified_by:
      - cmd: test
        selector: "task start > refuses to restart a done task"
```

### Out of scope

- Launching a subagent or loading skills. That is the workflow layer's job; the
  CLI records state.
- Claiming or locking. D20 — no sessions; resume re-verifies.

---

## T403 — Execute a selector and record evidence

**Type:** feature · **Skills:** `backend` · **Depends on:** T401

**The load-bearing task in M1.** Everything else is bookkeeping around this one:
it is where a claim becomes evidence.

`craftpath task verify <id>` resolves each criterion's `verified_by` to a config
command, runs it with the selector applied, captures stdout and stderr to
`state/<work>/logs/<id>-<cmd>.log`, and appends an `Evidence` record with the
exit code, the log path, the current `config_hash`, and a timestamp.

### Four decisions

**The log is written before the evidence record.** Mechanism M3 has `validate`
re-read the log and check it against the recorded exit code, which only works if
a log exists for every evidence entry. Writing evidence first would allow a
crash to produce a record pointing at nothing.

**A non-zero exit is recorded, not discarded.** Failing evidence is evidence —
it is how `unsatisfied` stays honest and how a re-run shows improvement.
Discarding failures would make the absence of evidence and the presence of
failure indistinguishable.

**`config_hash` is captured at run time, not read later.** That is what makes
`isStale` meaningful: editing `config.toml` afterwards must invalidate what was
proven under the old commands.

**A selector-scoped criterion against a runner with no `selector_template` is
refused, not run whole.** `canRunSelector` from `PLAN-config-doctor.md` decides
this. Running the whole suite and recording it as proof of one criterion is
precisely the lie D5 exists to prevent — and `proves()` in `transitions.ts`
already refuses to let suite-wide evidence satisfy a selector-scoped criterion,
so running it would burn minutes to produce a record that cannot satisfy
anything.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a criterion verified by a configured command with a selector, when
      task verify runs, then an Evidence entry is appended carrying that cmd,
      that selector, the command's exit code, and the current config hash.
    verified_by:
      - cmd: test
        selector: "task verify > records exit code selector and config hash"
  - id: A2
    text: >
      Given the same, when task verify runs, then the log named by the evidence
      exists and contains the command's output.
    verified_by:
      - cmd: test
        selector: "task verify > writes the log the evidence points at"
  - id: A3
    text: >
      Given a command that exits 0 for a selector-scoped criterion, when task
      verify runs, then criterionSatisfied returns true for that criterion.
    verified_by:
      - cmd: test
        selector: "task verify > passing evidence satisfies its criterion"
  - id: A4
    text: >
      Given a command that exits 1, when task verify runs, then the evidence is
      still recorded, the criterion remains unsatisfied, and the task status is
      unchanged.
    verified_by:
      - cmd: test
        selector: "task verify > failing evidence is recorded and satisfies nothing"
  - id: A5
    text: >
      Given passing evidence and a subsequently edited config.toml, when
      criterionSatisfied is evaluated against the new hash, then it returns
      false.
    verified_by:
      - cmd: test
        selector: "task verify > editing config makes prior evidence stale"
  - id: A6
    text: >
      Given a selector-scoped criterion whose command has no selector_template,
      when task verify runs, then it exits 2 naming the command, and no
      evidence and no log are written.
    verified_by:
      - cmd: test
        selector: "task verify > refuses a selector a runner cannot scope"
  - id: A7
    text: >
      Given a criterion whose cmd is not present in config.toml, when task
      verify runs, then it exits 2 naming the missing command and writes
      nothing.
    verified_by:
      - cmd: test
        selector: "task verify > refuses a command the config does not define"
```

### Out of scope

- Parallel execution of commands. D14 — sequential by default.
- Retrying a failing command. A flaky suite is a defect to diagnose, not
  something the kernel papers over.
- Timeouts. `doctor` flags slow commands; killing a build mid-run is a different
  decision with its own failure modes.

---

## T404 — Acknowledge a manual criterion

**Type:** feature · **Skills:** `backend` · **Depends on:** T401

`craftpath task ack <id> <criterion>` records an `Ack` signed with `git
user.email`. `transitions.ack` already refuses a criterion that is verified by
command rather than manually.

The signature is the whole point: the schema comment says *"an unsigned ack
proves nothing"*. An ack carries a `config_hash` too, so a manual judgement made
under one configuration goes stale the same way evidence does.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a criterion verified by cmd manual, when task ack runs, then an Ack
      is appended carrying the git user.email and the current config hash, and
      criterionSatisfied returns true.
    verified_by:
      - cmd: test
        selector: "task ack > a signed ack satisfies a manual criterion"
  - id: A2
    text: >
      Given a criterion verified by a command rather than manually, when task
      ack runs, then it exits 2 and directs the caller to task verify.
    verified_by:
      - cmd: test
        selector: "task ack > refuses to ack a command-verified criterion"
  - id: A3
    text: >
      Given git user.email is unset, when task ack runs, then it exits 2 and no
      ack is recorded.
    verified_by:
      - cmd: test
        selector: "task ack > refuses to record an unsigned ack"
  - id: A4
    text: >
      Given a criterion id that the task does not have, when task ack runs,
      then it exits 2 naming the unknown criterion.
    verified_by:
      - cmd: test
        selector: "task ack > refuses an unknown criterion id"
```

### Out of scope

- Prompting for what was checked. The ack records who and when; what they looked
  at belongs in the task notes.
- Expiry. Staleness is by config hash, not by age.

---

## T405 — Complete a task

**Type:** feature · **Skills:** `backend` · **Depends on:** T403, T404

`craftpath task done <id>` calls `transitions.done`, which already enforces both
halves of M1's exit criterion: every criterion satisfied by non-stale evidence
or a signed ack, **and** a commit carrying `Task: <id>` present on the work
branch.

The CLI's job is to supply `inBranch` honestly:

```ts
const found = await Bun.$`git log --grep=${`Task: ${id}`} --format=%H`.quiet().nothrow();
const inBranch = found.exitCode === 0 && found.stdout.toString().trim().length > 0;
```

Depends on both T403 and T404 because "every criterion satisfied" is only
testable when both kinds of criterion can actually be satisfied.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given an in_progress task with one unsatisfied criterion, when task done
      runs, then it exits 2, lists the unsatisfied criterion ids, and the status
      stays in_progress.
    verified_by:
      - cmd: test
        selector: "task done > refuses while a criterion is unsatisfied"
  - id: A2
    text: >
      Given every criterion satisfied and no commit carrying the task trailer,
      when task done runs, then it exits 2 naming the missing trailer and the
      status stays in_progress.
    verified_by:
      - cmd: test
        selector: "task done > refuses when the trailer is absent from the branch"
  - id: A3
    text: >
      Given every criterion satisfied and a commit carrying `Task: T001`, when
      task done runs, then the status becomes done.
    verified_by:
      - cmd: test
        selector: "task done > completes with evidence and a trailer present"
  - id: A4
    text: >
      Given a task whose only passing evidence was recorded under a different
      config hash, when task done runs, then it exits 2 and the criterion is
      listed as unsatisfied.
    verified_by:
      - cmd: test
        selector: "task done > stale evidence does not complete a task"
```

### Out of scope

- Creating the commit. The agent commits; the kernel checks.
- Squash and rebase handling. D11 — the trailer is the anchor precisely so this
  survives them.

---

## T406 — Record a gate approval

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`craftpath approve <phase>` flips a gate in `work.json` to `approved`. §9's
warning is the reason this exists as a command: *"an approval that lives only in
the conversation is gone when the session dies."*

Records who approved and when, for the same reason acks are signed.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a work item with the plan gate pending, when `approve plan` runs,
      then work.json records it approved with the approver's git user.email.
    verified_by:
      - cmd: test
        selector: "approve > records a gate approval durably"
  - id: A2
    text: >
      Given a phase name that is not a gate, when approve runs, then it exits 4
      listing the valid gates.
    verified_by:
      - cmd: test
        selector: "approve > refuses a phase that is not a gate"
  - id: A3
    text: >
      Given a gate already approved, when approve runs again, then it exits 0
      and the original approver and timestamp are unchanged.
    verified_by:
      - cmd: test
        selector: "approve > re-approving does not overwrite the original record"
```

### Out of scope

- Evaluating `auto` / `auto_if_simple` policy. Deciding whether a gate *needs*
  a human is separate from recording that one approved it. See Q3.
- Revoking an approval. `amend` is the path that reopens work.

---

## T407 — Validate structure

**Type:** feature · **Skills:** `backend` · **Depends on:** T401

Real `craftpath validate`, replacing the M0 stub. §6.1's checks: schema
correctness, unique task ids, `depends_on` resolves, no cycles, referenced
artifacts exist, no impossible recorded transition, and **evidence logs exist
and match recorded exit codes** — mechanism M3, the real backstop, because
flipping `exit: 0` in a state file is otherwise free.

**A half-finished work item is structurally valid.** That is the point, and §6.1
calls conflating this with completion a bug in v1: this runs on the Stop hook,
and a Stop hook that fails blocks every legitimate pause.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a work item with one pending task and one in_progress task, when
      validate runs, then it exits 0.
    verified_by:
      - cmd: test
        selector: "validate > a half-finished work item is structurally valid"
  - id: A2
    text: >
      Given T001 depending on T002 and T002 depending on T001, when validate
      runs, then it exits 1 and names both tasks in the cycle.
    verified_by:
      - cmd: test
        selector: "validate > detects a dependency cycle"
  - id: A3
    text: >
      Given an evidence record whose log file does not exist, when validate
      runs, then it exits 1 naming the task and the missing log.
    verified_by:
      - cmd: test
        selector: "validate > evidence pointing at a missing log fails"
  - id: A4
    text: >
      Given an evidence record with exit 0 whose log shows a non-zero result,
      when validate runs, then it exits 1 naming the mismatch.
    verified_by:
      - cmd: test
        selector: "validate > a log disagreeing with its recorded exit code fails"
  - id: A5
    text: >
      Given a task file whose depends_on names a task that does not exist, when
      validate runs, then it exits 1 naming the dangling dependency.
    verified_by:
      - cmd: test
        selector: "validate > a dangling dependency fails"
```

### Out of scope

- Completion checks. T408.
- Repairing anything. T410.

---

## T408 — Validate completion

**Type:** feature · **Skills:** `backend` · **Depends on:** T405, T406, T407

`craftpath validate --complete`, run before result, PR and archive. §6.2: every
task done, every criterion satisfied by non-stale evidence or signed ack,
required gates approved, spec delta present and well-formed, and every done task
represented in the branch by its trailer.

The M0 stub already refuses correctly (exit 1, "completion is unproven"); this
replaces the refusal with a real check.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a work item with one task still in_progress, when validate
      --complete runs, then it exits 1 naming that task.
    verified_by:
      - cmd: test
        selector: "validate complete > refuses while a task is unfinished"
  - id: A2
    text: >
      Given every task done but the result gate pending, when validate
      --complete runs, then it exits 1 naming the unapproved gate.
    verified_by:
      - cmd: test
        selector: "validate complete > refuses while a required gate is pending"
  - id: A3
    text: >
      Given every task done and every gate approved but spec-delta.md absent,
      when validate --complete runs, then it exits 1 naming the missing artifact.
    verified_by:
      - cmd: test
        selector: "validate complete > refuses without a spec delta"
  - id: A4
    text: >
      Given every task done with non-stale evidence, every gate approved, and a
      well-formed spec delta, when validate --complete runs, then it exits 0.
    verified_by:
      - cmd: test
        selector: "validate complete > passes when everything is proven"
```

### Out of scope

- Applying the spec delta. That is `archive`, which is not in this plan.
- Generating the PR body.

---

## T409 — Amend a task

**Type:** feature · **Skills:** `backend` · **Depends on:** T405

`craftpath amend <id>` calls `transitions.amend`, which clears evidence and acks
and returns the task to pending. §10.3's reason: without a supported path, the
agent silently edits the approved plan and the gate may as well not exist.

Clearing evidence is not incidental — the criteria changed, so what was proven
was proven about something else.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a done task with evidence and an ack, when amend runs, then its
      status is pending and both evidence and acks are empty.
    verified_by:
      - cmd: test
        selector: "amend > clears evidence and reopens the task"
  - id: A2
    text: >
      Given an amended task, when the work item's changelog is read, then it
      records the task id, the reason, and when.
    verified_by:
      - cmd: test
        selector: "amend > records the amendment in the changelog"
  - id: A3
    text: >
      Given T001 amended and T002 done and independent of it, when amend runs,
      then T002 keeps its status and its evidence.
    verified_by:
      - cmd: test
        selector: "amend > leaves unaffected tasks untouched"
```

### Out of scope

- Reopening the plan gate. §10.3 says amendment re-opens G2 for affected tasks;
  wiring that to `approve` is a follow-on once gate policy exists (Q3).
- Cascading to dependents automatically. Naming which tasks are affected is a
  judgement, and guessing wrong either destroys good evidence or keeps bad.

---

## T410 — Reconcile state against the branch

**Type:** feature · **Skills:** `backend` · **Depends on:** T407

`craftpath reconcile [--fix]` re-derives state from branch history and evidence
logs, reports drift, and with `--fix` repairs it, logged.

§6.3 is explicit that this is **not optional**: *"A trusted kernel with no repair
tool gets bypassed within a week: the moment `validate` reports corruption with
no supported remedy, someone hand-edits the JSON, which is exactly what §1 exists
to prevent."*

Without `--fix` it only reports. Repair is a decision.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a task marked done whose trailer is absent from the branch, when
      reconcile runs, then it reports that drift and changes nothing.
    verified_by:
      - cmd: test
        selector: "reconcile > reports a done task with no trailer"
  - id: A2
    text: >
      Given the same, when reconcile --fix runs, then the task returns to
      in_progress and the repair is written to the changelog.
    verified_by:
      - cmd: test
        selector: "reconcile > fix reopens a task whose trailer vanished"
  - id: A3
    text: >
      Given state that matches the branch exactly, when reconcile runs, then it
      reports no drift and exits 0.
    verified_by:
      - cmd: test
        selector: "reconcile > clean state reports no drift"
  - id: A4
    text: >
      Given stale commits_hint entries, when reconcile runs, then they are
      refreshed and no status changes, since commits_hint is never semantic.
    verified_by:
      - cmd: test
        selector: "reconcile > refreshes commit hints without changing status"
```

### Out of scope

- Repairing corrupt JSON. If a state file will not parse, reconcile cannot know
  what it meant; that is a restore-from-git problem.
- Reconciling prose artifacts. Model space is the model's.

---

## Dependency graph

```
T401 ──┬──▶ T402
       ├──▶ T403 ──┬──▶ T405 ──┬──▶ T408
       ├──▶ T404 ──┘           └──▶ T409
       └──▶ T407 ──┬──▶ T408
                   └──▶ T410
T406 (independent) ────▶ T408
```

Waves: `[T401, T406]` → `[T402, T403, T404, T407]` → `[T405, T410]` → `[T408, T409]`.

**The critical path is T401 → T403 → T405 → T408.** T403 is the task to spend
care on: it is where a claim becomes evidence, and every completion check
downstream trusts what it wrote.

## Not in this plan

- **`archive`.** It applies the spec delta to `specs/` and moves the work item.
  It is the natural next task after T408 but it is the one irreversible operation
  in the system and deserves its own plan.
- **`pr body`.** Needs `doctor`'s health state (§8) to report which criteria were
  manually acknowledged, so it follows `PLAN-config-doctor.md`.
- **Gate policy evaluation.** T406 records approvals; deciding when one is
  *required* is Q3.
- **Parallel task execution.** D14, and M5 at the earliest.
- **Sessions or task claiming.** D20 — deliberately absent.
- **Any change to `transitions.ts`.** If a task here needs one, stop.

## Open questions

- **Q1 — should `task verify` run every criterion's command, or one?**
  `craftpath task verify T001` re-running the whole suite per criterion is
  wasteful when five criteria share a command. Deduplicating by command is
  obvious, but then one run produces evidence for several criteria and the
  `selector` field differs per criterion. Likely answer: group by
  `(cmd, selector)`, which is exactly what `proves()` matches on.
- **Q2 — does T402 resolve `produces` from dependencies?** That is T007 of
  `PLAN-design-tasks.md`. If that lands first, T402 is where it hooks in; if not,
  T402 ships without it and gains it later. Not a blocker either way, but worth
  sequencing deliberately rather than discovering the overlap mid-task.
- **Q3 — where does gate policy live?** `config.toml` has
  `plan = "auto_if_simple"` and nothing evaluates it. T406 records approvals
  without deciding when one is needed. Something has to read that setting and
  refuse to proceed past an unapproved required gate — probably T408, possibly a
  hook. Undecided, and the design plan's dropped Q2 is the same question.

---

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every scenario maps to a criterion | Pass — S1–S12 |
| 2 | Every criterion names a selector | Pass — 42 criteria, 0 manual |
| 3 | Every criterion could fail today | Pass — none of these commands exist |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — T401-A2/A3/A4 ("creates nothing"), T403-A6/A7 ("no evidence and no log"), T405-A1/A2 ("stays in_progress"), T409-A3 ("keeps its evidence"), T410-A1 ("changes nothing") |
| 6 | Verifiable without an unfinished sibling | Pass — T405 depends on T403 and T404 because its criterion genuinely needs both kinds of satisfaction to exist |
| 7 | Every depends_on edge would really fail | Pass |
| 8 | Skills match the work | Pass — `backend` throughout |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |

Ten tasks is large for one plan. It is one milestone with one exit criterion and
a single critical path, so splitting it would produce plans that cannot be
approved independently — but if execution drags, T409 and T410 are the two that
could be deferred without weakening M1's guarantee.
