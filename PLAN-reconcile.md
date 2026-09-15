# Plan — reconcile state against the branch

**Status: DRAFT for review.** Written with the `planning` skill.
Replaces T410 of the removed M1 kernel plan, updated for what exists now:
amendments, archive, derived phase, and commit hints nothing writes yet.

## Requirement

The kernel already points people at a command that does not exist:

- both guards, on a refused write to `.craftpath/state/`: *"If the state is
  genuinely wrong, run: craftpath reconcile --fix"*
- `status`, on a work directory with no `work.json`: *"Run `craftpath reconcile`
  once it exists, or remove the directory."*

§6.3 is why this is not optional: a trusted kernel with no supported repair gets
bypassed the first time `validate` reports something nobody can fix — someone
hand-edits the JSON, which is exactly what the guards exist to prevent.

`craftpath reconcile` reports drift between recorded state and the repository.
`craftpath reconcile --fix` repairs what can be repaired and says what cannot.
Without `--fix` it writes nothing: repair is a decision.

### What counts as drift

| Drift | How it happens | Repairable |
|---|---|---|
| A done task whose `Task: <id>` trailer is not reachable from HEAD | rebase or squash that dropped the trailer, reset, force-push | Yes — back to `in_progress` |
| `state/<id>` whose work item is already in `archive/<id>` | `archive` interrupted between its two moves | Yes — finish the move |
| `work/<id>` with no `state/<id>/work.json` | `work new` interrupted mid-scaffold | No — nothing says what it meant |

### Decisions

| # | Decision | Why |
|---|---|---|
| R1 | Drift exits 1, no drift exits 0 | CI and the agent can branch on it, same contract as `validate`. |
| R2 | A reopened task keeps its evidence and acks | The proof was about code that still exists; only the link to the branch is gone. Recommitting with the trailer and running `task done` completes it again. |
| R3 | Repairs are written to `changelog.md`, not recorded as amendments | The plan did not change, so the gates must not reopen. |
| R4 | `commits_hint` is never drift | The schema says hints are never semantic. Refreshing them is housekeeping `--fix` does, not something plain `reconcile` reports. |

### Scenarios

| # | Scenario | Covered by |
|---|---|---|
| S1 | A rebase drops a trailer; reconcile says which task lost it | T601-A1 |
| S2 | State that matches the repository reports nothing | T601-A2 |
| S3 | The crash cases `status` and `archive` can leave behind are named | T601-A3, A4 |
| S4 | `--fix` reopens the task and finishes an interrupted archive | T602-A1, A2 |
| S5 | `--fix` refuses to guess at what it cannot know | T602-A3 |
| S6 | Commit hints exist and survive a rebase | T603-A1, A2 |
| S7 | The work command says when to reconcile | T604 |

---

## T601 — Report drift

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`craftpath reconcile` checks the three kinds of drift above and prints one line
per finding. Writes nothing.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given T001 done and no commit carrying `Task: T001` reachable from HEAD,
      when reconcile runs, then it exits 1, names T001 and the missing trailer,
      and T001.json is byte-for-byte unchanged.
    verified_by:
      - cmd: test
        selector: "reconcile > reports a done task with no trailer"
  - id: A2
    text: >
      Given an open work item whose done tasks all have their trailer on the
      branch, when reconcile runs, then it exits 0 and reports no drift.
    verified_by:
      - cmd: test
        selector: "reconcile > clean state reports no drift"
  - id: A3
    text: >
      Given work/0001-avatar-upload with no state/0001-avatar-upload/work.json,
      when reconcile runs, then it exits 1 naming that directory.
    verified_by:
      - cmd: test
        selector: "reconcile > reports a work directory with no state"
  - id: A4
    text: >
      Given archive/0001-avatar-upload present and state/0001-avatar-upload
      still in place, when reconcile runs, then it exits 1 naming an
      interrupted archive, and both directories stay where they are.
    verified_by:
      - cmd: test
        selector: "reconcile > reports an interrupted archive"
