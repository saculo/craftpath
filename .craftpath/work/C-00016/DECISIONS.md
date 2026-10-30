## T-0001 — Tag verify points fix, you or noted (stuck)

None

## T-0001 — Tag verify points fix, you or noted (stuck)

- Kept the id as `F<n>` rather than renaming it to `V<n>` as the spec's S9 writes -- the task Notes already decided this, and a rename would break `Fixes: F<n>` and the verify-fix check.
- Used `[fix]` for the old `[major]`/`[minor]` fixtures -- it keeps their meaning (open and fixable) until T-0002 and T-0003 give categories their own behaviour.
- Tested "writes nothing" in A3 by checking HEAD is unchanged after `check verify` -- the check only reads, so no new commit or file is the observable behaviour.

## T-0001 — Tag verify points fix, you or noted

- Used `[fix]` for both the old `[major]` and `[minor]` evals points -- the task says to use it for bare major/minor tags, and nothing in these tests needs `[you]` or `[noted]`.
- Renamed the E2 wording from "major" to "fix" -- the grader's message and test names would otherwise describe a tag that no longer exists.

## T-0002 — Block the pull request on fix and you points only

- Leave `pr.py` unchanged -- it already lists all points verbatim, so A3 and A4 hold without edits.
- Change the refusal wording to "[fix] and [you] verify points" -- the task says the refusal text names both categories.
- Use a `[-]` won't-fix line as the "closed" point in the A1 test -- a `[x]` line needs a real commit sha in `(solved in <sha>)`, which the fixture doesn't have.

## T-0003 — Fix only the fix points

- Added one shared `open_fixes()` helper in `checks.py` for the guard, script and check -- one definition of "open fix point" instead of three copies.
- Left the check's early pass when no task is added -- the "no open `[fix]`" refusal belongs to the guard, and changing the check was outside the criteria.
