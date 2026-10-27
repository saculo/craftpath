# C-00011 — Task commit subject length limit: review

- **Reviewed at:** 19ebf4ecf4a61cefb69351d7ff6482e8c07c9a68

## Points

- [x] R1 [major] assets/scripts/plan.py:31 -- `plan.py` still prints `Add each task with: ... task.py <id> --wave <n> "<task title>"` with no `--type`; since T-0002 made `--type` required, the command the plan step shows the planner at its start is the one S7 refuses with the usage line. SPEC.md's Assumptions require the step's documented command to carry `--type`, and T-0002's Notes record the gap as "left for later" instead of closing it; no test pins the hint. (solved in 95f2721)
- [x] R2 [minor] test/steps/work.test.ts:300 -- the line added by T-0001 (`await Bun.write(path, plan.replace(...))`) is not formatted, so `bun run lint` (`biome ci . --error-on-warnings`, run by CI's lint job) fails on this branch and the pull request would go red. T-0003's Notes saw the failure and left it. (solved in 19ebf4e)
