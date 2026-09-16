# Plan — finish the work pipeline

**Status: APPROVED, questions resolved. Ready to execute.** Written with the `planning` skill.
Makes `/craftpath:work` runnable end to end: resume, amend, PR, archive.
Supersedes T409 of `PLAN-m1-kernel.md`. T410 (reconcile) is deferred.

## Requirement

After T407/T408 the pipeline runs from `work new` to `validate --complete`. Four
gaps remain between that and a merged, archived work item:

1. `phase` in `work.json` has no writer, so resume cannot work.
2. There is no amend path, yet the work command sends the agent to one whenever a
   criterion cannot be turned into a test or the plan must change.
3. `craftpath pr body` does not exist; phase 8 pipes it into `gh pr create`.
4. `craftpath archive` does not exist; phase 9 runs it.

And one found while planning: evidence logs are gitignored, but `validate`
requires them — so it fails on every fresh clone and in CI.

### Decisions (settled in review)

| # | Decision | Why |
|---|---|---|
| D1 | `phase` is derived from approvals and task status, never stored | Nothing writes it; a writer the agent calls is an unchecked claim. Same reasoning as gate state. |
| D2 | `craftpath amend <id> --reason "<why>"`; reason required | The changelog entry needs it. |
| D3 | An amendment newer than a gate's approval makes that gate pending again — plan and result, not requirement | Derived, so no approval record is ever deleted or rewritten. A task-level change does not change the requirement. |
| D4 | `task add` after plan approval is an amendment: it requires `--reason` and reopens the gates | Simplest rule that still works. Refusing outright would break `/craftpath:pr`'s accept-and-fix, which adds tasks after approval. |
| D5 | `pr body` is fully generated from disk; no judgment sections | Easiest. The agent or human can still edit the PR description afterwards. |
| D6 | `archive` only moves the work item; living specs are not touched | Simplest thing that works. The delta format carries IDs, not requirement text or target files, so it cannot be applied mechanically without a format change nobody needs yet. |
| D7 | Amend does not preserve old logs | Explicitly not a concern for now. |

### Scenarios

| # | Scenario | Covered by |
|---|---|---|
| S1 | A verified work item validates on a fresh clone | T501-A2 |
| S2 | `status` reports the phase the recorded state implies | T502-A1..A5 |
| S3 | A gate cannot be approved before the gate ahead of it | T503-A1, A2 |
| S4 | Amending a task reopens it and the plan and result gates | T504-A1, A4 |
| S5 | A review fix adds a task after approval without bypassing the gate | T505-A1, A2 |
| S6 | The PR body shows how every criterion was proven | T506-A2, A3 |
| S7 | A completed work item is archived and its id is never reused | T507-A2, A3 |
| S8 | The work command describes only commands that exist, as they behave | T508 |

---

## T501 — Commit evidence logs

**Type:** fix · **Skills:** `backend` · **Depends on:** —

`init` writes `.craftpath/.gitignore` containing `state/*/logs/`, with the comment
"state/ is committed: without it ... CI cannot validate. Logs are noise." But
`validate` (mechanism M3) fails any evidence whose log is absent — so ignoring
logs is exactly what stops CI validating. It also makes T507 leave untracked log
files behind, since the ignore pattern does not match `archive/`.

Stop ignoring them. `init` no longer writes the rule.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a fresh directory, when init runs, then no file under .craftpath
      contains an ignore rule matching state logs.
    verified_by:
      - cmd: test
        selector: "init > leaves evidence logs tracked"
  - id: A2
    text: >
      Given a work item with T001 verified and everything committed, when the
      repo is cloned and validate runs in the clone, then it exits 0.
    verified_by:
      - cmd: test
        selector: "validate > passes on a fresh clone of a verified work item"
