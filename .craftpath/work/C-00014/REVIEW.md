# C-00014 — Module check command gates: review

- **Reviewed at:** 25beacb388e0cc8c779d2a6c3d2ff4f0ee490f0a

## Points

- [x] R1 [major] test/steps/review.test.ts:122 -- The recorded temporary shared-runner mutation removes the optional check, the named integration test then fails specifically because `check passed` is absent while `REVIEW.md` is still created, and its strengthened assertions verify the required output order and record creation. (solved in 1b5aa75)
- [x] R2 [major] test/init/init.test.ts:610 -- The recorded detector mutation is concrete and makes the named A1 test fail for missing JavaScript check detection, but it does not exercise A3: replacing detection with `{ test: "bun run test" }` is exactly the expected result for A3, so `fresh init omits an undetected module check` has only been observed green. Record a mutation RED run for that named test which introduces an unwanted check for the no-check fixture, then restore it and show the test green; until then the mandatory RED evidence for A3 is absent. (solved in 25beacb)
