## T-0001 — Gate task completion with module checks

- Use the shared `run_tests` runner for checks -- keeps completion and future review gating consistent.
- Skip absent `check` commands -- preserves modules configured with tests only.

## T-0002 — Gate reviews with module checks (stuck)

None

## T-0002 — Gate reviews with module checks

- Made no production change -- changing review would regress existing dependency behavior.
- Recorded the unavoidable immediate-green observation in T-0002 reviewer notes.

## T-0003 — Detect JavaScript module checks

- Prefer `check`; otherwise combine declared `lint` and `typecheck`.
- Retained existing write-once config behavior.
