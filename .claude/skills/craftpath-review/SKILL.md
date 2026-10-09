---
name: craftpath-review
disable-model-invocation: true
context: fork
background: false
description: Review a work item's code against its spec and plan -- incremental, points never renumbered
argument-hint: <work id>
---
# Review a work item

1. Run `python3 .craftpath/scripts/review.py "$ARGUMENTS"`. It runs every module's tests, then
   creates `REVIEW.md` from the template (or keeps the existing one) and
   prints what to review: the commit range, its commits and files, the open
   points and the next free point id. **If it is refused or fails, stop and
   report the reason word for word. Do nothing else.**
2. Review. Change no code and no other file -- only `REVIEW.md`. Read
   `SPEC.md`, `PLAN.md` and the task files, then the diff of the range it
   printed (`git diff <range>`), in the work item's worktree. Follow *How to
   review* below.
3. Update `REVIEW.md`:
   - Re-check every open point against the current code. Mark it `[x]` only
     when a commit in the range has solved it, ending the line with
     `(solved in <sha>)`. Otherwise leave it open, as it is.
   - Add each new finding as the next point, starting from the id the script
     printed: `- [ ] R<n> [major|minor] <file:line> -- <what is wrong>`.
   - Never delete, renumber or reword a point, never touch a `[-]` point, and
     never mark a point won't fix -- that is the user's call.
   - If there is no point at all, write `None` under Points.
   - Delete the guidance comment.
4. Run `python3 .craftpath/scripts/check.py review <work id>` and fix what it reports.
5. Stop. Report where `REVIEW.md` is, the points you added, the points you
   marked solved, and the points still open. Fixing an open point is the
   user's decision: they fix it, have it fixed, or mark it won't fix, then run
   `/craftpath-review <work id>` again. Once no point is open:
   `/craftpath-learn <work id>` to propose what to keep (optional), then
   `/craftpath-pr <work id>`.

The user's request: $ARGUMENTS

## How to review

You are the last reader before the work goes to a pull request. The tasks were
implemented by agents that each saw one task file; you see the whole change.
Look for what that view misses.

### Against the spec and the plan

- **Every scenario in `SPEC.md` is implemented**, and every acceptance criterion
  in the task files has the integration or e2e test it names, in the diff.
  A missing test is a `major` point.
- **The tests prove what they claim.** A test that asserts nothing, asserts
  only that no error was thrown, or would pass with the feature removed is a
  `major` point.
- **Nothing outside the plan.** A change no task's Touches covers, or
  behaviour no scenario asks for, is a point: it was not specified and nobody
  reviewed it as a plan.
- **Out of scope stays out.** Anything `SPEC.md` lists as out of scope that
  the diff does anyway.

### In the changed code

- **Correctness:** wrong conditions, off-by-one, unhandled empty or missing
  input, errors swallowed or turned into success.
- **Security:** input reaching a query, a shell, a path or HTML unchecked;
  secrets in code or logs; an authorization check that a new path skips.
- **Boundaries:** a public interface changed without its callers; data written
  in a shape older readers cannot read.
- **Clarity:** names that say something other than what the code does, dead
  code, duplicated logic another task already added.

### Writing a point

One point, one problem, at the line where it is visible. Say what is wrong and
why it matters -- not how you would rewrite it.

- `major`: wrong behaviour, a missing or hollow test, a security problem,
  something a scenario needs that is not there.
- `minor`: everything worth fixing that does not change behaviour.

Both block the pull request while open. Do not report style a linter would
catch, and do not report a matter of taste as a point.
