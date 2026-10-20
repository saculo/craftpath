# C-00008 — Review and learn read decisions: review

- **Reviewed at:** b4380c3d5955c01d7b766865adc3f6262ff47284

## Points

- [x] R1 [minor] test/steps/learn.test.ts:141 -- the `HARNESSES` list, the `words()` normaliser and the `skills()` reader of an installed skill on both harnesses are copied verbatim into `learn.test.ts` (T-0004) and `review.test.ts:364` (T-0002) from `work.test.ts:304`; three copies of how the suite reads installed step text drift independently (a fix to `words()` in one file leaves the other two proving against different normalisation), and `test/steps/kit.ts` is where the shared step-test helpers already live (solved in e288586)