```

### Out of scope

- Removing the rule from repos already initialised. `init` keeps an existing
  `.gitignore`; delete the line by hand.
- Size limits or truncation of large logs.

---

## T502 — Derive the phase from recorded state

**Type:** feature · **Skills:** `backend` · **Depends on:** —

Remove `phase` from `WorkState`. A pure `derivePhase(work, tasks)` gives the
phase, in gate order:

| Condition, checked in order | Phase |
|---|---|
| requirement gate pending | `requirement` |
| plan gate pending | `plan` (covers understand, design, plan — disk cannot tell them apart) |
| no tasks, or any task not done | `execute` |
| result gate pending | `result` |
| otherwise | `pr` |

`status` and `status --brief` print it. `Phase` shrinks to these five values.

A `work.json` written before this change still carries `phase`; it must load and
the stored value must be ignored, or every existing work item is bricked by
`.strict()`.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a work item with no approvals, when derivePhase runs, then it
      returns requirement.
    verified_by:
      - cmd: test
        selector: "phase > no approvals is the requirement phase"
  - id: A2
    text: >
      Given only the requirement gate approved, when derivePhase runs, then it
      returns plan.
    verified_by:
      - cmd: test
        selector: "phase > an approved requirement moves to plan"
  - id: A3
    text: >
      Given requirement and plan approved and T001 in_progress, when
      derivePhase runs, then it returns execute.
    verified_by:
      - cmd: test
        selector: "phase > an approved plan with unfinished tasks is execute"
  - id: A4
    text: >
      Given requirement and plan approved and every task done, when
      derivePhase runs, then it returns result; and with the result gate also
      approved it returns pr.
    verified_by:
      - cmd: test
        selector: "phase > finished tasks move to result then pr"
  - id: A5
    text: >
      Given a work.json carrying phase execute and no approvals, when status
      runs, then it exits 0 and reports phase requirement.
    verified_by:
      - cmd: test
        selector: "phase > ignores a phase stored by older work state"
```

### Out of scope

- Distinguishing understand, clarify and design. The agent reads the artifacts.
- Amendments reopening gates. That is T504; this task derives from whatever
  gate state says.

---

## T503 — Refuse out-of-order gate approvals

**Type:** feature · **Skills:** `backend` · **Depends on:** —

With D1, an approval out of order produces a phase that makes no sense — plan
approved with the requirement pending. `approve` refuses a gate whose
predecessor is pending, and refuses the plan gate when there are no tasks,
since that approves a plan with nothing in it.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the requirement gate pending, when `approve plan` runs, then it
      exits 2 naming requirement, and no approval is recorded.
    verified_by:
      - cmd: test
        selector: "approve > refuses plan before requirement"
  - id: A2
    text: >
      Given requirement approved and plan pending, when `approve result` runs,
      then it exits 2 naming plan, and no approval is recorded.
    verified_by:
      - cmd: test
        selector: "approve > refuses result before plan"
  - id: A3
    text: >
      Given requirement approved and no tasks, when `approve plan` runs, then
      it exits 2 saying there are no tasks, and no approval is recorded.
    verified_by:
      - cmd: test
        selector: "approve > refuses a plan with no tasks"
```

### Out of scope

- Refusing `approve result` while tasks are unfinished. `validate --complete`
  already catches that, and D1 derives `execute` regardless.

---

## T504 — Amend a task

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`craftpath amend <id> --reason "<why>"`:

- task state returns to `pending`, evidence and acks cleared (`transitions.amend`)
- an `Amendment { task, reason, by, at }` is appended to `work.json` — signed
  with git user.email, like approvals
- an entry is appended to `changelog.md` for humans

Gate state becomes `approved` only when an approval exists **and** no amendment
is newer than it (D3), for the plan and result gates. One `gateState` function
answers this for `approve`, `status` and `validate --complete` — `status`
currently has its own copy in `gateSummary`, which must go.

Re-approving a reopened gate appends a new approval; the original record stays.

**Six criteria, above the five the sizing rule flags. Kept as one:** clearing
evidence without reopening the gates would ship an amend that leaves an approved
plan silently covering changed work — the exact bypass amend exists to close.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given T001 done with evidence and an ack, when amend T001 runs with a
      reason, then T001 is pending with empty evidence and acks.
    verified_by:
      - cmd: test
        selector: "amend > clears evidence and reopens the task"
  - id: A2
    text: >
      Given T001 amended with reason 'criterion could not fail', when
      changelog.md is read, then it contains T001 and that reason.
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
  - id: A4
    text: >
      Given all three gates approved, when amend T001 runs, then status --brief
      reports plan and result pending and requirement still approved.
    verified_by:
      - cmd: test
        selector: "amend > reopens the plan and result gates"
  - id: A5
    text: >
      Given T001 done, when `craftpath amend T001` runs with no --reason, then
      it exits 4 and T001 is still done.
    verified_by:
      - cmd: test
        selector: "amend > refuses without a reason"
  - id: A6
    text: >
      Given the plan gate reopened by an amendment, when `approve plan` runs,
      then the gate reads approved and work.json holds both approval records.
    verified_by:
      - cmd: test
        selector: "amend > re-approving after an amendment closes the gate again"
```

### Out of scope

- Cascading to dependents. Which tasks an amendment affects is a judgement.
- Keeping old logs (D7).
- Amending the requirement itself.

