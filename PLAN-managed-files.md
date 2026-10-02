# Plan — keep a project's skills, rules and templates current

**Status: DRAFT for review.** Written with the `planning` skill.

## The problem

`init` copies skills, rules and templates into a project, and the README says
they are the project's to edit. Nothing records what was copied, so `update`
cannot tell a file the project edited from one it never touched. It plays safe
and never overwrites any of them:

- a release that improves a skill, a rule or a template never reaches a project
  that already has it;
- `update` does not write templates at all, so a release that adds one never
  reaches an existing project either;
- nothing says a file is out of date. The only way to find out is to diff it
  against the source by hand.

Today the workaround is to delete the file and run `update` (skills, rules) or
`init` (templates), losing any local edit.

## Requirement

After `craftpath update`, a project has the current version of every skill,
rule and template it did not edit, and has been asked about every one it did
edit that the release also changed. No local edit is ever lost without an
explicit answer.

## The design

Spec Kit's install manifest, which is dpkg's conffile model: record a hash of
every file craftpath writes, and on update compare three things — the file on
disk, the hash recorded when craftpath last wrote it, and the content this
release ships.

| On disk vs recorded | Release changed it? | `update` does |
|---|---|---|
| Missing | — | Write it, record it |
| Same | Yes | Overwrite silently, record the new hash |
| Same | No | Nothing |
| Edited | No | Nothing — the edit stays, there is nothing new to offer |
| Edited | Yes | **Conflict** — ask, or keep and write `<file>.new` |

### Decisions

| # | Decision | Why |
|---|---|---|
| M1 | The manifest is `.craftpath/manifest.json`, committed, mapping each project-relative path to `{ sha256, version, declined? }` | Committed for the same reason state/ is: a teammate's clone must make the same decisions. Separate from config.toml so `configHash` (T614-V2) and every piece of evidence stay untouched by an update. |
| M2 | Managed files are the skills, the rules, the templates, and the two README.md files `init` seeds in the rules and skills directories — as rendered for each harness | These are the files the README hands to the project. Rendered per harness because pi receives rules as skills, so the bytes differ by harness. |
| M3 | Slash commands and guard wiring stay outside the manifest and are rewritten every time, as now | They are generated, and a stale one speaks an older protocol while looking installed (`src/core/update.ts`). |
| M4 | The hash is sha256 of the exact bytes written | Any normalisation (line endings, trailing newline) is a judgement about what counts as an edit, and a wrong one silently discards someone's change. |
| M5 | Without a terminal, a conflict keeps the project's file, writes the release's version to `<file>.new` beside it, lists it, and `update` exits 2 after finishing everything else | The run with no terminal is an agent running `update` through its shell. It must neither hang on a prompt nor overwrite an edit, and it must not report success: exit 2 makes the agent read the message and tell the user, where exit 0 would leave the `.new` unnoticed until `doctor` runs. `.new` does not end in `.md`, so no harness loads it as a skill or rule. |
| M6 | "Keep mine" records the declined release hash. The same file is asked about again only when a later release changes it again | Without it, every update re-asks the same question and people learn to answer without reading. |
| M7 | Craftpath ships the hash of every released version of every managed file. A file matching any of them counts as unedited | A project set up before the manifest has no recorded hash, so an unedited file from 0.2.0 looks edited. Without this, the first update after this ships asks about every file in every existing project. |
| M8 | The release's managed files are passed into `update` as a parameter, defaulting to what this build ships | Same seam as `migrations` (T617): tests can simulate "the next release changes this skill" without a second build. |

Rejected:

- Provenance headers inside each file, as OpenSpec does with `generatedBy`
  frontmatter. OpenSpec can do that because it overwrites its files
  unconditionally. Here the file belongs to the project, so its contents cannot
  be trusted to describe its own origin (same reason as T614).
- A three-way merge with `git merge-file`. It needs the base content stored
  too, and with the table above the only remaining case is "both sides
  changed", which is rare. Worth adding if `.new` files turn out to be common.
