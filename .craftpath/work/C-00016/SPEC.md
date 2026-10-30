# C-00016 — Verify triages and fixes findings

## Problem

Every finding verify reports blocks the PR and waits for the user, though most
are clear bugs or missing tests the flow could fix itself. The user wants to be
asked only about what gets built (scope, intent, unsettled user-visible
behaviour), not about how a confirmed bug is repaired. Today the severity tag
(`major|minor`) says how bad a finding is, not what happens next, so the user
has to read and route every one.

## Scenarios

### S1 — A finding carries a category that says what happens next

- **Given** verify has a confirmed finding
- **When** it writes `VERIFY.md`
- **Then** the finding line is tagged `[fix]`, `[you]` or `[noted]`; a finding
  tagged `[major]` or `[minor]` is rejected by `check verify`

### S2 — Confirmed problems are `[fix]` by default

- **Given** a confirmed missing test for a scenario in `SPEC.md`
- **When** verify categorises it
- **Then** it is tagged `[fix]`, not `[you]`

### S3 — A scope, intent or unsettled-behaviour finding is `[you]`

- **Given** a confirmed finding whose fix would change what the spec leaves
  unsettled (for example, which of two user-visible outputs is right)
- **When** verify categorises it
- **Then** it is tagged `[you]`, and no task is made from it

### S4 — A real finding not worth a change is `[noted]`

- **Given** a confirmed finding that is real but not worth changing code for
- **When** verify categorises it
- **Then** it is tagged `[noted]`, and no task is made from it

### S5 — Verify turns open `[fix]` findings into tasks and runs them

- **Given** `VERIFY.md` has two open `[fix]` findings, one `[you]` and one
  `[noted]`
- **When** verify finishes writing `VERIFY.md`
- **Then** verify-fix adds exactly two tasks, one per `[fix]` finding; work
  runs them; verify runs again on the new commits; the `[you]` and `[noted]`
  findings produced no task

### S6 — The loop stops when no `[fix]` finding is open

- **Given** the second verify round finds no open `[fix]` finding
- **When** that round ends
- **Then** verify stops without a third round and reports the findings still
  open (`[you]`) and the `[noted]` ones

### S7 — The loop stops after 2 rounds

- **Given** a fix made in round 1 causes a new `[fix]` finding, and round 2
  still ends with an open `[fix]` finding
- **When** round 2 ends
- **Then** verify starts no further fix round, stops, and reports the open
  `[fix]` findings by id; no loop continues

### S8 — verify-fix ignores everything but `[fix]`

- **Given** `VERIFY.md` with open `[you]` and `[noted]` findings and no open
  `[fix]` finding
- **When** verify-fix runs
- **Then** it adds no task and says there is nothing to fix

### S9 — The user answers a `[you]` finding by retagging or declining it

- **Given** an open `[you]` finding `V2`
- **When** the user retags it `[fix]`, or marks it `[-]` with a reason
  `(won't fix: <reason>)`, and runs verify again
- **Then** a retagged `V2` is fixed by the loop like any `[fix]`; a `[-]`
  `V2` is left as the user wrote it and blocks nothing; no new command is
  needed

### S10 — Only open `[fix]` and `[you]` findings block the PR

- **Given** `VERIFY.md` with an open `[fix]` or `[you]` finding
- **When** the user runs pr
- **Then** pr refuses and names the blocking findings
- **Given** `VERIFY.md` whose only open findings are `[noted]`
- **When** the user runs pr
- **Then** pr proceeds, and the PR body lists each `[noted]` finding

### S11 — Same behaviour on Claude Code and pi

- **Given** the flow installed for Claude Code, and again for pi
- **When** each is initialised from `assets/`
- **Then** both carry the same categories, the same fix loop with the same
  2-round cap, and the same PR gating

## Out of scope

- More than 2 rounds, or a configurable cap.
- Reading `DECISIONS.md`.
- A benchmark of verify's accuracy.
- A new command for answering a `[you]` finding.
- Changing how findings are found or refuted (C-00015).

## Assumptions

- This work builds on `/craftpath-verify`, `VERIFY.md` and `/craftpath-verify-fix`
  as C-00015 defines them (the request names them); it lands after C-00015.
  Reason: the request speaks of verify and VERIFY.md, which exist only there.
- A round is one verify followed by its fix pass and work run; the cap counts
  verify runs inside one invocation, so the user re-running verify after
  answering a `[you]` finding starts a fresh invocation with its own 2 rounds.
  Reason: the cap exists to stop a fix that causes findings from looping, not
  to limit the user's own re-runs.
- Findings already `[x]` solved or `[-]` won't fix keep their existing form
  and never block, as today.
- Blocking `[you]` and `[fix]` findings is the same refusal pr gives open
  points today, extended to the new tags.

## Open questions

None
