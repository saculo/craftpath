# C-00002 — Pi step models: review

- **Reviewed at:** 7becef99eb33cb0e49b752dd6a4dff4d6a1d6996

## Points

- [x] R1 [major] test/init/init.test.ts:648 -- The S4 test does not prove the installed pi skills match the pre-change unconfigured output: both `root` and `baseline` are rendered by the same current implementation, so this equality would still pass if the unconfigured delegate text changed in this diff. The acceptance criterion names this test as the proof that unconfigured pi steps are unchanged. (solved in 567928b)
