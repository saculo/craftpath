# C-00009 — PR body lists work decisions: review

- **Reviewed at:** ade6cf0726841babb9de0687dc7fbec094be1731

## Points

- [x] R1 [minor] test/steps/review.test.ts:299 -- the describe title still says DECISIONS.md is "read by learn", but this change makes pr.py read it too (the test inside now expects pr.py); the name no longer says what the invariant pins, so a failure here points the reader at the wrong set of readers (solved in 53c3922)
