# C-00008 — Review and learn read decisions: review

- **Reviewed at:** 7c24d7f354d176058a765440b42dc9a03ed87968

## Points

- [x] R1 [minor] test/steps/learn.test.ts:141 -- the `HARNESSES` list, the `words()` normaliser and the `skills()` reader of an installed skill on both harnesses are copied verbatim into `learn.test.ts` (T-0004) and `review.test.ts:364` (T-0002) from `work.test.ts:304`; three copies of how the suite reads installed step text drift independently (a fix to `words()` in one file leaves the other two proving against different normalisation), and `test/steps/kit.ts` is where the shared step-test helpers already live (solved in e288586)
- [x] R2 [minor] assets/skills/test-first/SKILL.md:105 -- commit b4380c3 (`fix(skills): point at test-behaviour-not-implementation, not testing`) rewrites the `test-first`, `backend` and `frontend` assets, `CLAUDE.md`, and adds an init test (`test/init/init.test.ts:801`, every skill an installed skill points to is installed) while removing two assertions from another; no task's Touches covers any of these files and no scenario in `SPEC.md` asks for it -- it is C-00007 follow-up landing in this work item's pull request without having been planned or specified, so it ships under C-00008 unreviewed as a plan -- taken off this branch by rebase; the fix goes to master in its own pull request, #124 (solved in 7c24d7f)
