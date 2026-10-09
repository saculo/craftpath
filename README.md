# craftpath

A spec-first, test-first workflow for coding agents, on **Claude Code** and
**[pi](https://pi.dev)**.

You describe a change; craftpath takes it through a spec, an optional design,
a plan of small tasks, the implementation (each task test-first, in parallel
where it can be), a review, what is worth keeping, and a pull request. Each
step is a skill you run yourself. Before a step starts, a guard checks that
what it needs is there and complete; a script writes the step's file from a
template; the agent fills it in; you read it, change it if you want, and run
the next step. Every bit of state is Markdown in the repository.

## Install

craftpath needs [Bun](https://bun.sh), Python 3.11+ and git; `/craftpath-pr`
also needs the [GitHub CLI](https://cli.github.com), logged in.

```bash
bun add -g craftpath
craftpath version
```

Then, in a project:

```bash
craftpath init --harness claude-code      # or pi, or claude-code,pi
git add -A && git commit -m "chore: install craftpath"
craftpath doctor
```

Commit what `init` wrote: every work item is created from the base branch, so
craftpath's files have to be on it. Without `--harness`, `init` installs for
the harnesses whose directory (`.claude/`, `.pi/`) the project already has, or
for Claude Code.

**On pi**, once per project: `pi install -l npm:pi-subagents-lite` (every step
runs in a subagent), and trust the project (`pi -a`), or its skills and hooks
do not load.

## The flow

Each step takes the work item's id. On Claude Code a step is `/craftpath-plan
C-00001`; on pi, `/skill:craftpath-plan C-00001`.

| Step | Needs | Writes | Then you |
|---|---|---|---|
| `/craftpath-spec <what you want>` | -- | a work item: its branch, its worktree, `SPEC.md` | answer its open questions with `/craftpath-spec <id> <answers>`, or edit it |
| `/craftpath-design <id>` (optional) | a complete `SPEC.md` | `DESIGN.md`: decisions that shape the task list | read and edit it |
| `/craftpath-plan <id>` | a complete spec (and design) | `PLAN.md` and one file per task: criteria, each naming the test that proves it, and waves | read and edit it |
| `/craftpath-work <id> wave <n>` or `all` | a complete plan | code: one subagent per task, a wave at a time, each test-first | read the code |
| `/craftpath-review <id>` | every task done and committed; every module's tests green | `REVIEW.md`: numbered points, re-checked on every run | fix points, or mark them won't fix, and review again |
| `/craftpath-learn <id>` (optional) | no open review point | `KNOWLEDGE.md`: ADRs and lines for agents, worth keeping | tick the ones to keep |
| `/craftpath-learn-apply <id>` | `KNOWLEDGE.md` | the ticked ones: `docs/adr/ADR-0001.md`, a line under `## Learned` in `CLAUDE.md` / `AGENTS.md` | -- |
| `/craftpath-pr <id>` | no open review point, and no code changed since the review | the pull request, its body built from the files | merge it |

No step starts the next one: you do, when you are satisfied with the last.

### Before a spec: brainstorm

`/craftpath-brainstorm <an idea or a problem>` is outside the flow: no work
item, no files, no code. It talks the idea through with you -- first what you
are trying to achieve, then rounds of numbered questions, each with its
recommended answer, until every decision is made -- writes back what you
agreed, and ends with a `/craftpath-spec` request ready to paste.

### A work item

`/craftpath-spec` gives the work item an id (`C-00001`), a short title the
agent derives from your request, a branch (`craftpath/C-00001-<slug>`) and a
worktree inside the project at `.craftpath/worktrees/C-00001-<slug>/`, so
several can be open at once. The worktrees folder is git-ignored (`init` adds
it to `.gitignore`), so your checkout stays clean; `git worktree list` and your
branches show each one. Its files live in the worktree:

```
.craftpath/work/C-00001/
  SPEC.md          problem, scenarios (Given / When / Then), out of scope, open questions
  DESIGN.md        optional
  PLAN.md          goal, approach, tasks by wave -- a task is ticked when it is done
  tasks/T-0001.md  type, wave, what it touches, its acceptance criteria, notes
  REVIEW.md
  KNOWLEDGE.md
```

Each step commits the previous step's file when it starts, so you can edit a
file until you run the next step. A task's commit is
`<type>(C-00001/T-0001): <title>`.

### Tests come first

Every acceptance criterion names the integration or e2e test that proves it.
The task's subagent writes that test first, runs it and watches it fail, then
writes the code (`.claude/rules/tdd.md`, or the `tdd` skill on pi). A task is
ticked only by `complete.py`, which runs the tests of every module the task
touches and refuses while one is red. Nothing checks that the test failed
first: that part is the rule, not a mechanism.

### Modules

`.craftpath/config.toml` lists the project's modules: directories with their
own test command.

```toml
[git]
base_branch = "main"

[modules.api]
path = "api/"
test = "bun test"

[modules.web]
path = "web/"
test = "bun test"
```

A task names the files or modules it touches. Tasks in one wave run in
parallel, so the plan refuses two of them touching the same module -- with a
single module, every wave holds one task.

## What it does not do

- **It is not a sandbox.** On Claude Code, `init` allows shell commands and
  edits broadly, so a step and its subagents are not stopped halfway. pi has
  no permission system at all.
- **A guard is a check before a step, not a policy on the agent.** It decides
  whether the step may start; what the agent then does is up to the agent and
  to the rules it was given.
- **One person at a time.** There are no locks; two people running steps on
  the same work item will trip over each other.
- **Finished work items are yours to clean up**: remove the worktree when the
  pull request is merged (`git worktree remove`).

## Updating

Run `craftpath init` again after upgrading craftpath (`bun update -g
craftpath`). A file you never edited is replaced; one you edited is kept, and
the new version is written beside it as `<file>.new` for you to merge.
`craftpath doctor` checks Python, the base branch, the guard wiring, each
module's test command and `gh`.

## Developing craftpath

```bash
git clone https://github.com/saculo/craftpath.git
cd craftpath
bun install
bun add -g "$PWD"     # use the checkout as the installed craftpath
bun run check         # lint, typecheck, tests and the coverage gate
```

Real-model evals -- each step against a small fixture, graded from the files
and git it leaves behind -- run by hand, since they cost money:

```bash
bun evals/llm/run.ts all --harness both
```

### Releasing

A release is a reviewed pull request that bumps `version` in `package.json`.
Merging it to `master` is the whole release: the `release` workflow sees that
master declares a version npm does not have, runs `bun run check`, publishes
to npm, then tags `v<version>` and creates the GitHub Release. Leave tagging to
the workflow: it reads an existing tag as "already released".

## License

MIT
