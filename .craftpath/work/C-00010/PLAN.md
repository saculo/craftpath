# C-00010 — Engineering principles replace discipline skills: plan

## Goal

`init` ships five engineering principles -- `fix-root-causes`,
`boundary-discipline`, `laziness-protocol`, `foundational-thinking`,
`sequence-verifiable-units` -- on both harnesses; work, review and plan load
the ones they need; and the `backend`, `frontend` and `infrastructure` skills are
gone from fresh installs, retired from earlier ones unless edited, and named by
nothing installed.

## Approach

The repository has one module (`app`), so every task is its own wave: tasks in
one wave may not share a module. The order is set by what each task's tests
need, not by narrative:

1. **T-0001** adds the five skills first, so the existing test
   `every principle a step loads ships as a skill` stays green once a step loads
   them.
2. **T-0002, T-0003, T-0004** make work, review and plan load their principles,
   one step per task: each is a behaviour a user can read in one installed
   step and is reviewable on its own. Merging them was possible (same module,
   serial anyway); kept apart so each commit says which step changed. T-0004
   also removes the plan step's "Skills for the implementer" guidance -- the
   instruction to name skills and the skills it names go together, or the plan
   step would point at nothing.
3. **T-0005** removes every remaining pointer to the discipline skills
   (`test-first`, `ux`, `architecture`) and updates this repo's `CLAUDE.md`
   (spec, Assumptions). It comes after T-0004, whose plan text names `backend`.
4. **T-0006** stops shipping the three skills and retires them on re-init, in
   one task: deleting the assets without retiring them would leave stale copies
   in every upgraded project, and retiring without deleting cannot trigger. It
   comes last because, before T-0005, deleting them would leave installed
   skills pointing at skills that no longer exist.

Every task leaves `bun run test` green, and each re-runs
`bun bin/craftpath.ts init` in the worktree so the tracked installed copies
follow `assets/`.

## Tasks

### Wave 1

- [x] T-0001 — Ship the five engineering principles as skills

### Wave 2

- [x] T-0002 — Work brief loads the implementer's principles

### Wave 3

- [ ] T-0003 — Review step loads the review principles

### Wave 4

- [ ] T-0004 — Plan step loads the planning principles instead of naming skills

### Wave 5

- [ ] T-0005 — Drop every pointer to the discipline skills

### Wave 6

- [ ] T-0006 — Retire the discipline skills
