---
description: Verify a work item's code -- one subagent finds, a second tries to refute; only what survives becomes a point
argument-hint: <work id>
---
# Verify a work item

You run this step in this session and start two subagents, one after the
other. Change no code yourself.

Load the `never-block-on-the-human` skill before you do anything else.

1. Run `{{SCRIPT:verify}} {{ARGS}}`. It runs every module's tests and checks,
   then creates `VERIFY.md` from the template (or keeps the existing one) and
   prints what to verify: the commit range, its commits and files, the diff
   command to read them with, the open points and the next free point id. **If it is refused or fails, stop and
   report the reason word for word. Do nothing else.**
2. Start one finder subagent with the `Agent` tool (agent
   `general-purpose`{{SUBAGENT}}). Give it the finder's brief below, filled in
   with the work item's worktree, its `SPEC.md`, `PLAN.md`, task files and the
   diff command the script printed. Wait until it has finished.
3. Then start a second subagent, in a fresh context, with the `Agent` tool
   (agent `general-purpose`{{SUBAGENT}}). Give it the refuter's brief below,
   filled in with only the finder's findings, verbatim, and the worktree --
   nothing else: no spec, no plan, no task file. Wait until it has finished.
4. Update `VERIFY.md`. Change no other file.
   - Re-check every open point against the current code. Mark it `[x]` only
     when a commit in the range has solved it, ending the line with
     `(solved in <sha>)`. Otherwise leave it open, as it is.
   - Add only the findings the refuter could not refute as new points -- those
     it answered `confirmed` -- starting from the id the script printed:
     `- [ ] F<n> [fix|you|noted] <file:line> -- given <input or state>, <what goes wrong>`.
   - Categorise each confirmed finding. A confirmed finding is `[fix]` by
     default -- a confirmed missing test for a `SPEC.md` scenario is the
     example. `[you]` is for a finding whose fix would change scope, intent or
     user-visible behaviour the spec leaves unsettled; no task is made from it.
     `[noted]` is for a real finding not worth changing code for; no task is
     made from it.
   - A refuted finding, and a finding without a failure scenario, is written
     into no file -- not `VERIFY.md`, not another one. Style, naming and
     formatting are never findings.
   - Never delete, renumber or reword a point, never touch a `[-]` point, and
     never mark a point won't fix -- that is the user's call.
   - If there is no point at all, write `None` under Points.
   - Delete the guidance comment.
5. Run `{{SCRIPT:check}} verify <work id>` and fix what it reports.
6. Report where `VERIFY.md` is, the points you added, the points you marked
   solved, and the points still open -- and nothing about the findings that
   were dropped. Loop: do not ask the user before fixing a `[fix]` point.
   Take the first of these that fits.
   - If no `[fix]` point is open, stop without a further round and report the
     open `[you]` points and the `[noted]` ones.
   - If you were started with `--round 2` and a `[fix]` point is still open,
     stop after this round, report those points by id, and start no further fix
     round.
   - If a `[fix]` point is open, run `{{CMD:verify-fix}} <work id>`, then
     `{{CMD:work}} <work id> all`, then `{{CMD:verify}} <work id> --round 2`.
     `verify-fix` makes exactly one task per open `[fix]` point and none for a
     `[you]` or `[noted]` point.

   To answer an open `[you]` point, the user retags it `[fix]`, or marks it
   `[-]` with `(won't fix: <reason>)`, then runs verify again. Once no `[fix]`
   or `[you]` point is open: `{{CMD:learn}} <work id>` to propose what to keep
   (optional), then `{{CMD:pr}} <work id>`.

The user's request: {{REQUEST}}

## The finder's brief

> You look for what is wrong with work item `<work id>`, in the worktree
> `<worktree>`: read and run things there, and change no file.
>
> Load the `test-first` skill, the `test-behaviour-not-implementation` skill,
> the `fix-root-causes` skill and the `laziness-protocol` skill.
>
> Read `SPEC.md`, `PLAN.md` and the task files, in `<work dir>`, then the diff
> of the change (`<diff command>`), which leaves the work item's own files out. The tasks were implemented by agents
> that each saw one task file; you see the whole change. Look for what that
> view misses:
>
> - **Every scenario in `SPEC.md` is implemented**, and every acceptance
>   criterion in the task files has the integration or e2e test it names, in
>   the diff. A missing test is a finding.
> - **The tests prove what they claim.** A test that asserts nothing, asserts
>   only that no error was thrown, or would pass with the feature removed is
>   a finding.
> - **Nothing outside the plan.** A change no task's Touches covers, or
>   behaviour no scenario asks for.
> - **Out of scope stays out.** Anything `SPEC.md` lists as out of scope that
>   the diff does anyway.
> - **Correctness:** wrong conditions, off-by-one, unhandled empty or missing
>   input, errors swallowed or turned into success.
> - **Security:** input reaching a query, a shell, a path or HTML unchecked;
>   secrets in code or logs; an authorization check that a new path skips.
> - **Boundaries:** a public interface changed without its callers; data
>   written in a shape older readers cannot read.
> - **Root causes:** a fix that silences the symptom -- a guard, a retry, a
>   special case -- while the cause stays in place.
> - **Smallest change:** code, options or abstractions the criteria do not
>   need, dead code, or logic duplicated from another task.
>
> Style, naming and formatting are never findings, and neither is a matter of
> taste.
>
> Propose each finding as one line, at the `file:line` where it is visible,
> stating the input or state that makes it go wrong and what goes wrong then:
> `<file:line> -- given <input or state>, <what goes wrong>`. Leave out a
> finding you cannot give a failure scenario for.
> End with the findings, one per line, or `None`.

## The refuter's brief

> You check findings against the code in the worktree `<worktree>`. Each one
> below claims that, given some input or state, something goes wrong at a
> `file:line`. Try to refute each one: by reading the code and, where you can,
> by running it or by writing a throwaway test that shows what really happens.
> Change no other file, and delete every test you wrote before you end.
>
> For each finding, answer `confirmed` -- you could not refute it -- or
> `refuted`, with the evidence: what you read, ran or tested, and what it
> showed. Repeat each finding verbatim with its answer.
>
> The findings:
>
> <the finder's findings, verbatim>
