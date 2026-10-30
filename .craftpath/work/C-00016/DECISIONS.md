## T-0001 — Tag verify points fix, you or noted (stuck)

None

## T-0001 — Tag verify points fix, you or noted (stuck)

- Kept the id as `F<n>` rather than renaming it to `V<n>` as the spec's S9 writes -- the task Notes already decided this, and a rename would break `Fixes: F<n>` and the verify-fix check.
- Used `[fix]` for the old `[major]`/`[minor]` fixtures -- it keeps their meaning (open and fixable) until T-0002 and T-0003 give categories their own behaviour.
- Tested "writes nothing" in A3 by checking HEAD is unchanged after `check verify` -- the check only reads, so no new commit or file is the observable behaviour.
