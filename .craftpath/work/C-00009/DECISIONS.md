# C-00009 — Decisions

## T-0001 — Carry DECISIONS.md into the pull request body

- Widened the scripts test in `test/steps/review.test.ts` to also allow `pr.py`, although that file is outside Touches -- the spec requires `pr.py` to read `DECISIONS.md`. The only other way to pass was to hide the filename in `pr.py`, which would defeat the test, and no other task in this wave is changing that file.
- An empty or title-only `DECISIONS.md` gives no `## Decisions` section, rather than an empty heading -- an empty section tells the reader nothing, and this matches how the existing `Knowledge` section is left out when it would be empty.
- Moved the line rewrite into its own small function, `nested(text)`, next to `title()` -- it keeps `body()` easy to read. Its docstring says what the rewrite keeps and changes.
- In the tests, the Decisions text is compared as one exact string (`DECIDED`), and A3 compares the whole body with the expected section inserted before `## Review` -- A1 and A3 ask for exact text and order, which checking for pieces of text would not prove.