- A Claude Code plugin, so nothing is copied at all. Plugins cannot ship
  `.claude/rules/`, and pi has no equivalent.

---

## T630 — Record managed files at init

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`init` writes `.craftpath/manifest.json` listing every managed file it wrote
(M1, M2, M4). It still never overwrites an existing file.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given an empty project, when init runs for claude-code with running
      version 0.3.0, then manifest.json lists every skill, rule, template and
      seeded README.md init wrote, each with the sha256 of the bytes on disk
      and version 0.3.0, and lists no other path.
    verified_by:
      - cmd: test
        selector: "managed files > init records every file it writes"
  - id: A2
    text: >
      Given a project where `.craftpath/templates/plan.md` already exists, when
      init runs, then that file is byte-for-byte unchanged and manifest.json
      has no entry for it.
    verified_by:
      - cmd: test
        selector: "managed files > init does not claim a file it kept"
  - id: A3
    text: >
      Given a project init already ran in, when init runs again, then
      manifest.json is byte-for-byte unchanged.
    verified_by:
      - cmd: test
        selector: "managed files > a second init leaves the manifest alone"
  - id: A4
    text: >
      Given an empty project, when init runs for claude-code and pi, then
      manifest.json has an entry for each harness's own rendered path, with
      that file's own hash.
    verified_by:
      - cmd: test
        selector: "managed files > each harness's copy is recorded separately"
```

### Out of scope

- Using the manifest. `update` keeps today's behaviour until T631.
- Projects with no manifest. T631 handles them, and T634 makes that quiet.
- Recording files init kept rather than wrote (A2). The next `update` records
  them (T631-A5), so init does not need the adoption logic too.

---

## T631 — Refresh managed files on update

**Type:** feature · **Skills:** `backend` · **Depends on:** T630

`update` applies the table above. A conflict always takes the non-interactive
path (M5); T632 adds the prompt. Kept as one task because every row of the
table is the same comparison, and shipping the silent overwrite without the
conflict row would ship an update that can destroy an edit.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a skill whose bytes match its manifest hash, when update runs with
      a release whose version of that skill differs, then the file holds the
      release's bytes and its manifest entry has the new hash and version.
    verified_by:
      - cmd: test
        selector: "managed files > update refreshes an unedited file"
  - id: A2
    text: >
      Given a skill edited after init, when update runs with a release whose
      version of that skill is the one recorded, then the file is byte-for-byte
      unchanged, no `.new` file exists, and update exits 0.
    verified_by:
      - cmd: test
        selector: "managed files > update keeps an edit the release does not touch"
  - id: A3
    text: >
      Given a skill edited after init, when update runs without a terminal with
      a release that also changes it, then the file is byte-for-byte unchanged,
      `SKILL.md.new` holds the release's bytes, the output names the file, and
      update exits 2 after refreshing every other file and moving the stamp.
    verified_by:
      - cmd: test
        selector: "managed files > update sets a conflict aside without a terminal"
  - id: A4
    text: >
      Given a project whose `.craftpath/templates/` lacks a template the
      release ships, when update runs, then the template is written and
      recorded.
    verified_by:
      - cmd: test
        selector: "managed files > update adds a template the project lacks"
  - id: A5
    text: >
      Given a managed file with no manifest entry — because the project has
      no manifest, or because init kept the file and so did not record it
      (T630-A2) — when update runs, then the file is recorded and unchanged if
      it equals the release's version, and is a conflict as in A3 if it
      differs.
    verified_by:
      - cmd: test
        selector: "managed files > update adopts a file with no manifest entry"
```

### Out of scope

- Deleting a file a release no longer ships. Rare, and deleting a project's
  file needs its own decision.
- A managed file the project deleted on purpose is written again, as
  `installSkills` does today. Opting out of a skill is a separate feature.

---

## T632 — Ask about each conflict at a terminal

**Type:** feature · **Skills:** `backend` · **Depends on:** T631

At a terminal, each conflict from T631 is a prompt instead of a `.new` file:

