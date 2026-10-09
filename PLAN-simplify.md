# Plan: simplify craftpath

Status: **draft for review** -- nothing is built. Sections 1-3 restate what was
decided; section 4 is the proposal for the rest; section 5 is round 1 of
questions; **section 6 is round 2: answers folded in, new proposals, and what
is still open.**

## 1. Why

The TypeScript has grown to ~9,700 lines (CLI, gates, approvals, evidence,
trailers, reconcile, archive, advance/next/report, guards, migrations...). Much
of it exists to police an agent and to model edge cases a single careful user
does not need, and it keeps producing bugs (the audit found 19). The first real
eval showed the policing still does not make the agent do the right thing.

## 2. Decisions (from the user, 2026-10-08)

1. **No approvals.** No gates, no `approve`, no recorded sign-offs. Each step of
   the flow is its own harness skill: `/craftpath:spec`, `/craftpath:plan`,
   `/craftpath:work`, `/craftpath:review`, ... (pi: `/craftpath-spec`, ...).
2. **The user runs every skill.** No skill is invoked by the model, and no skill
   chains into the next one.
3. **Every skill follows the same shape:**
   1. the user invokes it in the harness;
   2. a **guard** checks that the inputs it needs are complete (e.g. `plan`
      checks `SPEC.md` has all required data); if not, the skill stops and says
      what is missing;
   3. a **script** creates the step's file from a Markdown template;
   4. the agent fills the template;
   5. the skill ends;
   6. the user reads the file, edits it or asks for changes;
   7. when satisfied, the user invokes the next skill.
4. **Several work items at once** stays.
5. **Waves stay:** the plan splits work into tasks; tasks in the same wave can be
   implemented in parallel.
6. **One person per project.** No defensive handling of concurrent use, no
   locking, no "what if two agents..." edge cases.
7. **Module commands stay** (`[modules.*]` with `test` / `build`).
8. **Knowledge at the end is chosen by the user:** the flow proposes candidates,
   the user picks which ones become durable knowledge.
9. **File creation is done by scripts, not CLI commands.** They ship inside the
   installed skills, so nothing is casually callable as `craftpath <x>`.
10. **The CLI keeps only `init`, `doctor`, and later `state`** (overview of all
    work items across worktrees -- designed later).

## 3. The flow, step by step

| # | Skill (user runs) | Guard checks before | Script creates | Agent fills | User then |
|---|---|---|---|---|---|
| 1 | `/craftpath:spec <what>` | -- (or: no unfinished spec with the same title) | work item dir + `SPEC.md` | problem, scenarios (Given/When/Then), out of scope, open questions | reads, edits, answers open questions |
| 2 | `/craftpath:plan <work>` | `SPEC.md` complete | `PLAN.md` | tasks, acceptance criteria per task, test command, waves, files/modules each task touches | reads, edits |
| 3 | `/craftpath:work <work> [task\|wave]` | `PLAN.md` complete | (task log / status update) | implements, test first, runs module commands | reviews the code |
| 4 | `/craftpath:review <work>` | all tasks done, module commands green | `REVIEW.md` | checks the diff against SPEC and PLAN, lists findings | fixes or accepts |
| 5 | `/craftpath:learn <work>` | review done | `KNOWLEDGE.md` (candidates) | proposes candidates: spec requirements, decisions (ADR), skill/rule changes | ticks the ones to keep; a script applies the ticked ones |

## 4. Proposal for what is not decided yet

### 4.1 Where things live

```
.craftpath/
  config.toml                 modules + git base branch (kept)
  templates/*.md              SPEC, PLAN, REVIEW, KNOWLEDGE (user-editable)
  scripts/                    the step scripts (TypeScript, run with bun)
  work/W-0001-<slug>/
    SPEC.md
    PLAN.md                   tasks + waves + status checkboxes
    REVIEW.md
    KNOWLEDGE.md
  knowledge/                  what the user chose to keep (specs, decisions)
.claude/skills/craftpath-*/SKILL.md     one per step (Claude Code)
.pi/skills/craftpath-*/SKILL.md + extension   (pi)
```

- **State is the Markdown.** A task's status is a checkbox in `PLAN.md`
  (`- [ ] T001 ...` / `- [x]`), written by a script, readable by the user. No
  JSON state, no `.craftpath/state/`, and so no guards protecting it.
- Work item ids stay `W-0001-slug`, allocated by the `spec` script.

### 4.2 How a guard runs

The guard must run **before** the agent acts and must not depend on the agent
choosing to run it.

