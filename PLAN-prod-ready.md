# Plan — what craftpath needs before it runs someone's project

**Status: DRAFT for review.** Written with the `planning` skill.
Covers four of the six gaps from the readiness review: the missing repair
command (1), a version stamp for scaffolded projects (3, proposal only), the
blank config a fresh `init` leaves behind (4), and a README that never shows
the loop (6).

Items 2 (dogfood craftpath on itself) and 5 (split `src/craftpath.test.ts`) are
deliberately not here. 2 is not a code change, it is how this plan should be
executed. 5 is a refactor that wants its own plan.

## Requirement

Craftpath installs cleanly and the kernel works, but three of its own messages
point at a command that does not exist, a fresh project reports `UNUSABLE`
until someone hand-writes config, nothing records which craftpath generated a
project, and the README never walks a work item from `work new` to `archive`.
Each is survivable alone; together they are what makes the difference between
"installs" and "can be adopted".

---

## Item 1 — `craftpath reconcile`

**Already planned.** `PLAN-reconcile.md` (T601–T604) is the plan; it does not
need rewriting. I checked its assumptions against today's code:

| Assumption | Still true |
|---|---|
| Archive renames `work/<id>` first, then `state/<id>` into `<target>/state` | Yes — `src/core/archive.ts:111-113`, so an interrupted archive is exactly `archive/<id>` present with `state/<id>` still in place |
| The trailer pair is the anchor, found by `git log --all-match` | Yes — `trailerInBranch`, `src/core/task.ts:515` |
| `commits_hint` is written by nothing | Yes — set to `[]` at `src/core/task.ts:224` and `:270`, described as "refreshed by reconcile" at `src/schema.ts:282` |
| Four places tell users to run it | Yes — `src/hooks/guard-write.ts:22`, `src/hooks/guard-bash.ts:112`, `src/core/work.ts:235`, `src/commands/work.ts:34` |

Two changes to that plan, both small:

**Q1 is answered: yes.** The draft left "should `validate` suggest reconcile?"
open. It should — `validate --complete` is where a missing trailer is normally
discovered (`src/core/validate.ts:75`), and a report that names the problem
without naming the repair is how people end up hand-editing state. It becomes
T605 below rather than widening T601.

**Execution order.** T601 → T602 → T603/T604 as drafted, with T605 after T601.

---

## T605 — Point validate at reconcile when a trailer is missing

**Type:** feature · **Skills:** `backend` · **Depends on:** T601

`validate --complete` already reports a done task whose trailer is not
reachable. It adds one line naming `craftpath reconcile`, and says to read the
plain report before running `--fix`.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given T001 done with no reachable trailer, when validate --complete runs,
      then its output names `craftpath reconcile` and still exits 1.
    verified_by:
      - cmd: test
        selector: "validate CLI > points at reconcile when a trailer is missing"
  - id: A2
    text: >
      Given a work item with no problems, when validate --complete runs, then
      its output does not mention reconcile.
    verified_by:
      - cmd: test
        selector: "validate CLI > stays quiet about reconcile when nothing drifted"