---

## T505 — Treat a task added after plan approval as an amendment

**Type:** feature · **Skills:** `backend` · **Depends on:** T504

When the plan gate is approved, `task add` requires `--reason`, and records an
amendment for the new task id through the same path as T504 — which reopens the
plan and result gates. Before plan approval nothing changes.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the plan gate approved, when `task add T002 --title ... --reason
      'review: missing 413'` runs, then T002 exists and the plan gate reads
      pending.
    verified_by:
      - cmd: test
        selector: "task add > after plan approval records an amendment"
  - id: A2
    text: >
      Given the plan gate approved, when task add T002 runs without --reason,
      then it exits 2 naming --reason and creates no task file and no state.
    verified_by:
      - cmd: test
        selector: "task add > after plan approval refuses without a reason"
  - id: A3
    text: >
      Given the plan gate pending, when task add T002 runs without --reason,
      then T002 is created and work.json records no amendment.
    verified_by:
      - cmd: test
        selector: "task add > before plan approval needs no reason"
```

### Out of scope

- Removing a task. Not needed by any current flow.

---

## T506 — Generate the PR body

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`craftpath pr body` prints markdown to stdout, and refuses (exit 1, nothing on
stdout) unless `validate --complete` passes — so it can be piped straight into
`gh pr create --body-file -` without ever producing a body for unproven work.

All sections are generated (D5):

- **What** — the work title and the `## Problem` section of `requirement.md`
- **Tasks** — one row per criterion: task, criterion id, what proved it
  (`cmd selector`, or `acked by <email>`)
- **Verification** — counts of command-proven vs acked criteria, naming every
  acked one plainly, so a reviewer sees what rests on a human's word
- **Spec changes** — `spec-delta.md` with guidance comments stripped

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a work item with T001 in_progress, when pr body runs, then it exits
      1 and writes nothing to stdout.
    verified_by:
      - cmd: test
        selector: "pr body > refuses while completion is unproven"
  - id: A2
    text: >
      Given a complete work item whose T001 A1 was proven by cmd test with
      selector 'T001 works', when pr body runs, then the Tasks section has a
      row containing T001, A1 and 'T001 works'.
    verified_by:
      - cmd: test
        selector: "pr body > lists what proved each criterion"
  - id: A3
    text: >
      Given a complete work item whose A1 was acked by dev@example.com, when pr
      body runs, then the Verification section names A1 as acknowledged by
      dev@example.com.
    verified_by:
      - cmd: test
        selector: "pr body > names manually acknowledged criteria"
  - id: A4
    text: >
      Given a spec-delta.md with a guidance comment and the line
      '- AVATAR-R1 — upload an avatar', when pr body runs, then the Spec
      changes section contains that line and no '<!-- guidance'.
    verified_by:
      - cmd: test
        selector: "pr body > includes the spec delta without guidance"
  - id: A5
    text: >
      Given a requirement.md whose Problem section reads 'Users cannot set an
      avatar', when pr body runs, then What contains that sentence and not the
      Scenarios heading.
    verified_by:
      - cmd: test
        selector: "pr body > takes What from the requirement problem"
```

### Out of scope

- Start here, Decisions and Out of scope sections. They need judgement; edit the
  PR description if they matter.
- Creating the PR or pushing. `gh` does that.
- The unused `pr-body` template. Left in place.

---

## T507 — Archive a completed work item

**Type:** feature · **Skills:** `backend` · **Depends on:** T501

`craftpath archive`, run on the work branch as the last commit before merge,
so the archive lands through the PR and nobody pushes to the default branch
(Q2). Refuses unless `validate --complete` passes. Moves `work/<id>` to `archive/<id>` and
`state/<id>` to `archive/<id>/state`. Does not touch `specs/` (D6) and does not
commit — the agent commits the move.

Depends on T501: with logs ignored, the moved logs become untracked files and the
tree is left dirty after every archive.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a work item with T001 in_progress, when archive runs, then it exits
      1 and work/<id> and state/<id> are still in place.
    verified_by:
      - cmd: test
        selector: "archive > refuses while completion is unproven"
  - id: A2
    text: >
      Given a complete work item, when archive runs, then
      archive/<id>/requirement.md and archive/<id>/state/work.json exist, and
      work/<id> and state/<id> do not.
    verified_by:
      - cmd: test
        selector: "archive > moves the work item and its state"
  - id: A3
    text: >
      Given 0001-avatar-upload archived, when work new runs, then it succeeds
      and allocates 0002.
    verified_by:
      - cmd: test
        selector: "archive > frees the slot without reusing the id"
```

