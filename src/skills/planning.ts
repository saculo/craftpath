/** The `planning` skill, written to `.claude/skills/planning/SKILL.md` by `craftpath init`. */
export const PLANNING_SKILL = `---
name: planning
description: Decompose a requirement into small, independently verifiable tasks with acceptance criteria a command can prove. Use this whenever breaking work into tasks, writing acceptance criteria, deciding dependencies between pieces of work, sizing a change, or preparing a plan for review — including any time the user mentions planning, decomposition, a backlog, breaking something up, "what tasks do we need", or is about to run craftpath task add. Use it even when the work seems small enough to skip planning, because the decision to keep it as one task is itself the planning output.
---

# Planning

You are turning an approved requirement into tasks that someone else will execute
one at a time. Each task runs in a fresh agent that sees the task file, the
requirement scenario, and nothing else you were holding in your head.

Plan for that reader. Every ambiguity you leave becomes a guess made later by
someone with less context than you have right now.

## Why the plan gate is worth real effort

Plan approval is the last point where a misunderstanding costs a sentence instead
of a rebuilt feature. Once execution starts, a wrong decomposition is paid for in
code that was written correctly against the wrong boundary.

So the goal is not a plan that looks thorough. It is a plan a reviewer can
disagree with — specific enough that someone reading it can say "no, split task 3"
before any code exists.

## What a task is

One focused implementation and one commit. If you cannot describe what "done"
looks like in a sentence, it is two tasks.

Concretely, a good task:

- changes one behavior a user or caller can observe
- can be verified without waiting for another unfinished task
- leaves the codebase working if the next task never happens

That last one is the sharpest test. A task that leaves the system broken until
its sibling lands is not a task; it is half of one.

## Acceptance criteria are the whole job

A criterion is a statement about observable behavior, paired with the specific
thing that proves it. Vague criteria are the single most common way a plan fails:
they pass review because nobody can object to them, then prove nothing.

**Weak:** "Avatar upload works correctly"
**Strong:** "Uploading a TIFF returns 415 and writes nothing to storage"

The strong one names an input, an output, and a side effect that must not happen.
It can fail. That is what makes it worth writing.

Write each criterion so that someone could build the test from the criterion
alone, without asking you what you meant.

### The shape that makes a criterion testable

A criterion has three parts, and the usual failure is omitting the third:

> **Given** a precondition · **When** one trigger · **Then** an observable outcome

You do not need Gherkin syntax, and craftpath does not need feature files — but
the shape is what turns prose into a test. Some rules that follow from it:

- **Exactly one trigger.** Two actions in one criterion means two tests, or a
  test that cannot say which action broke. Multiple preconditions are fine;
  multiple triggers are a split.
- **Concrete values, not adjectives.** "Rejects large files" is untestable;
  "a 5 MB + 1 byte upload returns 413" is a test. "Quickly", "properly",
  "correctly" and "gracefully" are all words that mean the author had not decided
  yet.
- **Domain language, not implementation.** Name the behavior, not the class that
  will provide it. The criterion should survive a refactor that keeps the
  behavior.
- **Include the negative half.** "Returns 415" is half a criterion when the real
  requirement is "returns 415 *and writes nothing to storage*". The half that
  states what must **not** happen is the half that catches write-then-compensate
  implementations, and it is the half most often dropped.

Cover four dimensions per behavior, and notice which one you skipped: the happy
path, the error case, the boundary value, and the alternative path that also
succeeds. The happy path is the one everyone writes and the one least likely to
break.

### Criteria are written before the code, which is the point

The test that proves a criterion is not documentation of something that will
appear later. It is the first thing the executor writes, before any production
code exists, and watches fail — see \`.claude/rules/tdd.md\`.

That ordering is what makes this gate worth having. If a criterion cannot be
turned into a test that fails against today's empty implementation, it was never
going to prove anything, and you want to discover that here — at review, where it
costs a sentence — rather than during execution, where it costs a rebuild.

So apply this test to every criterion you write: *could someone write a failing
test for this, right now, knowing nothing but this sentence?* If not, it is not
finished.

## Verification: name the command, and carry the weight in the text

A criterion names the command that proves it, and nothing narrower. The command
runs whole and its exit code is the evidence:

\`\`\`yaml
acceptance:
  - id: A1
    text: Unsupported formats return 415 before any storage write
    verified_by:
      - cmd: test-integration
\`\`\`

Because the binding stops at the command, the criterion \`text\` is doing the work
a test name would otherwise do. A suite passes whether or not it contains a test
for this criterion, so write the text precisely enough that anyone can tell,
reading it beside the diff, whether such a test exists — one trigger, one
observable outcome, and the effects it forbids stated out loud.

Use \`manual\` only for things a machine genuinely cannot check, like whether a
visual design matches an approved mock. Reach for it rarely: every manual
criterion is a promise that a human will actually look.

## Dependencies

\`depends_on\` is for real ordering constraints, not for narrative sequence. Ask:
*would this task actually fail if run first?* If the answer is no, do not add the
edge.

Over-declared dependencies are expensive in a way that is easy to miss: they
serialize work that could proceed independently, and they hide which constraints
are real when something needs reordering.

Under-declared dependencies are cheaper to fix — the task fails fast when its
prerequisite is missing. Prefer the cheap failure.

## When a task needs design in front of it

Some tasks cannot be written as testable criteria because a decision has not been
made yet. Do not paper over that with a vague criterion. Decide where the
decision belongs, using one test:

**Would a different answer change the task list?**

| Answer | Level | Artifact |
|---|---|---|
| Yes | Boundary | Work-level \`design.md\`, written before you decompose |
| No | Task-local | A design task carrying a \`design:\` block |

A boundary decision cannot be a task, because the decomposition depends on its
answer — planning around it produces a task list built on a guess. If you reach
one while writing tasks, stop and settle it before continuing.

A task-local decision becomes an ordinary task with a \`D\` id, sequenced ahead of
the task that consumes it:

\`\`\`yaml
---
id: D001
title: Decide the crop interaction
skills: [ux]
design:
  kind: ux
  reason: three viable crop models, and the choice changes the upload API
produces:
  - work/0007-avatar-upload/design-D001.md
acceptance:
  - id: A1
    text: A reviewer confirms the rejected options are named with reasons
    verified_by:
      - cmd: manual
---
\`\`\`

Create it with the CLI rather than writing the file yourself — it renders the
block, derives the matching skill, and refuses before writing anything if the
result would not parse:

\`\`\`
craftpath task add D001 --title "Decide the crop interaction" \\
  --design ux \\
  --design-reason "three viable crop models, and the choice changes the upload API" \\
  --produces work/0007-avatar-upload/design-D001.md
\`\`\`

Then \`T004\` lists \`depends_on: [D001]\`, which puts D001 in an earlier wave and
hands its \`produces\` files to T004's executor at start.

### Which design skill

Bind \`ux\` or \`architecture\` to match \`design.kind\`. The schema enforces that they
agree, so the real decision is which one the question belongs to — and it is not
mechanical. **Do not derive it from the task type:** an HTTP API is a developer
interface whose shape is an architecture question, and client-side state
management is architecture even though it lives in the frontend. Conversely, an
error message a user reads is a \`ux\` question even when the failure is a backend
one.

Ask instead: is the thing being decided *what a person experiences*, or *how the
system is put together*? The first is \`ux\`; the second is \`architecture\`. A
question with both halves is usually two design tasks, or one that was really a
boundary decision.

### Do not reach for this by default

A design task costs a wave. It earns that when a decision is genuinely open and
expensive to reverse. It does not earn it when there is one sensible approach and
the design document would be a restatement of the task title — that is ceremony,
and it trains reviewers to skim.

## Assigning skills

Each task names the knowledge its executor needs. The executing agent loads those
skills explicitly, so getting this wrong means someone implements without the
guidance they needed.

- One discipline skill per task boundary: backend, frontend, infrastructure
- **Do not add \`testing\` for ordinary unit and integration tests.** Those are
  written by the engineer implementing the task, test-first, and the discipline
  skill already covers them. Adding \`testing\` everywhere dilutes it into a skill
  nobody reads.
- Add \`testing\` when the task's *subject* is testing: an end-to-end journey, a
  decision about which level an assertion belongs at, pruning or repairing a
  suite, or diagnosing flakiness.
- Add a technology skill only when it carries knowledge the discipline skill does
  not — Spring specifics, Terraform provider behavior, a framework's quirks

The split matters because it changes who owns verification. An implementation
task proves its own criteria and ships its own tests; \`testing\` is for the tests
no single implementation task owns.

If a task seems to need three discipline skills, it is crossing too many
boundaries. Split it.

## Sizing

Signals a task is too big:

- the title contains "and"
- acceptance criteria exceed about five
- it touches both a data model and a user interface
- you cannot name its verification command without qualifying it

Signals a task is too small:

- it cannot be verified on its own
- its commit would say nothing meaningful
- it exists only to set up the next task with no observable behavior change

Splitting has a cost too. Five tasks that each need the same context loaded are
worse than two that don't.

**Deciding not to split is also a planning output.** When the work is genuinely
one coherent change, say so and say why — one sentence is enough. An unexplained
single task reads like the requirement was never decomposed; the same task with
"kept as one because the accept and reject paths share a transaction boundary and
splitting would ship an unguarded write path" reads like a decision a reviewer can
argue with.

Be especially wary of the split that ships a half-guarded system: an endpoint in
one task and its validation in the next means main branch carries an unvalidated
write path for however long the second task takes. Accept-and-reject usually
belong together for exactly this reason.

## Out of scope

State what a reader might reasonably assume is included but is not. This is the
cheapest possible way to prevent scope disputes during review, and it protects
the executor from helpfully building something nobody asked for.

Keep it to things someone would actually assume — not an exhaustive list of
everything the feature is not.

## Before submitting the plan for approval

Check each of these, and fix what fails rather than noting it:

1. Every requirement scenario maps to at least one acceptance criterion
2. Every criterion names a command that can prove it, or is deliberately \`manual\`
3. Every criterion could be written as a test that fails today, before any code
4. Every criterion states one trigger and a concrete, observable outcome
5. Every criterion that forbids an effect says so explicitly ("and writes nothing")
6. Every task could be verified without another unfinished task
7. Every \`depends_on\` edge would actually fail if violated
8. Every task's skills match what its implementation genuinely requires, and
   \`testing\` appears only where testing is the subject — not on every task that
   happens to write a test
9. No task title contains "and"
10. Out of scope names the assumptions a reader would otherwise make
11. Every design task is depended on by at least one task that consumes it, and
    declares in \`produces\` the files that task will read

A plan that passes all eleven is one a reviewer can engage with. A plan that fails
several will be approved anyway — reviewers approve what they cannot evaluate —
and the cost lands during execution.

Check 11 is where design tasks go wrong. A design task nothing depends on
produced a document nobody is obliged to read, which is indistinguishable from
having skipped it — and it cost a wave to find that out.

Checks 2, 3, 4, 5, 9 and 11 are mechanical. Run them over your own output before
submitting rather than trusting that you followed them while writing.

## After approval

The plan is read-only during execution. When execution reveals the plan was
wrong, that is normal and expected; run the amendment path so the change is
recorded and the affected tasks are re-approved.

Quietly editing an approved plan destroys the only signal that the gate existed.
`;
