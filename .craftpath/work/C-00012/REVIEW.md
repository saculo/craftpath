# C-00012 — Module checks gate tasks: review

- **Reviewed at:** 7ed65c0e7273824865e6e7ad3e42b11462b8c2ef

## Points

- [x] R1 [major] test/steps/work.test.ts:279 -- The ordering assertion accepts a missing test command because `indexOf` returns `-1`, which is less than the check command's position; the named A1 test would pass if completion ran only the check, so it does not prove the required test-then-check gate. (solved in 7ed65c0)
