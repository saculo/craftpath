# C-00004 — Spec Assumption Sections: review

- **Reviewed at:** 8fa52df22d9f7696b0399c402837dbf26fc17ec4

## Points

- [x] R1 [major] test/steps/plan.test.ts:78 -- The named A1 integration test never verifies that the generated Assumptions guidance tells the agent to record the reason for each decision. Removing “and why” from the template would still pass, so the test does not prove this required behavior. (solved in 6e11171)
- [x] R2 [major] test/init/init.test.ts:162 -- The named A2 integration test checks isolated words and phrases instead of the required instruction relationships. It would still pass if either creation or revision sent product-changing uncertainty to Assumptions or did not require a reason there, so it does not prove the required separation of assumptions from user questions. (solved in dc54f6b)
- [x] R3 [major] test/steps/plan.test.ts:85 -- The named A1 integration test checks only that an Assumptions heading occurs somewhere before Open questions. It would still pass with another section between them (or a duplicate Assumptions section before it), so it does not prove the required immediate, sole placement. (solved in 8fa52df)
- [x] R4 [major] test/init/init.test.ts:162 -- The creation-instructions branch of the named A2 test never requires that an assumption be decided from the request and concerned code. Removing that boundary from creation guidance would still pass, allowing unsupported assumptions contrary to S2 and the acceptance criterion. (solved in 8fa52df)
