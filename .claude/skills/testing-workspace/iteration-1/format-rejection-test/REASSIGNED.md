# This case moved to `backend` after iteration 1

**Case:** `format-rejection-test` ("unsupported formats return 415 before any
storage write — write me the test that proves it")

**Now defined in:** `.claude/skills/backend/evals/evals.json`, id 3.

## Why

The `testing` skill was narrowed after iteration 1. It now covers end-to-end
journeys, level strategy, and suite health. The unit and integration tests that
come with an implementation task belong to the engineer writing the code — the
`backend` and `frontend` skills, which own writing them test-first
(`.claude/rules/tdd.md`).

This case asks for a JUnit integration test against a real storage boundary for a
server endpoint. Under the new split that is backend work, and its six assertions
measure backend's territory, not testing's.

## Status of the runs in this directory

**These results stay attributed to `testing`, and should not be counted toward
`backend`.** Both `with_skill` and `without_skill` were produced in iteration 1
with the *old, broader* `testing/SKILL.md` loaded — a file that no longer exists
in that form. Moving the outputs into `backend-workspace/` would label them with a
skill that was never in context when they were generated.

The iteration-1 scores (without 4/6, with 6/6) remain valid as a measurement of
the old testing skill. They are not a baseline for backend.

For iteration 2, run this case fresh under `backend-workspace/` with the current
`backend/SKILL.md`. That run is the one to compare against future iterations.

## Grading detail

See `../EVAL_REPORT.md`, which keeps the full assertion-by-assertion breakdown
under its original attribution.