```
.claude/skills/backend/SKILL.md was edited locally, and craftpath 0.3.0 changes it.
  [d] show diff   [k] keep mine   [t] take new version   [K] keep all   [T] take all
```

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a conflicting skill and a terminal, when the answer is `t`, then
      the file holds the release's bytes, its manifest entry has the new hash,
      no `.new` file exists, and update exits 0.
    verified_by:
      - cmd: test
        selector: "managed files > taking the new version replaces the file"
  - id: A2
    text: >
      Given a conflicting skill and a terminal, when the answer is `k`, then
      the file is byte-for-byte unchanged, the manifest records the declined
      hash, and a second update with the same release asks nothing and writes
      no `.new`.
    verified_by:
      - cmd: test
        selector: "managed files > keeping mine is remembered"
  - id: A3
    text: >
      Given a skill whose release version was declined, when update runs with
      a release that changes it again, then it is asked about again.
    verified_by:
      - cmd: test
        selector: "managed files > a newer change asks again"
  - id: A4
    text: >
      Given a conflicting skill and a terminal, when the answer is `d`, then
      the output holds a unified diff from the project's file to the release's
      version, and the same file is asked about again with nothing written.
    verified_by:
      - cmd: test
        selector: "managed files > the diff answer shows before deciding"
  - id: A5
    text: >
      Given three conflicting files and a terminal, when the first answer is
      `T`, then all three hold the release's bytes and only one question was
      asked.
    verified_by:
      - cmd: test
        selector: "managed files > take all settles the remaining conflicts"
```

`K` is the same path as `T` with the A2 outcome; A5's test covers the shared
loop, and `K` gets its own test without a criterion of its own.

### Out of scope

- An editor or merge tool launched from the prompt.

---

## T633 — Settle every conflict with a flag

**Type:** feature · **Skills:** `backend` · **Depends on:** T632

`craftpath update --keep` and `--take` answer every conflict without a prompt,
so an agent can finish an update with exit 0.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a conflicting skill and no terminal, when update runs with
      `--take`, then the file holds the release's bytes, no `.new` exists, and
      update exits 0.
    verified_by:
      - cmd: test
        selector: "managed files > --take settles conflicts without asking"
  - id: A2
    text: >
      Given a conflicting skill and no terminal, when update runs with
      `--keep`, then the file is byte-for-byte unchanged, the manifest records
      the declined hash, no `.new` exists, and update exits 0.
    verified_by:
      - cmd: test
        selector: "managed files > --keep settles conflicts without asking"
  - id: A3
    text: >
      Given any project, when update runs with both `--keep` and `--take`,
      then it exits 4 and no file in the project changes.
    verified_by:
      - cmd: test
        selector: "managed files > --keep and --take refuse each other"
```

Depends on T632 rather than T631 because A2 writes the declined hash T632
introduces.

---

## T634 — Recognise files from earlier releases

**Type:** feature · **Skills:** `backend` · **Depends on:** T631

Ships the hash of every released version of every managed file (M7), and T631's
adoption path treats a match as unedited. A test keeps the list complete.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a project with no manifest whose backend skill is the 0.2.0
      version, when update runs with a release that changes it, then the file
      holds the release's bytes, is recorded, and no `.new` exists.
    verified_by:
      - cmd: test
        selector: "managed files > a file from an earlier release counts as unedited"
  - id: A2
    text: >
      Given a project with no manifest whose backend skill matches no released
      version, when update runs without a terminal, then it is a conflict as
      in T631-A3.
    verified_by:
      - cmd: test
        selector: "managed files > a file matching no release is still a conflict"
  - id: A3
    text: >
      Given the managed files this build ships, for every harness, then the
      hash of each is in the known-hashes list, so changing a skill without
      recording its hash fails the suite.
    verified_by:
      - cmd: test
        selector: "managed files > every shipped file's hash is known"
  - id: A4
    text: >
      Given the known-hashes list, then it holds an entry for each managed
      file as init wrote it in v0.1.0, v0.1.1 and v0.2.0.
    verified_by:
      - cmd: test
        selector: "managed files > every past release is known"
