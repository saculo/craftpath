# C-00003 — Steps decide instead of asking

## Problem

The spec, plan, work and review steps stop to ask the user things they could
decide themselves -- how to name something, which of two equivalent mechanisms
to use, how to word a criterion. Each such stop costs the user a round trip,
when they would rather the step carried on and let them correct the result
afterwards.

Nothing in the installed steps says where the line is. The steps' own text
leans towards asking: the spec step says "Do not invent answers", the design
step sends anything undecided "back to the user as a question", and the work
brief tells a task's subagent to stop when the task "cannot be done as
written". None of them separates a question about *what* gets built, which
is the user's, from a question about *how*, which the step can settle and
record.

craftpath has no notion of a principle today: `assets/skills/` holds only the
engineering skills (`architecture`, `backend`, `frontend`, `infrastructure`,
`testing`, `ux`), which a task's Notes or the design step name for one kind of
work. There is no shared rule of conduct that several steps load.

The ideas come from pstack; the skill is craftpath's own text, written in
craftpath's terms (work item, spec, step, task), not copied from pstack.

## Scenarios

### S1 — init installs the principle on Claude Code

- **Given** a project with no craftpath installed
- **When** `craftpath init --harness claude-code` runs
- **Then** `.claude/skills/never-block-on-the-human/SKILL.md` exists, with
  `name: never-block-on-the-human` and a `description` in its front matter, and
  contains no unrendered `{{` token
- **And** it is not a step: its front matter has no
  `disable-model-invocation: true` and no `context: fork`, and no
  `/craftpath-never-block-on-the-human` command is installed

### S2 — init installs the principle on pi

- **Given** a project with no craftpath installed
- **When** `craftpath init --harness pi` runs
- **Then** `.pi/skills/never-block-on-the-human/SKILL.md` exists with the same
  name and description as on Claude Code, and contains no unrendered `{{` token

### S3 — the principle says when to stop and when to decide

- **Given** the installed `never-block-on-the-human` skill
- **When** its text is read
- **Then** it says to stop and ask only when continuing would change what gets
  built, and names the three cases: scope, intent, and a user-visible behaviour
  the spec did not settle
- **And** it says every question about *how* is decided by the step, not asked
- **And** it says every decision taken this way is written down, with its
  reason, where the user will see it
- **And** it does not say where each step writes its decisions

### S4 — the spec, plan and review steps load the principle

- **Given** craftpath installed on Claude Code and on pi
- **When** the installed `craftpath-spec`, `craftpath-plan` and
  `craftpath-review` skills are read, on each harness
- **Then** each one tells the agent to load the `never-block-on-the-human`
  skill before it does the step's work

### S5 — the work step loads the principle for each task

- **Given** craftpath installed on Claude Code and on pi
- **When** the installed `craftpath-work` skill is read, on each harness
- **Then** the brief it gives each task's subagent tells that subagent to load
  the `never-block-on-the-human` skill, alongside the engineering skills the
  task's Notes name -- the task's subagent is where work's decisions are made

### S6 — steps outside the four do not load it

- **Given** craftpath installed on Claude Code and on pi
- **When** the installed `craftpath-brainstorm`, `craftpath-design`,
  `craftpath-pr`, `craftpath-learn` and `craftpath-learn-apply` skills are read
- **Then** none of them names `never-block-on-the-human` -- in particular
  brainstorm, whose job is to talk the request through with the user

### S7 — a principle is a skill a step names

- **Given** the craftpath sources
- **When** a test lists every principle skill named by a step source in
  `assets/steps/`
- **Then** each one has its source at `assets/skills/<name>/SKILL.md`, so
  `init` installs it the way it installs the engineering skills, with no
  per-principle code in `init` -- the pattern later principles follow
- **And** `never-block-on-the-human` is one of them

### S8 — re-running init updates an installed project

- **Given** a project where an earlier craftpath release was installed, without
  the principle
- **When** `craftpath init` runs again with this release
- **Then** the principle skill is created, the four step skills are updated to
  name it, and no other installed file the user edited is overwritten

## Out of scope

- Where each step writes its decisions (an assumptions section in `SPEC.md`,
  a decisions list in a task's Notes, ...): later specs. This work only says
  that decisions are written down.
- Rewording the steps' existing instructions about questions ("Do not invent
  answers", design's questions back to the user, the work brief's `STUCK`).
  They stay as they are; the later specs that settle where decisions go
  revise them.
- Any principle other than this one.
- The design step loading the principle: it is not one of the four named.
- Enforcing the principle -- no check, guard or script refuses a step that
  asked a question it could have decided; it binds by reading.
- Copying pstack's text: the ideas are reused, the wording is craftpath's.

## Open questions

None
