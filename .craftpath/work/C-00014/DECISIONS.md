## T-0001 — Verify task module check gates

- Kept the existing module gate: it already runs test then optional check and stops on failure.
- Added reviewer notes documenting that C-00012 already delivered the named tests and implementation.

## T-0002 — Verify review module check gates

- C-00012 already supplied the review check gate; no production or generated-script change was needed.
- Added passing-check coverage and existing-REVIEW preservation coverage; documented immediate GREEN results in T-0002 notes.

## T-0003 — Verify JavaScript module check detection

- Preserved C-00012’s existing detection implementation; strengthened acceptance coverage only.
- Left pre-existing `DECISIONS.md` modification untouched.
