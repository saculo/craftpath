# C-00016 — Verify triages and fixes findings: plan

## Goal

Every confirmed verify finding carries a category -- `[fix]`, `[you]` or `[noted]` -- instead of a severity. Verify turns open `[fix]` findings into tasks, runs them and verifies again, up to 2 rounds, on both harnesses; the user is asked only about `[you]` findings, and pr is blocked only by open `[fix]` and `[you]` ones.

## Approach

Built on C-00015's verify (this item lands after it), in dependency order, each task leaving a working flow. First the data shape every other task reads: the point line with its category and the check that enforces it (T-0001). Then the consumers of the category, one script at a time: the shared gate that pr, learn and verify use (T-0002), and verify-fix (T-0003). Then the step text that makes the agent categorise (T-0004), the mechanical 2-round cap (T-0005), and last the loop that ties verify, verify-fix and work together (T-0006).

The project has one module, `app`, so no two tasks can share a wave: six waves of one task each, in the order above.

Decided for the whole plan: the point id stays `F<n>` as C-00015 built it, not the `V<n>` the spec's S9 writes. The 2-round cap is enforced by `verify.py --round <n>` refusing round 3, not only by the step's prose, since a model counting its own rounds is what the cap guards against. Choosing between `[fix]`, `[you]` and `[noted]` is the agent's judgement, proven on the installed step text and enforced only as to the tag's presence; no script can tell a bug from an unsettled behaviour. Not split further: categorising and looping are separate tasks because the first is useful alone (the user sees what needs them) and the second needs the cap.

## Tasks

### Wave 1

- [x] T-0001 — Tag verify points fix, you or noted

### Wave 2

- [x] T-0002 — Block the pull request on fix and you points only

### Wave 3

- [x] T-0003 — Fix only the fix points

### Wave 4

- [ ] T-0004 — Teach verify to categorise findings

### Wave 5

- [ ] T-0005 — Refuse a third verify round

### Wave 6

- [ ] T-0006 — Loop verify and fix for two rounds
