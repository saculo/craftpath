# C-00007 — Test behaviour principle: review

- **Reviewed at:** 7856363f70209f1e8a78d3e91afcbcf40604663d

## Points

- [x] R1 [minor] assets/skills/backend/SKILL.md:16 -- This changes the backend skill although `SPEC.md` explicitly lists changing it as out of scope; the plan/task conflict needs resolution rather than silently expanding the work. (solved in 7856363)
- [x] R2 [minor] assets/skills/frontend/SKILL.md:110 -- This changes the frontend skill although `SPEC.md` explicitly lists changing it as out of scope; the plan/task conflict needs resolution rather than silently expanding the work. (solved in 7856363)
- [x] R3 [major] test/init/init.test.ts:76 -- The A2 test only asserts absence of the prose literal "implementation-detail testing guidance"; spec instructions could direct scenarios to implementation details using any other wording and this test would still pass, so it does not prove the criterion's observable-behaviour requirement. (solved in 7856363)
- [x] R4 [major] test/init/init.test.ts:124 -- The A5 test's retired-skill scan is restricted to each harness's `skills` directory, omitting installed Claude rules such as `.claude/rules/tdd.md`; a remaining retired-skill reference there would satisfy the claimed test while violating the requirement that no installed guidance refer to it. (solved in 7856363)
