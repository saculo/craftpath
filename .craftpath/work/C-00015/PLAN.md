# C-00015 — Verify replaces review: plan

## Goal

`/craftpath-verify` replaces `/craftpath-review` on both harnesses: it runs
the tests first, has one agent propose findings and a second, fresh agent try
to refute them, and writes only confirmed findings -- each with a `file:line`
and a concrete failure scenario that `check.py verify` enforces -- into a
`VERIFY.md` that pr and learn gate on. Nothing installed still names review.

## Approach

Verify is built beside review, then the consumers switch, then review goes:
every commit leaves a flow that works end to end. First the data shape --
what a `VERIFY.md` point must hold (T-0001); then the guard (T-0002) and the
script that writes `VERIFY.md` (T-0003); then the installed step with its
finder and refuter (T-0004); then learn (T-0005) and pr (T-0006) read
`VERIFY.md`; last, review is removed from the assets, from installed projects
and from the docs (T-0007).

The project has one module, `app` (the whole repository, `bun run test`), so
no two tasks can share a wave: the plan is seven waves of one task each. The
order above is the dependency order; T-0002 depends on nothing and is placed
second only because every wave holds one task.

Decided for the whole plan: verify runs in the user's session, like work, not
forked as review was -- a forked step's subagents do not wait for it, and
verify chains two. That is why verify's model and effort go to its two agents
and not to its own front matter (T-0004).

## Tasks

### Wave 1

- [x] T-0001 — Require a failure scenario in every verify point

### Wave 2

- [x] T-0002 — Refuse verify until every task is committed

### Wave 3

- [x] T-0003 — Run tests first, then bind VERIFY.md to HEAD

### Wave 4

- [ ] T-0004 — Install the verify step: find, then refute

### Wave 5

- [ ] T-0005 — Gate learn on VERIFY.md

### Wave 6

- [ ] T-0006 — Gate the pull request on VERIFY.md

### Wave 7

- [ ] T-0007 — Retire the review step