```

### Out of scope

- The guards' messages. They already point at `reconcile --fix`.

---

## Item 4 — `init` fills in what it can detect

### The decision this reverses

`src/core/init.ts:12` and `src/core/config.ts:17` both record **D21 — no stack
detection**, on the grounds that *"a guessed command that silently does nothing
is worse than a blank one"*. That reasoning is right about guessing and wrong
about detecting, and the difference is evidence: `bun run test` written because
`package.json` declares a `test` script is not a guess. `npm test` written
because a directory looked JavaScript-ish is.

So D21 is narrowed, not dropped: **detect from a declaration, never from a
smell, and leave blank whenever two ecosystems both declare one.** An ADR
recording the narrowing is part of T610.

### The table

| Evidence in the project root | `commands.test` | `commands.lint` |
|---|---|---|
| `package.json` with a `test` / `lint` script | `bun run test` | `bun run lint` |
| `gradlew` | `./gradlew test` | blank |
| `Cargo.toml` | `cargo test` | `cargo clippy -- -D warnings` |
| `go.mod` | `go test ./...` | blank |
| `pyproject.toml` with a `[tool.pytest]` section | `pytest` | blank |
| Two or more of the above | blank | blank |
| None of the above | blank | blank |

Blank keeps today's placeholder comment, so a project that detects nothing is
exactly the project of today.

---

## T610 — Fill config.toml from what the project declares

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`craftpath init` reads the evidence table above and writes what it finds,
printing each filled key so nothing lands silently. An existing config.toml is
still never touched.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a project whose package.json declares test and lint scripts, when
      init runs, then config.toml has run = "bun run test" and run = "bun run
      lint", and the output names both keys as detected.
    verified_by:
      - cmd: test
        selector: "init detection > fills both commands from package.json scripts"
  - id: A2
    text: >
      Given a project with gradlew and no package.json, when init runs, then
      commands.test is "./gradlew test" and commands.lint is still blank.
    verified_by:
      - cmd: test
        selector: "init detection > fills only what the evidence supports"
  - id: A3
    text: >
      Given a project with both package.json and gradlew, when init runs, then
      both commands are blank and the output names neither as detected.
    verified_by:
      - cmd: test
        selector: "init detection > refuses to choose between two ecosystems"
  - id: A4
    text: >
      Given a project with none of the declarations, when init runs, then
      config.toml is byte-for-byte the blank template of today.
    verified_by:
      - cmd: test
        selector: "init detection > leaves an unrecognised project blank"
  - id: A5
    text: >
      Given a project that already has .craftpath/config.toml, when init runs,
      then that file is unchanged and no detection is reported.
    verified_by:
      - cmd: test
        selector: "init detection > never rewrites an existing config"
```

### Out of scope

- `doctor`'s `UNUSABLE` wording. A project that detects nothing still reports
  it, and that is correct: nothing can be verified until someone fills it in.
- Running the detected command to prove it works. Detection is a declaration
  read, not an execution; `doctor` and the first `task verify` are where a
  wrong command surfaces.
- Any ecosystem not in the table. Adding one later is a row plus a test.

---

## Item 3 — a version stamp (proposal, not yet planned)

Nothing in a scaffolded project records which craftpath produced it. `update`
rewrites commands and adds new skills, but has no way to know what shape the
existing files are, so the day a template changes there is no migration path
and no way to warn. This is cheap now and expensive once other people's
projects exist.

### Proposal

**Where:** `[craftpath] version = "0.1.1"` as the first table in
`.craftpath/config.toml`. It is the one file every project has, it is already
written by `init`, and — unlike anything under `.craftpath/state/` — it is not
guarded, so `update` can write it without fighting the hooks it installed.

**Who writes it:** `init` on create; `update` after a successful refresh,
rewriting it to the running CLI's version.

**Who reads it:** `update`, to decide which migrations to run; `doctor`, to
report `scaffolded by 0.1.1, running 0.4.0 — run craftpath update`.

**Migrations:** `src/core/migrations.ts` exporting an ordered list of
`{ since, describe, apply(root) }`. `update` runs every entry newer than the
stamp, prints what each did, then writes the new stamp. Empty list today; the
value is that the mechanism exists before the first breaking template change.

**The one real implementation risk:** config.toml is the user's file, full of
their comments and edits, and `Bun.TOML` parses without serialising. So the
stamp has to be a surgical line edit with a test proving user comments survive
a rewrite — which is why this is a task with content, not a one-liner.

**Rejected:** a separate `.craftpath/VERSION` file (another file to explain,
when config.toml is already mandatory); provenance headers in each generated
file (the README promises those files are the project's to edit, so their
contents cannot be trusted as a signal).