### Out of scope

- Applying the spec delta to `specs/` (D6).
- Archiving on the default branch after merge (Q2).
- Un-archiving.

---

## T508 — Describe the finished pipeline in the work command

**Type:** docs · **Skills:** `backend` · **Depends on:** T502, T504, T505, T506, T507

The command text must match what exists, test-first like the last two command
fixes:

- resume at the phase `craftpath status` reports
- every amend is `craftpath amend <id> --reason "..."` — work and PR commands
- the PR command's accept-and-fix adds the task with `--reason`
- archive moves the work item and does not update specs
- the unbuilt notice names only `reconcile`

Depends on every feature it describes: text written ahead of a command is the
drift the notice test exists to catch.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the rendered work and PR commands, when every 'craftpath amend'
      occurrence is inspected, then each is followed by a task id and --reason.
    verified_by:
      - cmd: test
        selector: "generated slash commands > every amend example names a task and a reason"
  - id: A2
    text: >
      Given the rendered PR command, when its accept-and-fix row is read, then
      the task add there carries --reason.
    verified_by:
      - cmd: test
        selector: "generated slash commands > review fixes add tasks as amendments"
  - id: A3
    text: >
      Given the rendered work command, when its archive section is read, then it
      does not say archive applies the delta and does say specs are not updated.
    verified_by:
      - cmd: test
        selector: "generated slash commands > describes archive as a move not a spec update"
  - id: A4
    text: >
      Given the rendered work command, when the unbuilt notice is read, then it
      names reconcile and none of amend, pr body or archive.
    verified_by:
      - cmd: test
        selector: "generated slash commands > names only the genuinely unbuilt commands as unbuilt"
  - id: A5
    text: >
      Given the rendered work command, when the resume step is read, then it
      says to resume at the phase craftpath status reports.
    verified_by:
      - cmd: test
        selector: "generated slash commands > resumes at the phase status reports"
```

### Out of scope

- Rewriting the workflow table. Its rows stay; only the resume wording changes.

---

## Dependency graph

```
T501 ─────────────────────────▶ T507 ──┐
T502 ──────────────────────────────────┤
T503 (independent)                     ├──▶ T508
T504 ──▶ T505 ─────────────────────────┤
T506 ──────────────────────────────────┘
```

Waves: `[T501, T502, T503, T504, T506]` → `[T505, T507]` → `[T508]`.

T503 feeds nothing: it keeps derived phases sensible but nothing downstream
fails without it.

## Not in this plan

- **`reconcile`** (T410). Later, by decision.
- **Defining `auto_if_simple`.** It still behaves as manual.
- **Applying spec deltas to living specs.** D6.

## Open questions

- ~~**Q1 — commit logs (T501)?**~~ **Resolved: yes.** Ignored logs mean
  `validate` passes only on the machine that ran the tests, and skipping the
  check instead removes the only thing stopping a hand-edited `exit: 0`.
- ~~**Q2 — where does the archive commit go?**~~ **Resolved: on the work branch,**
  after review is done, as the PR's last commit. The alternative — on the
  default branch after merge — needs a direct push to it, which a protected
  branch refuses. Not tracking the archive at all is not an option: `work new`
  allocates ids by scanning `archive/`, so a clone without it reissues 0001 and
  every trailer, branch name and log path carrying that id becomes ambiguous.
  Cost of the recommendation: once archived there is no open work item, so a
  late review comment needs `work new` for a follow-up rather than `task add`.

---

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every scenario maps to a criterion | Pass — S1–S8 |
| 2 | Every criterion names a selector | Pass — 29 criteria, 0 manual |
| 3 | Every criterion could fail today | Pass — none of the commands, fields or text exist; T501-A2 fails because logs are not in the clone |
| 4 | One trigger, concrete observable outcome | Pass — T502-A4 and T504-A4 check two outcomes of one trigger |
| 5 | Criteria that forbid an effect say so | Pass — T503 "no approval is recorded", T504-A5 "still done", T505-A2 "creates no task file and no state", T506-A1 "nothing to stdout", T507-A1 "still in place" |
| 6 | Verifiable without an unfinished sibling | Pass |
| 7 | Every depends_on edge would really fail | Pass — T505 needs T504's amendment record; T507 dirties the tree without T501; T508's tests assert text about built commands |
| 8 | Skills match the work | Pass — `backend` throughout; T508 is text but its tests are unit tests in this codebase |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |
| 11 | Design tasks are consumed | N/A — no design tasks |
