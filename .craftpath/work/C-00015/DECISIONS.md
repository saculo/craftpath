## T-0001 — Require a failure scenario in every verify point

- The messages read `F1 has no failure scenario` and `F2 has no file:line`, and the tests assert those phrases -- the task named what must be reported, not the wording; these follow review's `<id> is ...` style.
- A line that doesn't fit the point shape, including an `R<n>` id or a missing ` -- `, is reported once as `not a point`, quoting the line, and gets no location or scenario check -- this is how review handled such lines, and with the wrong shape there is no location or scenario to check.
- `check_verify` copies `check_review`'s loop instead of sharing a helper with it -- T-0007 deletes `check_review`, so sharing would mean changing review code that is about to go.
- `given` may start with a capital or lowercase letter (`[Gg]iven`), but must be the first word after ` -- ` -- that is my reading of the plan's "either case", and it keeps the check mechanical.

## T-0002 — Refuse verify until every task is committed

- Duplicated `review.py` into `verify.py` instead of sharing the checks in a common helper -- a shared helper would mean editing `review.py`, which is outside Touches, and T-0007 deletes `review.py` anyway.
- Defined a local `verify(tree)` path helper in the test file instead of adding one to `kit.ts` -- `kit.ts` is outside Touches, and other tasks in the wave may be editing it.
- A4 writes `.craftpath/work/C-00001/notes.md` as its uncommitted file inside the work item -- the criterion names no file, and `VERIFY.md` is the script's output, so any other file is a cleaner example.

