# C-00018 — Modern search tools rule: verify

- **Verified at:** adabc1011630aac9a7941e3d3dad804ac1d48646

## Points

- [ ] F1 [minor] test/readme.test.ts:94 -- given a checkout with no local `master` branch (a CI shallow clone) or a later branch that legitimately edits CLAUDE.md, the "otherwise unchanged" test runs `git show master:CLAUDE.md` and fails or errors instead of reporting a real defect
- [ ] F2 [minor] test/init/init.test.ts:1935 -- given a guard whose refusal format no longer contains the literal "deny", the A3 test (exit 0, no "deny", no tool name) passes although the guard refuses, because it never asserts that the guard allows the command
- [ ] F3 [minor] test/init/init.test.ts:1875 -- given a change to the tool list or the pattern in `barePath()` or `SEARCH_TOOLS`, which are defined identically in test/doctor/doctor.test.ts:174, one copy is updated and the other drifts, so the two guard tests stop agreeing on what counts as a search tool