**If this is approved** it is roughly two tasks: write and read the stamp
(`init`, `update`, `doctor`), then the empty migration runner. I have not
written criteria for them, because the shape of the stamp is a decision to take
before the tasks are worth reviewing.

---

## T612 — Walk one work item end to end in the README

**Type:** docs · **Skills:** `backend` · **Depends on:** T602, T610

The README documents install, the command list and the harness table, but never
one complete loop. It gains a walkthrough — `work new` → `task add` →
`task start` → `task verify` → `task done` → `pr body` → `archive` — with the
config section updated to say `init` fills what it can detect, and reconcile
named as the repair path.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the README, when it is read, then it contains the seven loop
      commands in order: work new, task add, task start, task verify, task
      done, pr body, archive.
    verified_by:
      - cmd: test
        selector: "cli install > readme walks one work item end to end"
  - id: A2
    text: >
      Given the README, when the config section is read, then it says init
      fills the commands it can detect and leaves the rest blank, and no longer
      claims they are always blank.
    verified_by:
      - cmd: test
        selector: "cli install > readme describes detected commands"
  - id: A3
    text: >
      Given the README, when it is read, then it names craftpath reconcile as
      what to run when a trailer goes missing.
    verified_by:
      - cmd: test
        selector: "cli install > readme names reconcile as the repair path"
```

### Out of scope

- A tutorial repository or asciinema recording. The walkthrough is prose the
  existing README test style can assert on.

---

## T613 — Describe how a release happens in the README

**Type:** docs · **Skills:** `infrastructure` · **Depends on:** —

`## Development` tells contributors to run `bun run check` and stops. Releases
now happen by merging a version bump: the workflow notices master declares a
version npm does not have, publishes over OIDC, tags, and cuts the Release.
Nobody should be pushing tags by hand, and the README is where that is said.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the README, when the development section is read, then it states
      that merging a package.json version bump to master publishes the release.
    verified_by:
      - cmd: test
        selector: "cli install > readme describes how a release happens"
  - id: A2
    text: >
      Given the README, when it is read, then it does not instruct anyone to
      create a tag or a GitHub Release by hand.
    verified_by:
      - cmd: test
        selector: "cli install > readme leaves tagging to the workflow"
```

### Out of scope

- Documenting the trusted-publisher setup. It is configured once, on the
  registry, and a contributor never touches it.

---

## Dependency graph

```
T601 ──┬──▶ T602 ──┬──▶ T603
       │           ├──▶ T604
       │           └──▶ T612
       └──▶ T605
T610 ──────────────────▶ T612
T613 (independent)
```

Waves: `[T601, T610, T613]` → `[T602, T605]` → `[T603, T604, T612]`.

T612 waits on both T602 and T610 because a README that documents behaviour
before it exists is the failure this repo's whole gate structure is about.

## Open questions

- **Q2 — does `init` ask before writing a detected command?** It already asks
  which harnesses at a terminal, so one more question is cheap. I left it out:
  the value that gets written is printed, `doctor` reports it, and config.toml
  is a text file. Worth reversing if a wrong detection turns out to be hard to
  notice.

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every gap maps to a criterion | Pass — 1 → T601-T605, 4 → T610, 6 → T612/T613; 3 is a proposal and says so |
| 2 | Every criterion names a selector | Pass — 12 new criteria, 0 manual |
| 3 | Every criterion could fail today | Pass — reconcile does not exist, init writes blanks unconditionally, the README contains none of the asserted strings |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — T605-A2 "does not mention", T610-A4 "byte-for-byte", T610-A5 "unchanged", T613-A2 "does not instruct" |
| 6 | Verifiable without an unfinished sibling | Pass |
| 7 | Every depends_on edge would really fail | Pass — T612 asserts strings only T602 and T610 make true; T605 needs T601's detection |
| 8 | Skills match the work | Pass — `backend`, and `infrastructure` on T613 because the subject is the release pipeline |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |
| 11 | Design tasks are consumed | N/A — no design task; item 3 is an explicit decision-first proposal instead |