```

### Out of scope

- Evidence whose log disagrees with its exit code. That is tampering, not drift;
  `validate` reports it and the fix is restoring from git.
- A work branch that was never created. `work new` creates it best effort, and
  trailers — not branch names — are the anchor.

---

## T602 — Repair drift

**Type:** feature · **Skills:** `backend` · **Depends on:** T601

`craftpath reconcile --fix` repairs the two repairable kinds, reports the third,
and exits 0 only when nothing is left.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given T001 done with evidence and an ack but no reachable trailer, when
      reconcile --fix runs, then T001 is in_progress with its evidence and ack
      kept, changelog.md names T001 and the missing trailer, and work.json
      records no amendment.
    verified_by:
      - cmd: test
        selector: "reconcile > fix reopens a task whose trailer vanished"
  - id: A2
    text: >
      Given an interrupted archive of 0001-avatar-upload, when reconcile --fix
      runs, then archive/0001-avatar-upload/state/work.json exists and
      state/0001-avatar-upload does not.
    verified_by:
      - cmd: test
        selector: "reconcile > fix finishes an interrupted archive"
  - id: A3
    text: >
      Given work/0001-avatar-upload with no work.json, when reconcile --fix
      runs, then it exits 1, the directory is still present, and the output
      says to remove it by hand.
    verified_by:
      - cmd: test
        selector: "reconcile > fix leaves a work directory it cannot interpret"
  - id: A4
    text: >
      Given a vanished trailer repaired by reconcile --fix, when reconcile runs
      again without --fix, then it exits 0.
    verified_by:
      - cmd: test
        selector: "reconcile > a fixed repository reconciles clean"
```

### Out of scope

- Reopening gates (R3).
- Repairing a state file that will not parse. Reconcile cannot know what it
  meant; restore it from git.

---

## T603 — Record commit hints

**Type:** feature · **Skills:** `backend` · **Depends on:** T602

`git.commits_hint` exists in the schema, described as "refreshed by reconcile",
and nothing writes it. `task done` records the short SHAs of the commits
carrying the trailer; `reconcile --fix` refreshes them after history is
rewritten. Plain `reconcile` ignores them (R4).

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given T001 whose trailer is on commit C, when task done completes T001,
      then its commits_hint is exactly [short SHA of C].
    verified_by:
      - cmd: test
        selector: "reconcile > task done records the trailer commits as hints"
  - id: A2
    text: >
      Given T001 done with a hint for commit C, and C amended into C2 keeping
      the trailer, when reconcile --fix runs, then commits_hint is exactly
      [short SHA of C2] and T001 is still done.
    verified_by:
      - cmd: test
        selector: "reconcile > fix refreshes hints without changing status"
  - id: A3
    text: >
      Given the same stale hint, when reconcile runs without --fix, then it
      exits 0 and T001.json is byte-for-byte unchanged.
    verified_by:
      - cmd: test
        selector: "reconcile > stale hints are not drift"
```

### Out of scope

- Using hints for anything. They stay a convenience for humans reading state.

---

## T604 — Describe reconcile in the work command

**Type:** docs · **Skills:** `backend` · **Depends on:** T601, T602

With reconcile built there is nothing unbuilt left, so the "Not built yet"
notice goes. The command says when to reconcile: `validate` or `task done`
reporting a missing trailer, typically after a rebase — and to read the plain
report before running `--fix`.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the rendered work command, when it is searched, then it contains no
      "Not built yet" notice.
    verified_by:
      - cmd: test
        selector: "generated slash commands > has no unbuilt notice"
  - id: A2
    text: >
      Given the rendered work command, when it is searched, then it names
      craftpath reconcile for a missing trailer and says to run it without
      --fix before running it with --fix.
    verified_by:
      - cmd: test
        selector: "generated slash commands > says when to reconcile"
```

### Out of scope

- Changing the guards' messages. They already point at `reconcile --fix`.

---

## Dependency graph

```
T601 ──▶ T602 ──┬──▶ T603
                └──▶ T604
T601 ───────────────▶ T604
```

Waves: `[T601]` → `[T602]` → `[T603, T604]`.

The existing test "names only the genuinely unbuilt commands as unbuilt" asserts
the notice exists; T604 replaces it rather than leaving it to fail.

## Open questions

- **Q1 — should `validate` suggest reconcile?** When `validate --complete`
  reports a done task with no trailer, pointing at `craftpath reconcile` would
  close the loop. Small, but it changes `validate`'s messages, so it is left out
  unless wanted.

---

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every scenario maps to a criterion | Pass — S1–S7 |
| 2 | Every criterion names a selector | Pass — 13 criteria, 0 manual |
| 3 | Every criterion could fail today | Pass — `reconcile` does not exist and nothing writes hints; T604-A1 fails because the notice is present |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — T601-A1/A3 "byte-for-byte unchanged", T601-A4 "stay where they are", T602-A1 "no amendment", T602-A3 "still present", T603-A3 "unchanged" |
| 6 | Verifiable without an unfinished sibling | Pass |
| 7 | Every depends_on edge would really fail | Pass — T602 extends T601's detection; T603-A2 runs `--fix`; T604 describes both |
| 8 | Skills match the work | Pass — `backend` throughout |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |
| 11 | Design tasks are consumed | N/A |
