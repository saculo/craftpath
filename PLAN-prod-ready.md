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

## Item 3 — a version stamp

Nothing in a scaffolded project records which craftpath produced it. `update`
rewrites commands and adds new skills, but has no way to know what shape the
existing files are, so the day a template changes there is no migration path
and no way to warn. This is cheap now and expensive once other people's
projects exist.

### Decisions

| # | Decision | Why |
|---|---|---|
| V1 | The stamp is `[craftpath]\nversion = "<x.y.z>"\n\n`, the first table in `.craftpath/config.toml` | Decided at review. Every project has the file, `init` already writes it, and nothing guards it, so `update` can write it without fighting its own hooks. |
| V2 | `configHash` hashes the file with that exact block removed | The hash covers the whole file today (`src/core/task.ts:231`), so an `update` that rewrites the stamp would make every piece of evidence stale on every upgrade. Removing the exact block also means stamping a pre-stamp project leaves its hash, and so its evidence, unchanged. |
| V3 | The stamp is edited as text, never re-serialised | `Bun.TOML` parses without serialising, and config.toml is the user's file, full of their comments. |
| V4 | A project with no stamp reads as older than every release | It was set up before stamps existed, so every migration applies to it. |
| V5 | `update` refuses a stamp newer than the running CLI | It would rewrite commands with older templates over a project set up by a newer craftpath. A downgrade is a decision, not something to do silently. |

Rejected: a separate `.craftpath/VERSION` file (another file to explain, when
config.toml is already mandatory); provenance headers in each generated file
(the README promises those files are the project's to edit, so their contents
cannot be trusted as a signal).

Kept as four tasks rather than two: the stamp format and hash (T614) is what
the other three build on, and `doctor` (T616) is independent of `update`
(T615, T617), so it can land in the same wave.

---

## T614 — Stamp the version at init

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`init` writes the stamp as the first table of a new config.toml, config loads
with it, and `configHash` ignores it (V2).

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a project with no config.toml, when init runs with running version
      0.3.0, then config.toml starts with `[craftpath]\nversion = "0.3.0"\n\n`
      and the rest of the file is exactly what init wrote before this task.
    verified_by:
      - cmd: test
        selector: "version stamp > init writes the running version first"
  - id: A2
    text: >
      Given a config.toml carrying the stamp, when it is loaded, then loading
      succeeds and the stamp's version is readable.
    verified_by:
      - cmd: test
        selector: "version stamp > config loads with the stamp"
  - id: A3
    text: >
      Given a config.toml, when the stamp block is added, removed, or its
      version changed, then configHash returns the same value as before.
    verified_by:
      - cmd: test
        selector: "version stamp > the stamp is not part of the config hash"
  - id: A4
    text: >
      Given a config.toml, when any line outside the stamp block changes, then
      configHash returns a different value.
    verified_by:
      - cmd: test
        selector: "version stamp > the rest of the file still is"
```

T610-A4 ("byte-for-byte the blank template") is rewritten to "the stamp,
then byte-for-byte the blank template", not left to fail.

### Out of scope

- An older CLI reading a newer project. `Config` is strict, so a pre-stamp
  craftpath refuses the `[craftpath]` table as an unknown key. That is the
  right outcome with an unhelpful message, and only those older CLIs can hit it.

---

## T615 — Refresh the stamp on update

**Type:** feature · **Skills:** `backend` · **Depends on:** T614

After a successful refresh, `update` writes the running version into the
stamp, adding it to a project that has none. It refuses a newer stamp (V5).

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a config.toml with no stamp and a user comment, when update runs
      with running version 0.3.0, then the file is the stamp for 0.3.0
      followed by the previous content byte-for-byte.
    verified_by:
      - cmd: test
        selector: "version stamp > update stamps a project that has none"
  - id: A2
    text: >
      Given a stamp of 0.1.1, when update runs with running version 0.3.0, then
      the stamp reads 0.3.0 and every byte outside it is unchanged.
    verified_by:
      - cmd: test
        selector: "version stamp > update moves the stamp forward"
  - id: A3
    text: >
      Given a stamp of 0.4.0, when update runs with running version 0.3.0, then
      it exits 2 naming both versions, and neither config.toml nor any
      generated command file changes.
    verified_by:
      - cmd: test
        selector: "version stamp > update refuses a newer stamp"
```

### Out of scope

- Migrations. T617 runs them between the refresh and writing the stamp.

---

## T616 — Report the stamp in doctor

**Type:** feature · **Skills:** `backend` · **Depends on:** T614

