import { GENERATED, renderCommand } from "./generated";

export const WORK_COMMAND = renderCommand(`---
description: Implement a requirement end to end, with gates and evidence
argument-hint: <what you want built>
disable-model-invocation: true
---
${GENERATED}

Deliver this requirement: $ARGUMENTS

## Operating rules

- Run \`craftpath status\` first. Resume an open work item at its first
  incomplete phase; never create a duplicate.
- Craftpath owns bookkeeping. Never write to \`.craftpath/state/\` directly.
- Fill in the scaffolded artifacts rather than inventing structure. Strip each
  \`<!-- guidance: ... -->\` comment as you complete its section.
- Stop at each configured gate and record the approval with
  \`craftpath approve <phase>\`. An approval that lives only in the conversation
  is gone when the session dies.
- Do not treat earlier approval as approval of a later phase.
- Stop regardless of configuration when a verification fails twice in a row, the
  approved plan must change, you need to work outside the approved scope, or you
  would touch infrastructure that was not part of an approved task.

> **Not built yet.** \`amend\`, \`reconcile\`, \`pr body\` and \`archive\` are still
> landing in M1. Reaching one of those
> steps today means stopping and reporting what you would have run. Do not
> improvise around the CLI, and do not hand-edit \`.craftpath/state/\`.

## Workflow

| # | Phase | Output | Gate |
|---|---|---|---|
| 0 | Resume | Current work identified | -- |
| 1 | Requirement | \`requirement.md\` | G1 |
| 2 | Understand | \`context.md\` in standard mode | -- |
| 3 | Design | Boundary decisions only; optional \`design.md\` | -- |
| 4 | Plan | Task files; \`plan.md\` in standard mode | G2 |
| 5 | Execute | Design tasks, then failing test, code, evidence, commit | -- |
| 6 | Integrate | Integration evidence | -- |
| 7 | Result | \`spec-delta.md\`, result summary | G3 |
| 8 | PR | Pull request | -- |
| 9 | Archive | Updated specs and archive | -- |

## 0. Resume or initialize

Run \`craftpath status\`.

- If work is open, identify its mode, gates, and first incomplete phase, then
  resume there.
- Otherwise initialize the requested work:

CP
craftpath work new "<short title>"              # light mode
craftpath work new "<short title>" --standard   # context and plan artifacts
CP

## 1. Requirement

Fill in \`requirement.md\`:

- describe the problem, not the proposed solution
- express every behavior as a testable Given/When/Then scenario
- list ambiguities and either resolve them with the user or record the chosen
  assumptions
- state reasonable exclusions under **Out of scope**

Stop and show the requirement, then wait for \`craftpath approve requirement\`,
unless \`craftpath status\` reports \`requirement=auto\`.

## 2. Understand

1. Read \`.craftpath/specs/\` and \`.craftpath/decisions/\` first.
2. Explore the codebase in a subagent and request a bounded, factual summary.
3. In standard mode write the summary to \`context.md\`; in light mode retain it
   in the working context.
4. Resolve any newly discovered ambiguity before planning.

Exploration runs in a subagent so it cannot spend the context budget planning
needs. What comes back is a bounded summary; the file reads stay behind.

## 3. Design -- boundary decisions only

This phase answers the questions that determine **how the work splits into
tasks**. One test decides whether a question belongs here:

**Would a different answer change the task list?**

- **Yes** -- it is a boundary decision. Settle it now. Planning around an open
  boundary question produces a decomposition built on a guess.
- **No** -- it is task-local. It does not belong in this phase. Give the task a
  \`design:\` block in PLAN and let it produce its own document.

Then:

- Skip the phase entirely when there is one sensible implementation approach.
- Otherwise write \`design.md\` with the approach, alternatives, trade-offs, and
  risks.
- Put durable decisions in a spec requirement with an ID or an ADR. Do not leave
  important decisions only in unverifiable prose.

Getting the level wrong is asymmetric. Treating a boundary decision as
task-local means amending an approved plan mid-execution; the reverse costs a
wave.

## 4. Plan

Explicitly load the \`planning\` skill before decomposing the work. Then create
each task:

CP
craftpath task add T001 --title "<imperative>" --skills backend,spring
CP

For every task, check that:

- acceptance criteria map to requirement scenarios, with every scenario covered
- each \`verified_by\` names a specific test selector rather than only a suite
- \`skills\` lists the discipline and technology knowledge actually needed
- \`depends_on\` contains only real ordering constraints
- the task is small enough for one focused implementation and commit

A suite key on its own proves nothing about a specific criterion -- the suite can
pass green while containing no test for it at all.

Apply one more check to every criterion you write: **could someone write a
failing test for this right now, knowing nothing but this sentence?** The
selector is not documentation of a test that will appear later; it is the first
thing the executor writes, before any production code exists. A criterion that
cannot fail against today's empty implementation was never going to prove
anything, and you want to find that out here rather than during execution.

### Design tasks

When a task's criteria cannot be written because a decision is still open, and
that decision is task-local by the test in phase 3, emit a **design task** ahead
of it rather than papering over the gap with a vague criterion.

A design task is an ordinary task whose deliverable is a document. It takes a
\`D\` id (\`D001\`), carries a \`design:\` block naming its \`kind\` and the reason
it is needed, binds the matching skill -- \`ux\` or \`architecture\` -- and lists in
\`produces\` the files it writes. The task that consumes it names it in
\`depends_on\`, which puts the design task in an earlier wave. The \`planning\`
skill carries the full shape and the rule for choosing between the two skills;
the schema enforces that the id, the block, the skill and \`produces\` agree.

A design task's criteria are \`manual\`: its output is proven by a person reading
it, not by a command.

Do not reach for one by default. It costs a wave, and it earns that only when a
decision is genuinely open and expensive to reverse -- not when the document
would restate the task title.

Bind one discipline skill per task boundary: \`backend\`, \`frontend\`, or
\`infrastructure\`. Those skills own the unit and integration tests for the code
they write, so do **not** add \`testing\` just because a task writes tests --
that binds it to nearly every task and dilutes it into a skill nobody reads.

Add \`testing\` only when testing is the task's subject: an end-to-end journey,
a decision about which level an assertion belongs at, pruning or repairing a
suite, or diagnosing flakiness.

Add a technology skill only when it contributes knowledge the discipline skill
lacks.

Before writing criteria, run:

CP
craftpath doctor
CP

It reports which configured commands actually run. A criterion bound to a
command reported MISSING cannot be machine-verified, so decide deliberately
whether to fix the command or mark the criterion \`manual\` -- rather than
discovering it during execution.

Stop and show the complete plan. Wait for \`craftpath approve plan\` unless
\`plan=auto\`. G2 is the highest-leverage gate in the workflow: a wrong
decomposition costs a sentence to fix here and a rebuilt feature to fix later.

## 5. Execute

### Skill contract

Skill use is mandatory, not a hint:

1. Before starting a task, read its \`skills:\` list and verify every named skill
   exists under \`.claude/skills/\`.
2. Start a fresh subagent for that task and explicitly preload every declared
   skill. Do not rely on fuzzy or automatic skill selection.
3. Give the subagent the requirement scenario, task acceptance criteria, relevant
   context, and approved design decisions.
4. If a declared skill is missing or cannot be loaded, stop and report it. Do not
   silently substitute a different skill or proceed without it.
5. \`craftpath task start\` resolves the \`produces\` of every **done** dependency
   and reports them as inputs. Preload those files into the subagent alongside
   the skills -- a task that depends on a design task must see the design, not
   just its own task file. A declared artifact missing from disk refuses the
   start; that is a real failure, not a warning to work around.

Path-scoped rules are additional safety constraints; they do not replace task
skills.

### Test first -- not optional

\`.claude/rules/tdd.md\` is a repo rule, and it is what makes the evidence mean
anything. For each criterion, smallest behaviour first:

1. **RED** -- write the test at the selector the criterion names. Run it. Watch
   it fail, and confirm it fails because the behaviour is missing, not from a
   typo, a missing import, or a setup error.
2. **GREEN** -- write the minimum code that makes it pass.
3. **REFACTOR** -- improve structure with the test green.

A criterion whose test was written after the code is still green, but nobody
ever watched it fail, so nobody knows it can. The evidence is real and the
confidence is fake.

If a criterion cannot be turned into a failing test, that is a planning defect.
Run \`craftpath amend\` rather than inventing a test that passes regardless.

### Task loop

For each unblocked task, in dependency order:

CP
craftpath task start <id>          # refuses if dependencies are unmet;
                                   # resolves done dependencies' produces
# launch a fresh subagent with all task skills preloaded
# then: failing test -> minimum code -> refactor, per criterion
craftpath task verify <id>         # runs the real command and captures evidence
git commit                         # include the required trailers
craftpath task done <id>           # refuses without evidence
CP

Use these commit trailers to preserve the link from code back to intent:

CP
feat(user): add avatar upload endpoint

Work: NNNN-slug
Task: T004
Spec: AVATAR-R3
CP

If the approved plan must change, run \`craftpath amend\`. Never edit
\`plan.md\` directly during execution.

## 6. Integrate

- run the verification strategy that crosses task or module boundaries
- confirm the implemented behavior satisfies every requirement scenario
- check that no completed task relies only on broad suite success when a
  criterion requires a specific selector

## 7. Result

CP
craftpath validate --complete
CP

Write \`spec-delta.md\` with behavior ADDED, MODIFIED, or REMOVED, referenced by
stable requirement ID.

Show the result against the criteria approved at G2 -- not a summary of what you
did -- then wait for \`craftpath approve result\` unless \`result=auto\`. This is
the last point a human sees the work before it becomes a pull request.

## 8. PR

CP
craftpath pr body | gh pr create --body-file -
CP

The body is generated, never freehand, so a reviewer gets the task table,
verification health and spec delta in the same shape every time.

## 9. Archive

After merge, run \`craftpath archive\`. It applies the delta to
\`.craftpath/specs/\` and archives the work item; no other path changes living
specs.
`);
