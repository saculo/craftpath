# C-00011 — Task commit subject length limit: review

- **Reviewed at:** d4acdbaea221e6ebceeccb1e2a7c26027d50de25

## Points

- [x] R1 [major] assets/scripts/plan.py:31 -- `plan.py` still prints `Add each task with: ... task.py <id> --wave <n> "<task title>"` with no `--type`; since T-0002 made `--type` required, the command the plan step shows the planner at its start is the one S7 refuses with the usage line. SPEC.md's Assumptions require the step's documented command to carry `--type`, and T-0002's Notes record the gap as "left for later" instead of closing it; no test pins the hint. (solved in 95f2721)
- [x] R2 [minor] test/steps/work.test.ts:300 -- the line added by T-0001 (`await Bun.write(path, plan.replace(...))`) is not formatted, so `bun run lint` (`biome ci . --error-on-warnings`, run by CI's lint job) fails on this branch and the pull request would go red. T-0003's Notes saw the failure and left it. (solved in 19ebf4e)
- [x] R3 [major] test/steps/plan.test.ts:685 -- the test for T-0003's A3 (`adding a task measures its subject with the type given`) asserts only exit 1 and that nothing was added, never what was refused or the length measured, so it cannot tell the given type from any other: a `task.py` that ignored `--type` and always measured with `refactor` refuses this 51-character title too (77 characters), and still passes A1 (47 -> 73) and A2 (46 -> 72). No test in the T-0003 block would go red, so "the type given is the one measured" (S5, A3) is unproven at add time. (solved in d4acdba)