`doctor` says when the project and the CLI disagree, and what to run. Every
case is reported and never fatal, like the rest of `doctor` (§8).

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a stamp of 0.1.1 and running version 0.3.0, when doctor runs, then
      it prints both versions and `craftpath update`, and exits 0.
    verified_by:
      - cmd: test
        selector: "version stamp > doctor names an older project"
  - id: A2
    text: >
      Given a config.toml with no stamp, when doctor runs, then it says the
      project has no version stamp and names `craftpath update`.
    verified_by:
      - cmd: test
        selector: "version stamp > doctor names a project with no stamp"
  - id: A3
    text: >
      Given a stamp of 0.4.0 and running version 0.3.0, when doctor runs, then
      it says to upgrade craftpath and does not suggest `craftpath update`.
    verified_by:
      - cmd: test
        selector: "version stamp > doctor names a newer project"
  - id: A4
    text: >
      Given a stamp equal to the running version, when doctor runs, then its
      output contains no line about versions.
    verified_by:
      - cmd: test
        selector: "version stamp > doctor is quiet when versions match"
```

---

## T617 — Run migrations on update

**Type:** feature · **Skills:** `backend` · **Depends on:** T615

`src/core/migrations.ts` exports an ordered list of
`{ since, describe, apply(root) }`, empty today. `update` runs every entry
newer than the stamp and no newer than the running version, printing each
`describe`, and writes the stamp only once they have all succeeded. Tests pass
their own list; the shipped one stays empty.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given migrations for 0.2.0 and 0.3.0, a stamp of 0.2.0 and running
      version 0.3.0, when update runs, then only the 0.3.0 migration runs, its
      describe is printed, and the stamp reads 0.3.0.
    verified_by:
      - cmd: test
        selector: "migrations > run only what is newer than the stamp"
  - id: A2
    text: >
      Given migrations for 0.2.0 and 0.3.0 and no stamp, when update runs with
      running version 0.3.0, then both run, 0.2.0 first.
    verified_by:
      - cmd: test
        selector: "migrations > a project with no stamp gets every migration"
  - id: A3
    text: >
      Given migrations for 0.2.0 and 0.3.0 where 0.2.0 throws, a stamp of 0.1.1
      and running version 0.3.0, when update runs, then it exits non-zero
      naming 0.2.0, the 0.3.0 migration does not run, and the stamp still
      reads 0.1.1.
    verified_by:
      - cmd: test
        selector: "migrations > a failed migration leaves the stamp behind"
```

### Out of scope

- Rolling back a migration that half-applied. The stamp not moving means the
  next `update` retries it, so a migration must be safe to run twice.

---

## T606 — Tell the truth about a work directory with no state

**Type:** fix · **Skills:** `backend` · **Depends on:** —

Every command that reads the open work item (`status` and the rest) refuses
with *"Run `craftpath reconcile` once it exists, or remove the directory."*
Reconcile exists, and for this case `--fix` deliberately does nothing (T602-A3),
so the message sends people to a command that sends them back.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given work/0001-avatar-upload with no state/0001-avatar-upload/work.json,
      when status runs, then it exits 3, says an interrupted `work new` leaves
      this, and says to remove the directory and run `work new` again.
    verified_by:
      - cmd: test
        selector: "status > a work directory with no state says how to recover"
  - id: A2
    text: >
      Given the same directory, when status runs, then the output does not
      contain "once it exists" and does not tell the user to run reconcile to
      repair it.
    verified_by:
      - cmd: test
        selector: "status > a work directory with no state does not promise a repair"
```

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
T614 ──┬──▶ T615 ──▶ T617
       └──▶ T616
T606 (independent)
```

Done: T601–T605, T610, T613. Remaining waves: `[T612, T614, T606]` →
`[T615, T616]` → `[T617]`.

T612 waits on both T602 and T610 because a README that documents behaviour
before it exists is the failure this repo's whole gate structure is about.
T615 and T616 wait on T614 because `Config` is strict: until T614 teaches it
the `[craftpath]` table, loading a stamped config fails.

## Open questions

- **Q2 — does `init` ask before writing a detected command?** It already asks
  which harnesses at a terminal, so one more question is cheap. I left it out:
  the value that gets written is printed, `doctor` reports it, and config.toml
  is a text file. Worth reversing if a wrong detection turns out to be hard to
  notice.

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every gap maps to a criterion | Pass — 1 → T601-T606, 3 → T614-T617, 4 → T610, 6 → T612/T613 |
| 2 | Every criterion names a selector | Pass — 28 criteria, 0 manual |
| 3 | Every criterion could fail today | Pass, with guards named — T614-A4 and T616-A4 hold today and exist to stop the change going too far (a hash that ignores everything, a doctor that always talks about versions), like T610-A3 to A5 did |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — adds T615-A1/A2 "byte-for-byte"/"unchanged", T615-A3 "neither … changes", T616-A3 "does not suggest", T616-A4 "no line", T617-A3 "does not run", T606-A2 "does not contain" |
| 6 | Verifiable without an unfinished sibling | Pass — tests pass the running version and the migration list in |
| 7 | Every depends_on edge would really fail | Pass — T615/T616 load a stamped config T614 makes valid; T617 writes the stamp after migrations, which T615 introduces |
| 8 | Skills match the work | Pass — `backend`, and `infrastructure` on T613 because the subject is the release pipeline |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |
| 11 | Design tasks are consumed | N/A — item 3's decisions are recorded as V1–V5 above |
