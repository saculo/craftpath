# C-00002 — Pi step models: review

- **Reviewed at:** 394e130cf74c6de98aa4d7d4df64940825b31875

## Points

- [x] R1 [major] test/init/init.test.ts:648 -- The S4 test does not prove the installed pi skills match the pre-change unconfigured output: both `root` and `baseline` are rendered by the same current implementation, so this equality would still pass if the unconfigured delegate text changed in this diff. The acceptance criterion names this test as the proof that unconfigured pi steps are unchanged. (solved in 567928b)