- **Claude Code:** the skill's `SKILL.md` runs the guard script through
  dynamic context injection (`` !`bun .craftpath/scripts/guard.ts plan W-0001` ``),
  which executes when the skill is invoked, before the model sees the prompt;
  its output tells the model to stop or proceed. Alternative: a hook scoped to
  the skill. *(Both to verify against the current Claude Code docs.)*
- **pi:** the craftpath extension registers `/craftpath-plan` etc. as commands;
  the handler runs the guard in code and only then sends the prompt. *(To
  verify against pi's extension API.)*
- "Has all required data" is defined per template, mechanically: required
  headings present and non-empty, no `<placeholder>` or guidance comments left,
  plus a few per-file rules (every scenario has Given/When/Then; every task has
  acceptance criteria, a test command and a wave).

### 4.3 What `/craftpath:work` does

- Takes a task or a wave (default: the next wave with open tasks).
- Tasks in one wave run as **parallel subagents in the same checkout** when
  the plan says they touch disjoint files/modules; otherwise one by one.
- Test first, as a rule in the skill: write the failing test, run the module
  `test` command (red), implement, run it (green).
- A task is marked done (`- [x]`) by a script that first runs the affected
  modules' `test` command and refuses if it fails. That is the one hard check
  kept from today's evidence system. No logs, hashes, trailers or fingerprints.
- Commits: the agent commits per task; the message names the work item and
  task (convention, not enforced).

### 4.4 What stays, what goes

| Stays | Goes |
|---|---|
| `init` (installs skills, scripts, templates, config; re-run to update) | `approve`, gates, `via`, approvals in state |
| `doctor` (modules' commands, harness wiring) | `task add/start/verify/done/ack/resume/next/report`, `amend` |
| module config, change detection, affected modules | evidence, config hash, source fingerprint, logs |
| harness descriptors (Claude Code, pi), install/render | commit-trailer checks, `reconcile`, `archive`, `pr body` |
| manifest-based safe update of user-edited files | `validate`, Stop hook, guard-bash, guard-write |
| engineering skills (backend, frontend, testing, ...) | schema for state, migrations of state |
| | `advance`, worker outcome envelope |

Rough size after: the CLI (`init`, `doctor`) plus a handful of small scripts
-- I would expect well under a third of today's code.

### 4.5 Evals after the simplification

The real-model runner, kit and coverage gate stay useful. Graders change:
`validate_complete` becomes "every task checked, review written";
`red_before_green` can no longer read stored evidence -- it would read the
transcript (a failing test run before the passing one), which means saving
transcripts first.

## 5. Questions

**Flow**
1. Is the step list right -- `spec`, `plan`, `work`, `review`, `learn`? Do you
   want a separate `design` step (boundary decisions before planning), and what
   happens to `investigate` (bug) and `pr` (review comments)?
2. Does `/craftpath:spec` create the work item (id, directory) and its git
   branch, or is the branch yours to make?
3. With several work items open, does every skill take the work id as an
   argument (`/craftpath:plan W-0002`), or should it ask when it is ambiguous?
4. One `PLAN.md` with all tasks, or one file per task as today?
5. `/craftpath:work`: one task per invocation, one wave, or everything until
   done? And are parallel subagents in one checkout OK, or should parallel
   tasks only ever be done by you in separate worktrees?

**Guards and quality**
6. Should a skill also check its **own** output when it ends (e.g. "PLAN.md
   still has empty sections") and tell you, without blocking?
7. Keep the "task can only be checked when its module tests pass" check, or
   drop that too?
8. Keep the test-first rule (`tdd.md`) and the engineering skills as they are?
9. Commit trailers (`Work:` / `Task:`) -- keep as a convention, or drop?

**Knowledge**
10. Where do chosen candidates go: `.craftpath/knowledge/` (specs + decisions),
    the engineering skills, `CLAUDE.md` / `AGENTS.md`, or a mix depending on the
    kind?
11. Is applying the ticked candidates a script run by `/craftpath:learn`, or do
    you edit them in yourself?

**Mechanics**
12. Scripts in TypeScript run with `bun` (craftpath already requires Bun), or
    plain shell so they work without Bun in the project?
13. Is `init` re-run enough for upgrades (replacing `update`), keeping the
    "don't overwrite files you edited" behaviour?
14. Existing projects with today's `.craftpath/state/`: clean break, or a
    one-time conversion?
15. Do we build the new version on a fresh branch as a rewrite (small, clean),
    or by deleting pieces from master step by step? I recommend a rewrite branch
    reusing only the modules, harness, install/manifest and skills code.

---

## 6. Round 2 -- answers and the proposals they lead to

### 6.1 Agreed

- **4.1 layout** is fine. **4.3 work** as proposed; parallel tasks in one wave
  should not touch the same files, but that can be best effort for now.
- **Steps:** `spec`, optional `design` (depends on the kind of work), `plan`,
  `work`, `review`, `pr` (review comments), `learn`. Every one is a harness
  skill with its own guard and script, and every next step is invoked by the
  user. No step chains into another.
- **Skills take the work id as an argument:** `/craftpath:plan C-00001`.
- **`work`:** `/craftpath:work C-00001 wave 2` or `/craftpath:work C-00001 all`.
  One worktree per work item, not per task.
- **Self-check at the end of a step:** yes (6.4).
- **Tests must pass to complete a task:** kept (6.5 says where).
- **Test first, at integration / e2e level.** A task's acceptance criteria are
  behaviours proven by integration or e2e tests; that test is written first and
  seen failing. Unit tests are allowed but never the proof of a criterion.
- **Engineering skills stay as they are** for now.
- **Knowledge candidates:** an ADR when it is a significant decision; proposed
  changes to `CLAUDE.md` / `AGENTS.md` (later perhaps one file per module).
- **`init` re-run** replaces `update`, keeping "do not overwrite files you
  edited".
- **Clean break:** no backwards compatibility with today's `.craftpath/state/`.

### 6.2 Guards as hooks (answer to "can't we run that as hooks?") -- yes

Checked against both harnesses' docs:

- **Claude Code:** the `UserPromptExpansion` hook fires when a user-typed
  command expands into its prompt, *before* the prompt reaches the model. Its
  matcher is the command name, so one entry per step (`craftpath:plan`, ...)
  runs that step's guard. Exit 2 (or `{"decision":"block","reason":...}`)
  blocks the command and shows the reason to the user. Installed by `init` in
  `.claude/settings.json`.
- **pi:** the craftpath extension registers `/craftpath-plan` etc. with
  `pi.registerCommand`. The handler runs the guard; if it fails it shows the
  reason and stops, otherwise it sends the skill's prompt with
  `pi.sendUserMessage`.

Either way the guard is code that runs before the agent, never an instruction
the agent may skip.

### 6.3 Ids, worktrees and commits (proposal)

**Ids.** Work item `C-00001` (five digits), task `T-0001` (four digits, numbered
per work item). Directories and branches add a slug for readability.

**`/craftpath:spec "<title>"` creates everything:**

```
repo/                                   your main checkout (base branch)
repo.craftpath/C-00001-health-endpoint/ the work item's worktree
    branch: craftpath/C-00001-health-endpoint (from base_branch)
    .craftpath/work/C-00001/SPEC.md     committed on that branch
```

The next id is one more than the highest `C-` number found in any branch
name, worktree, or commit subject in the repository -- enough for one person.

**Commit messages**, Conventional Commits with the ids as the scope:

```
<type>(C-00001/T-0002): <short description>

<optional body>
```

- `<type>` comes from the task's `type` field: `feat`, `fix`, `test`,
  `refactor`, `docs`, `perf`, `chore`.
- Commits that belong to the work item but no task: `docs(C-00001): add spec`,
  `docs(C-00001): add plan`.
- Example: `feat(C-00001/T-0002): add GET /health endpoint`.
- Finding a task's commits: `git log --grep 'C-00001/T-0002'`.
- Enforced lightly: the `review` guard checks every completed task has at
  least one commit carrying its id.

**Trailers (your question 9).** A trailer is a `Key: value` line at the very
end of a commit message, like `Co-Authored-By:`. Today's craftpath requires
`Work:` and `Task:` trailers to link commits to tasks. With the ids in the
subject that is redundant, so **trailers are dropped.**

### 6.4 Plan files (your question 4) -- recommendation

**`PLAN.md` as the overview, plus one file per task.**

```
.craftpath/work/C-00001/
  SPEC.md
  DESIGN.md            optional
  PLAN.md              goal, approach, waves, and the task list with checkboxes
  tasks/T-0001.md      type, wave, depends on, files/modules it touches,
  tasks/T-0002.md      acceptance criteria (each with its IT/e2e test), notes
  REVIEW.md
  KNOWLEDGE.md
```

Why split: a subagent gets exactly one task file as its brief; parallel
subagents each write notes into their own file instead of all editing one;
`PLAN.md` changes only when a script ticks a task, so it stays a short page
you can review at a glance.

**Self-check at the end of a step:** the skill's last instruction runs the same
check script its successor's guard uses and shows you the result, without
blocking. The hard stop is the next step's guard.

### 6.5 Where "tests must pass" lives

- **In `work`:** a task is completed by a script the agent runs
  (`complete T-0002`). It runs the `test` command of every module the task's
  files belong to and ticks `- [x] T-0002` in `PLAN.md` only if they pass.
- **In `review`'s guard:** every task ticked, and the full `test` of every
  module green.

### 6.6 Choosing knowledge with a command (your question 11)

1. `/craftpath:learn C-00001` writes `KNOWLEDGE.md` as candidates, each a
   checkbox with a target:
   ```
   - [ ] K1 [ADR] Health checks bypass auth middleware
   - [ ] K2 [AGENTS.md] Run `bun test` from the module root, not the repo root
   ```
2. You tick the ones you want, in your editor.
3. `/craftpath:learn-apply C-00001` (guard: at least one ticked) writes exactly
   the ticked ones: an ADR from the template, or the edit to `CLAUDE.md` /
   `AGENTS.md`, and marks them applied.

On Claude Code the first step could instead show the candidates as a
multi-select question inside the session; the checkbox file works on both
harnesses, so it is the baseline.

### 6.7 Script language (your question 12) -- recommendation

**Python 3, standard library only.** The scripts scaffold files and check
Markdown structure (required sections, placeholders, checkboxes); that is
straightforward in Python and painful in shell, and Python 3 runs the same on
Linux, macOS and Windows. `doctor` checks `python3` is available. Shell stays
an option for the trivial ones, but one language is easier to keep correct.

### 6.8 Rewrite or step-by-step (your question 15) -- clarified

Two ways to get from today's code to the new design:

- **Rewrite:** a new branch where craftpath is rebuilt small. Only the parts
  that survive (module config and detection, harness install, manifest-based
  safe updates, doctor, the engineering skills) are carried over; everything
  else is not brought along. Merged once the new flow works end to end.
- **Step by step:** on master, one PR at a time, remove a feature (approvals,
  then evidence, then trailers, ...) and keep everything green after each.

**Recommendation: rewrite.** Nearly every behaviour changes, so step by step
would mean repeatedly adapting code and tests that are deleted a few PRs later.

### 6.9 Still open

1. Worktree location: `repo.craftpath/C-00001-<slug>/` next to the repo (as
   proposed), or inside it (`repo/.craftpath/worktrees/...`, git-ignored)?
2. Commit schema in 6.3 -- OK, or do you prefer `[C-00001][T-0002] feat: ...`?
3. Plan split in 6.4 -- OK?
4. Knowledge flow in 6.6 -- OK?
5. Python 3 for scripts -- OK?
6. Rewrite on a new branch -- OK?
7. When a work item is finished (`pr` merged): does a skill remove its
   worktree and mark it done, or do you clean up yourself?
8. `pr`: does craftpath create the pull request (`gh pr create` with a body
   from SPEC/PLAN/REVIEW), or only handle review comments afterwards?

---

## 7. Round 3 -- decided

- **Worktrees** next to the repo: `repo.craftpath/C-00001-<slug>/`.
- **Commit schema** as in 6.3. **Plan split** as in 6.4. **Knowledge flow** as
  in 6.6. **Scripts in Python 3**, standard library only.
- **Finished work:** no cleanup skill for now; worktrees are removed by hand.
- **`/craftpath:pr C-00001`** creates the pull request, run by the user after
  the review passes. Its guard: `REVIEW.md` has no open point. Handling review
  comments on the PR is a separate small sub-workflow, designed later.
- **The rewrite ends on master**, working (7.2).

### 7.1 `/craftpath:review` is incremental

| `REVIEW.md` | What `/craftpath:review C-00001` does |
|---|---|
| absent | creates it from the template and fills it with findings |
| present | re-checks every existing point against the current code, marks the ones now solved, leaves the rest open, and adds new points it finds |

Each point has an id that never changes, so a point keeps its history across
runs:

```
- [ ] R1 [major] src/app.ts:12 -- /health is behind the auth middleware
- [x] R2 [minor] src/app.test.ts -- the 404 test asserts nothing (solved in a1b2c3d)
- [-] R3 [minor] README.md -- no endpoint list (won't fix: README is out of scope)
```

- `[ ]` open, `[x]` solved (marked by the review, with the commit that solved
  it), `[-]` won't fix (marked by you, with a reason).
- The review never deletes or renumbers a point, and never marks one won't fix.
- `/craftpath:pr`'s guard: no `[ ]` left.
- Open (7.3): who fixes the open points.

### 7.2 How the rewrite is built (proposal)

On one branch, `rewrite/simplify`, in small commits, each test-first and
green. One pull request to master when the whole flow works end to end. No
chain of PRs into one another.

1. **Skeleton.** New, small `src/`: `init` (templates, Python scripts, skills
   for both harnesses, the guard hooks / pi extension commands) and `doctor`.
   Script library: ids, worktree creation, Markdown checks.
2. **`spec`, `design`, `plan`.** Templates, scripts, guards, skills.
3. **`work`.** `wave N` / `all`, parallel subagents per wave, the `complete`
   script that runs module tests before ticking.
4. **`review` and `pr`.** Incremental `REVIEW.md`; `gh pr create` with a body
   built from SPEC, PLAN and REVIEW.
5. **`learn` and `learn-apply`.**
6. **Evals and cleanup.** Re-point the eval kit and graders at the new flow,
   delete the old code and docs, rewrite the README, then the PR to master.

### 7.3 Still open

1. **Who fixes open review points?** (a) you, or by asking the agent in the
   session; (b) `/craftpath:work C-00001 review`, which implements the open
   `R` points as if they were tasks, with the same test rule; (c) the review
   points become new tasks in `PLAN.md`.
2. **The rewrite plan in 7.2** -- OK to start with step 1?

---

## 8. Verified mechanism (spikes, 2026-10-08, ~$0.02 total)

Fixing review points stays manual for now (7.3.1): you decide whether a point
is dropped, becomes a task, or is fixed by you.

**Claude Code** -- one command file per step in `.claude/commands/craftpath/`:

```
---
description: ...
disable-model-invocation: true
allowed-tools: Bash(python3 .craftpath/scripts/spec.py:*)
---
!`python3 .craftpath/scripts/spec.py "$ARGUMENTS"`
<instructions for the agent>
```

- The guard is a `UserPromptExpansion` hook in `.claude/settings.json`, matcher
  `craftpath:.*`, command `python3 "$CLAUDE_PROJECT_DIR/.craftpath/scripts/guard.py"`.
  It receives `command_name` (`craftpath:spec`) and `command_args`; exit 2
  blocks with the stderr shown to the user. Verified: blocked runs cost $0 and
  the agent never starts.
- The `` !`...` `` step runs the script during expansion, after the guard and
  before the model; its output is inlined into the prompt. Verified:
  `"$ARGUMENTS"` arrives as one argument; when the guard blocks, the script
  does not run.
- **The script must be listed in `allowed-tools`.** Without it, `claude -p`
  silently ends the run with no turns and no error.
- Paths are relative to the session's directory: start the harness at the
  repo (or worktree) root.

**pi** -- the craftpath extension registers `craftpath-spec` etc. with
`pi.registerCommand(name, { description, handler: async (args, ctx) => ... })`.
The handler runs the same `guard.py` (same JSON on stdin), shows a refusal with
`ctx.ui.notify(..., "error")`, otherwise runs the step script and hands the
filled-in instructions to the agent with `pi.sendUserMessage(text)`.

One command source per step, rendered for both harnesses; one guard and one
script per step, shared.

**Scripts:** Python 3.11+ (for `tomllib`), standard library only.

---

## 9. Revised mechanism (2026-10-08): skills, subagents, PreToolUse

Supersedes the guard and command mechanism in section 8.

- **One source file per step** (`assets/steps/<step>.md`), invoked as
  `/craftpath-<step> <args>` on both harnesses: a Claude Code skill
  (`.claude/skills/craftpath-<step>/SKILL.md`) and a pi prompt template
  (`.pi/prompts/craftpath-<step>.md`). Step guidance lives in the step: the
  planning skill is part of the plan step. Engineering skills stay separate.
- **Every step runs in a fresh subagent.** Claude Code: `context: fork`,
  `background: false` (a `general-purpose` subagent). pi: the step's first
  instruction hands it to pi-subagents-lite's `Agent` tool (`general-purpose`).
- **Every step starts by running its script**, as an ordinary tool call.
- **The guard is a PreToolUse hook**, the same on both: Claude Code's native
  hook on `Bash`; on pi, craftpath's own extension on `tool_call` (no
  third-party hooks package). Both run `guard.py`, which acts only on a step's
  script and refuses with `{"hookSpecificOutput": {"permissionDecision":
  "deny", ...}}`. The subagent reports the reason and stops.
- **Verified** with the real binaries: the guard fires inside the subagent on
  both, and the reason reaches the user.
- **Trust:** both harnesses load a project's settings, permissions and
  extensions only once the project is trusted (one-time per project).
- **Caveat:** headless pi (`pi -p`) occasionally stalls before producing any
  output. Interactive use is not affected; automation must time out and retry.

---

## 10. `/craftpath-work` (decided 2026-10-09)

`/craftpath-work C-00001 wave 2` runs one wave; `/craftpath-work C-00001 all`
runs every wave with open tasks, one after another, without stopping between
them. Ticked tasks are skipped, so running it again carries on where it left off.

### 10.1 One module per task per wave

**No two tasks in one wave touch the same module.** A task is completed by
running its modules' `test` command; two parallel tasks in one module would
each see the other's half-finished change and fail.

- A task's modules come from its **Touches**: each entry is a module name or a
  path, and a path belongs to the configured module with the longest matching
  `path`. An entry that matches no module is a problem.
- `check_plan` enforces it, so the plan step's self-check reports it and the
  work guard refuses it.
- Consequence (accepted for now, to solve later): with the default config
  (one module, `path = "./"`) every wave
  holds one task. Parallelism comes from declaring modules.

### 10.2 What runs

1. **Guard** (`guards/work.py`): `PLAN.md` is complete (which now includes
   10.1); the argument is `wave <n>` or `all`; the wave exists; for
   `wave <n>`, every earlier wave is ticked.
2. **Script** (`work.py C-00001 <wave n|all>`): prints the open tasks to run,
   grouped by wave, with each task file and its modules' `test` commands.
3. **Per wave, one subagent per open task, in parallel.** Each gets its task
   file and `SPEC.md`, writes the failing integration/e2e test first, then the
   code, and runs its module's tests. It writes notes into its task file. It
   does **not** commit or tick; it ends by saying done, or stuck and why.
4. **After the wave, the step runs `complete.py C-00001 T-0002` for each done
   task, one at a time.** It runs the `test` command of each of the task's
   modules (in the module's directory). Green: ticks the task in `PLAN.md` and
   commits the changes under the task's modules plus its task file and
   `PLAN.md`, as `<type>(C-00001/T-0002): <task title>`. Red: prints the
   output, ticks nothing, commits nothing.
5. With `all`, the next wave starts only when every task of this one is
   ticked -- later waves may depend on it. The step ends with a report: ticked
   tasks with their commits, and stuck or red ones with the reason.

Why the step commits, not the subagents: parallel `git commit` in one worktree
fights over `index.lock`, and one subagent's `git add` would sweep in
another's files. This replaces "the agent commits per task" from 4.3/6.3.

### 10.3 Left to the user, for now

A stuck task, a task whose tests stay red, and tests that were already red
before the work started: the task stays unticked, the report says why, and the
user decides. No failed state, no retry logic. Re-running the step picks the
task up again.

### 10.4 `work` runs in the session (spike, 2026-10-09)

Checked with the real binaries:

- **Claude Code:** a forked skill (`context: fork`) *can* call `Agent`, but the
  nested subagent runs in the background and the forked step returns before
  it finishes. An unforked skill waits for its subagents.
- **pi:** the main session started two `Agent` subagents in parallel (two
  20-second sleeps finished together, 32 s in all). Headless runs need `-a`
  to trust the project, or pi-subagents-lite is not loaded.

So `work` is the one step without `{{DELEGATE}}`: no `context: fork` on
Claude Code, no hand-off paragraph on pi. It runs in the session and starts
the per-task subagents itself.

### 10.5 Acceptance criteria (tests written first)

In `test/steps/work.test.ts`, against a real git repo and worktree:

- **W1** `check.py plan` reports two tasks in one wave whose Touches resolve to
  the same module, naming both and the module.
- **W2** A Touches entry matching no module is reported.
- **W3** The guard refuses `wave 2` while a wave-1 task is unticked, and
  refuses a wave that does not exist.
- **W4** `work.py ... all` lists only unticked tasks, grouped by wave.
- **W5** `complete.py` with green tests ticks the task and makes one commit
  with the task's subject, containing only files under its modules plus its
  task file and `PLAN.md`.
- **W6** `complete.py` with red tests exits 1, leaves `PLAN.md` unchanged and
  makes no commit.
- **W7** (`test/init/init.test.ts`) `init` installs `work` on both harnesses
  without fork or hand-off, and allows `work.py` and `complete.py`.

Status: W1-W7 built and green.

### 10.6 Permissions: broad for now (decided 2026-10-09)

`init` allows `Bash`, `Edit` and `Write` in `.claude/settings.json`, so a step
and its subagents are not stopped by a refused command. Haiku runs showed why:
with a narrow allow-list, a subagent hit by one refusal (`bun --version`, a
shell redirect, a command with `$?`) often reported STUCK without running its
tests -- 0 of 6 tasks done with the list alone. To narrow later; nothing in
craftpath sandboxes the agent until then. A new worktree is a new directory,
so Claude Code applies these only after its trust prompt has been accepted
there.

---

## 11. `/craftpath-review` and `/craftpath-pr` (proposal, 2026-10-09)

Step 4 of 7.2. Builds on 7.1 (incremental `REVIEW.md`) and 7.3.1 (fixing
review points stays manual). Nothing here is built yet.

### 11.1 `/craftpath-review C-00001`

Runs in a subagent, like `spec`, `design` and `plan` (`{{DELEGATE}}`).

1. **Guard** (`guards/review.py`), cheap checks only:
   - `PLAN.md` is complete, and every task in it is ticked; otherwise it names
     the open tasks.
   - Every ticked task has at least one commit on the branch whose subject
     carries `(C-00001/T-0002)` (6.3); otherwise it names the task.
   - No uncommitted changes outside `.craftpath/work/C-00001/`; otherwise it
     lists the files. A review point is marked solved with the commit that
     solved it, and the PR pushes commits, so the review only ever sees
     committed code.
2. **Script** (`review.py C-00001`):
   - Runs the `test` command of **every** module, in the module's directory.
     Red: prints the output, exits 1, and creates or changes nothing. This is
     in the script, not the guard, because the guard hook has a 30-second
     timeout and a full test run can be longer.
   - Creates `REVIEW.md` from the template if it does not exist.
   - Writes the reviewed commit into it: `- **Reviewed at:** <sha>` (HEAD).
   - Prints what to review: the range `<merge-base with base_branch>..HEAD`,
     its commits, the files changed, the open points, and the next free point
     id (one past the highest, so ids never repeat).
3. **The agent** checks the diff against `SPEC.md` and `PLAN.md`, and:
   - re-checks every open point against the current code, and marks a point
     solved, `[x] ... (solved in <sha>)`, only when a commit has solved it;
   - adds new points with the next ids;
   - never deletes or renumbers a point, never edits a `[-]`, never marks one
     won't fix. This is a rule in the step, not checked by a script.
   - The step carries a short *How to review* section, like *How to plan
     well*: every scenario and criterion has its test in the diff; changes
     outside a task's Touches; correctness, errors and security in the
     changed code; tests that assert nothing.
4. **Self-check:** `check.py review C-00001`, reported, not blocking.

**`REVIEW.md` template:**

```
# C-00001 — <title>: review

- **Reviewed at:** <sha>

## Points

<!-- guidance: ... -->
- [ ] R1 [major] src/app.ts:12 -- /health is behind the auth middleware
```

Severity is `major` or `minor`. Both block the PR while open (7.1).

**`check_review`:** the usual template checks, plus every line under Points
matches `- [ |x|-] R<n> [major|minor] <where> -- <what>`; no id appears twice;
an `[x]` names a commit that exists, `(solved in <sha>)`; a `[-]` gives a
reason, `(won't fix: <reason>)`. "No points" is allowed and written `None`.

### 11.2 `/craftpath-pr C-00001`

Runs in a subagent. The agent writes nothing: the script builds the PR, the
agent runs it and reports the URL or the error.

1. **Guard** (`guards/pr.py`):
   - `REVIEW.md` exists, `check_review` passes, and no point is `[ ]`;
     otherwise it names the open points.
   - **The review saw the code being proposed:** no commit after `Reviewed at`
     changes anything outside `.craftpath/work/C-00001/`. Otherwise it names
     those commits and says to run the review again. This is what makes
     "fix the points yourself" safe: your fixes go through one more review
     before the PR.
   - No uncommitted changes outside the work item's directory.
2. **Script** (`pr.py C-00001`):
   2. Commits `REVIEW.md` as `docs(C-00001): add review`, as every step
      commits the file of the step before it (11.5).
   3. `git push -u origin craftpath/C-00001-<slug>`.
   4. If the branch has no PR yet (`gh pr view`), `gh pr create --base
      <base_branch> --head <branch> --title <title> --body-file <file>`.
      If it has one, the push in 3 has already added the new commits to
      it; nothing else changes (11.4.3).
   5. Prints the PR's URL.
   6. If push or `gh` fails, it prints the error and exits 1.
3. **Title:** `<type>(C-00001): <SPEC title>`. The type is `feat` if any task
   is `feat`, otherwise `fix` if any is `fix`, otherwise the first task's type.
   It reads like the task commits, and works as the commit subject of a
   squash merge.
4. **Body**, built by the script from the files, with no agent prose:
   - **Problem**: `SPEC.md`'s Problem section;
   - **Scenarios**: id and name of each;
   - **Tasks**: each task with its commit (`a1b2c3d feat(C-00001/T-0001): ...`);
   - **Review**: every point with its state, including won't-fix reasons;
   - **Out of scope**: from `SPEC.md`.
5. **`doctor`** gains a check that `gh` is installed and logged in. It is
   reported, not blocking: only `pr` needs it.

### 11.3 Acceptance criteria (tests written first)

In `test/steps/review.test.ts` and `test/steps/pr.test.ts`, against a real git
repo and worktree. The PR tests push to a local bare repo as `origin`, and use
a stub `gh` on `PATH` that records its arguments and the body file, so no test
touches GitHub.

**Review**

- **V1** The guard refuses while a task is unticked, naming it.
- **V2** The guard refuses when a ticked task has no commit carrying its id,
  naming the task.
- **V3** The guard refuses with uncommitted changes outside the work item's
  directory, listing them. Changes inside it pass.
- **V4** `review.py` with a module's tests red exits 1 with their output, and
  creates no `REVIEW.md`.
- **V5** `review.py` without `REVIEW.md` creates it with `Reviewed at` = HEAD,
  and prints the range, its commits, the changed files and next id `R1`.
- **V6** `review.py` with an existing `REVIEW.md` keeps every point unchanged,
  updates `Reviewed at`, lists the open points, and gives one past the
  highest id as the next.
- **V7** `check.py review` reports a malformed point line, a duplicate id, an
  `[x]` without an existing commit, and a `[-]` without a reason.

**PR**

- **P1** The guard refuses without `REVIEW.md`, and while a point is open,
  naming it.
- **P2** The guard refuses when a commit after `Reviewed at` changes code
  outside the work item's directory, naming the commit. A commit that only
  changes the work item's files passes.
- **P3** `pr.py` commits `REVIEW.md`, and nothing else, as
  `docs(C-00001): add review`.
- **P4** `pr.py` pushes the branch to `origin` and calls `gh pr create` with
  the base branch, the work item's branch, the title from 11.2.3 and a body
  holding the problem, every task with its commit, and every review point with
  its state.
- **P5** When `gh pr view` finds a PR for the branch, `pr.py` pushes the new
  commits, creates no second PR, and prints the existing PR's URL.
- **P6** When the push or `gh pr create` fails, `pr.py` exits 1 with the error.
- **P7** (`test/doctor/doctor.test.ts`) `doctor` reports a missing `gh`
  without failing.
- **P8** (`test/init/init.test.ts`) `init` installs `review` and `pr` on both
  harnesses, each run in a subagent.

Status: V1-V7 and P1-P8 built and green.

### 11.4 Questions

1. **Committing the work item's files** -- decided: each step's file is
   committed, see 11.5.
2. **PR title** as in 11.2.3 -- decided.
3. **An existing PR:** `pr.py` pushes the new commits to it -- decided. Its
   title and body are left as they are for now.

### 11.5 Every step's file is committed (decided 2026-10-09)

Today `SPEC.md`, `DESIGN.md` and `REVIEW.md` are never committed, and
`PLAN.md` and the task files only along with the tasks. Decided: each step's
file is committed, and is not edited by a later step.

**When:** a step's file is committed by the **next** step's script, as its
first action once the guard has passed. Until then the user can still read
it, edit it or ask for changes, and all of that lands in one commit with the
final text. Committing when the step ends instead would need a second commit
for every change made afterwards.

| Script | Commits, if uncommitted | Message |
|---|---|---|
| `design.py` | `SPEC.md` | `docs(C-00001): add spec` |
| `plan.py` | `SPEC.md`, `DESIGN.md` | `docs(C-00001): add spec` / `add design` |
| `work.py` | `PLAN.md`, `tasks/*.md` | `docs(C-00001): add plan` |
| `pr.py` | `REVIEW.md` | `docs(C-00001): add review` |

- One commit per file kind, and only those files. Nothing is committed when
  nothing is uncommitted, so re-running a step adds no empty commit.
- `review.py` commits nothing: the review is incremental, so `REVIEW.md`
  changes from run to run until `pr` freezes it.
- One shared helper in `craftpath.py`, used by all four scripts.

**Acceptance criteria** (in each step's test file):

- **K1** `plan.py` commits an uncommitted `SPEC.md` and `DESIGN.md` as two
  commits, `add spec` and `add design`, before it writes `PLAN.md`;
  `PLAN.md` is in neither.
- **K2** `design.py` commits an uncommitted `SPEC.md` as `add spec`.
- **K3** `work.py` commits `PLAN.md` and the task files as `add plan` before
  listing the tasks.
- **K4** A script whose files are already committed makes no commit.

Status: K1-K4 built and green.
