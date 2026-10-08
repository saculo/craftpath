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