```

A4's expected hashes are produced once by running each tag's `init` into a
scratch directory. The script that does it is committed so the list can be
regenerated, and is not run by the suite.

### Out of scope

- Recording a release's hashes automatically in the release workflow. A3 makes
  forgetting fail CI, which is enough until it proves annoying.

---

## T635 — Report managed files in doctor

**Type:** feature · **Skills:** `backend` · **Depends on:** T630

`doctor` says which managed files are edited and which conflicts are waiting.
Informational: it does not change doctor's exit code.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a project where one skill differs from its manifest hash, when
      doctor runs, then the output names that file as edited, and doctor's
      exit code is what it is without the edit.
    verified_by:
      - cmd: test
        selector: "managed files > doctor names an edited file"
  - id: A2
    text: >
      Given a project with a `SKILL.md.new` beside a managed skill, when doctor
      runs, then the output names it and tells the user to run `craftpath
      update` at a terminal or with `--keep` or `--take`.
    verified_by:
      - cmd: test
        selector: "managed files > doctor names a waiting conflict"
  - id: A3
    text: >
      Given a project where every managed file matches its manifest hash, when
      doctor runs, then the output has no line about managed files.
    verified_by:
      - cmd: test
        selector: "managed files > doctor is quiet when nothing is edited"
  - id: A4
    text: >
      Given a project with no manifest, when doctor runs, then the output says
      `craftpath update` will record the managed files.
    verified_by:
      - cmd: test
        selector: "managed files > doctor notices a missing manifest"
```

A2 names flags from T633 in a message only, so it does not need T633 to pass.

---

## T636 — Describe managed files in the README

**Type:** docs · **Skills:** — · **Depends on:** T632, T633

Replaces "They are the project's copies — edit them freely" and the sentence
saying `update` only adds missing skills and rules with what now happens: edit
freely, `update` refreshes what you did not edit and asks about what you did,
`--keep`/`--take` for unattended runs, `.new` files, and `doctor`.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the README, then it no longer says `update` only adds missing
      skills or rules, and it names `--keep`, `--take`, `.new` and
      `.craftpath/manifest.json`.
    verified_by:
      - cmd: test
        selector: "cli install > readme describes managed files"
```

Waits on T632 and T633 because a README describing behaviour before it exists
is the failure T612 was held back for.

---

## Dependency graph

```
T630 ──┬──▶ T631 ──┬──▶ T632 ──▶ T633 ──┐
       │           └──▶ T634            ├──▶ T636
       └──▶ T635                        │
                    T632 ───────────────┘
```

Waves: `[T630]` → `[T631, T635]` → `[T632, T634]` → `[T633]` → `[T636]`.

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every gap maps to a criterion | Pass — changed files never arrive → T631-A1, T634-A1; templates never added → T631-A4; edits never lost → T631-A2/A3, T632-A2, T633-A2; no signal → T635 |
| 2 | Every criterion names a selector | Pass — 26 criteria, 0 manual |
| 3 | Every criterion could fail today | Pass — there is no manifest, no `.new`, no prompt, no flags; T634-A2 and T635-A3 are guards against "always overwrite" and "always talk" |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — "byte-for-byte unchanged" in T630-A2/A3, T631-A2/A3, T632-A2, T633-A2; "no `.new`" in T631-A2, T632-A1/A2, T633-A1/A2, T634-A1; "no file changes" in T633-A3; "no line" in T635-A3 |
| 6 | Verifiable without an unfinished sibling | Pass — M8 lets every update test pass its own release in |
| 7 | Every depends_on edge would really fail | Pass — T631/T635 read the manifest T630 writes; T632/T634 extend T631's conflict path; T633-A2 writes T632's declined hash; T636 documents T632/T633 |
| 8 | Skills match the work | Pass — `backend` throughout; none on the README task |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |
| 11 | Design tasks are consumed | N/A — decisions recorded as M1–M8 above |
