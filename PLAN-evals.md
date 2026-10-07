# Plan: evals -- prove flows, not functions

## Revision 2026-10-08 -- read this first

Decisions taken after the audit fixes (#92-#103) landed:

1. **End to end means a real agent.** The flows that matter most run the real
   `claude` and `pi` binaries, headless (`claude -p --output-format
   stream-json`, `pi -p --mode json`), against a **real model**, inside a
   throwaway fixture repo with craftpath installed. That is tier L, and it moves
   up: it comes right after the shared kit (T641), before the CLI flows.
2. **The scripted model (tier H, T650-T652) is optional.** It is revisited only
   if real-model runs turn out too flaky or too costly to debug wiring with.
3. **Gates in fixtures are real config.** Fixtures set `[gates]` to `auto` in
   their own `config.toml`, so approvals are recorded, not bypassed. A scenario
   that tests a manual gate drives `/craftpath:approve` like a user would.
4. **Every real run is capped and asks first.** Worst-case cost is printed and
   confirmed before anything spends; turns, minutes and dollars are hard caps
   (`--max-budget-usd` on Claude Code; the runner enforces the rest). Hitting
   a cap is a failure, never a retry.
5. **CLI flows (F) and the test cleanup (T648/T649) still happen.** F is the
   free, deterministic CI layer; the split of `src/craftpath.test.ts` depends
   on it.
6. **One person at a time.** No flow or scenario exercises concurrent runs.

Corrections to what follows, which predates the fixes:

- The suite is green (618 tests); T640's precondition is met.
- New invariants, checked with I1-I8: **I9** no task is in progress or done
  while the plan gate is pending; **I10** an approved result means every task
  is done; **I11** a done task's evidence matches the current source tree and
  no source is uncommitted; **I12** `task next` never returns a task with an
  unanswered outcome; **I13** the Stop hook refuses at most once per stop.
- F4 covers a source change as well as a config edit (#94, #102). F11 uses the
  terminating Stop policy (#92). F6 uses explicit `--work` only.
- Delegation is `task next` -> the harness's own subagent -> `task report`
  (#103). `craftpath_task` no longer exists; H3/H4 and the L scenarios drive
  the next/report loop.
- T647 is mostly done (`src/commands/consistency.test.ts`, #98); what remains
  is skill names in skills and rules.
- Work ids are `W-0001-...`; examples below that say `0001` mean `W-0001`.
- Open question 3 is resolved (nothing failing); question 2 is decision 3.

**Order of work now:** T640 -> T641 -> T653' real-model runner (spike first:
one tiny scenario on each harness, recording what a run costs and how it is
traced) -> T654 graders -> T655 L1, L2, L5 -> T642 invariants + DSL -> T643-T645
flows -> T646 P1 -> T648/T649 cleanup -> T656 judge + remaining L scenarios.

## The problem

The suite is large and still lets real bugs through.

- **525 tests, 7,246 lines, ~10 s** -- 283 of them in one 4,188-line file,
  `src/craftpath.test.ts`. Two are failing on `work/pi-standard-subagent` at the
  time of writing (`managed files > --take/--keep settles conflicts without
  asking`, `generated slash commands > records every gate approval`).
- **Most tests prove one call in isolation.** They build a state, call one
  function or one command, check one result. The bugs that escape live in
  *sequences*: two open work items, config edited after evidence, a fresh
  clone, `update` after a hand edit, a harness starting a subagent.
- **Some tests grep generated text instead of running it.** The pi subagent hang
  is the reference case. Before `5cd4a36` the tests for `craftpath_task` were:

  ```ts
  expect(PI_EXTENSION).not.toContain("spawnSync");
  expect(PI_EXTENSION).toMatch(/signal: ctx\??\.signal/);
  expect(PI_EXTENSION).toContain('child.kill("SIGTERM")');
  ```

  No test loaded the extension into pi, started a task, or waited for the child
  to exit. "Starting a task in pi hangs" could not fail a test. Roughly 45 tests
  across `commands.test.ts`, `render.test.ts`, `pi-extension.test.ts` and
  `craftpath.test.ts` assert on generated source or prose the same way.
- **Nothing measures the agent side.** Craftpath is worth what an agent does
  with its commands and skills: test first, never touch state, criteria that can
  fail. No test runs an agent.

## The design

Four tiers. Each answers a different question, runs in a different place, and
costs a different amount.

| Tier | Question | Model | Cost | Runs |
|---|---|---|---|---|
| **Unit** | Is this pure rule right for every input? | none | free | `bun test`, CI |
| **Flow (F) + Property (P)** | Does the CLI hold together across a whole journey and any order of commands? | none | free | `bun test`, CI |
| **Harness (H)** | Does the real `claude` / `pi` binary run craftpath end to end -- hooks, extension, slash commands, subagents -- without hanging? | **fake** (scripted) | free, needs binaries | **local only**: `bun run eval:harness` |
| **LLM (L)** | Does a real agent, driven by craftpath, do the job well? | real | **paid** | **local only**: `bun run eval:llm` |

H and L are local-only for now: H needs `claude` and `pi` installed, L costs
money. Their files are `*.eval.ts`, which `bun test` does not discover, so
neither can run by accident in CI or in `bun run check`. Moving H into CI later
needs only the binaries on the runner -- never an API key.

### Layout

```
evals/
  kit/                       shared by every tier above unit
    repo.ts                  fixture repo builder: git init, craftpath init --harness,
                             modules, or start from a mid-flow snapshot
    cli.ts                   craftpath as a subprocess -> { exit, stdout, stderr }
    world.ts                 .craftpath state + git read into one typed snapshot
    invariants.ts            global truths, checked after every flow step
    flow.ts                  the flow DSL (below)
    fake-model/              scripted model server + script DSL          (H only)
    harness.ts               launch claude / pi headless, collect a run  (H, L)
    trace.ts                 claude stream-json + pi --mode json -> one event list
  flows/*.flow.test.ts       tier F  -- CI
  properties/*.test.ts       tier P  -- CI
  regressions/*.test.ts      one per escaped bug, named after it -- CI
  harness/*.eval.ts          tier H  -- local
  llm/
    run.ts                   runner: budget, cost estimate + confirm, trials, results
    fixtures/                small real projects the agent works in
    scenarios/<id>/scenario.yaml (+ rubric.md when judged)
    graders/deterministic/   trace + state + git checks
    graders/judge/           rubric judge + hand-labelled calibration set
    results/                 gitignored jsonl
```

Scripts:

```json
"test":         "bun test",
"eval:harness": "bun evals/harness/run.ts",
"eval:llm":     "bun evals/llm/run.ts"
```

### The flow DSL

A flow reads as a journey. Every step runs the real CLI in a real git repo, and
**every invariant is checked after every step** without the flow asking for it
-- that is where the bugs nobody wrote an assertion for get caught.

```ts
flow("a stale proof does not complete a task", async (w) => {
    await w.init({ harness: "claude-code" });
    await w.run(`work new "Health endpoint"`).ok();
    await w.plan({ T001: { criterion: "GET /health is 200", cmd: "test" } });
    await w.run("task start T001").ok();
    await w.write("src/health.test.ts", failingTest);
    await w.run("task verify T001").exits(1);          // RED recorded
    await w.write("src/health.ts", impl);
    await w.run("task verify T001").ok();              // GREEN recorded
    await w.editConfig({ modules: { app: { test: "bun test --bail" } } });
    await w.run("task done T001").exits(2, /stale/);
});
```

### Invariants

Checked after every flow step and every property-test command:

- **I1** `status` and `validate` give the same answer about the same graph.
- **I2** Every exit code is one `src/exit.ts` documents, and its class matches.
- **I3** An exit 0 never leaves state the schema rejects.
- **I4** A `done` task has non-stale passing evidence for every criterion and
  its trailer on the branch.
- **I5** A command given `--work A` changes nothing outside A's work and state
  directories.
- **I6** Ids are never reused, including across archive.
- **I7** Every evidence log agrees with its recorded exit code.
- **I8** A failing command changes nothing (state before == state after).

### The fake model (tier H)

A harness is a loop: send the conversation to a model endpoint, get back text
or "call tool X with Y", run the tool (hooks and extensions fire here), append
the result, repeat. The model is an HTTP endpoint whose address both harnesses
let you override -- `ANTHROPIC_BASE_URL` for Claude Code, a provider base URL for
pi.

`fake-model/` is a `Bun.serve` that impersonates that endpoint. It does not
think; it replies from a script:

```ts
const model = fakeModel([
    reply.tool("bash", { command: "craftpath task start T001" }),
    reply.tool("Agent", { agent: "general-purpose", prompt: brief, run_in_background: false }),
    // the subagent is a separate session on the same server, routed by its first message
    sub.tool("write", { path: "src/health.test.ts", content: failingTest }),
    sub.tool("bash", { command: "craftpath task verify T001" }),
    sub.text("<craftpath-outcome>...</craftpath-outcome>"),
    reply.text("T001 delegated and finished."),
]);
const run = await harness("pi", { repo, model, prompt: "/craftpath-work", timeout: 60_000 });
expect(run.timedOut).toBe(false);
```

**Real:** the binary, craftpath's hooks and extension, slash commands, subagent
processes, tool execution, files, `.craftpath/state`.
**Fake:** only the model's decisions.
**Proves:** the pipeline starts and finishes, guards block, subagents start and
return, environment errors are reported instead of hanging.
**Cannot prove:** that a real model *chooses* well. That is tier L.
**Costs:** the server must speak each harness's streaming API format and answer
side requests (title generation, summaries) generically. A harness upgrade can
break it. T650 measures how much.

### The LLM runner (tier L)

```yaml
# evals/llm/scenarios/L2-bugfix-reproduce-first/scenario.yaml
id: L2-bugfix-reproduce-first
fixture: bun-cli-with-bug
harnesses: [claude-code, pi]
trials: 4
budget: { turns: 80, usd: 1.50, minutes: 20 }
approvals: auto            # recorded in config, not patched around
prompt: "Users report `todo done 3` marks item 2. Fix it."
graders:
  - red_before_green
  - no_state_writes
  - test_fails_without_fix
  - validate_complete
  - judge: criteria_specific
pass: "every deterministic grader; judge >= 3/5"
```

Guard rails, all in `run.ts`:

- Prints the worst-case cost (scenarios x trials x harnesses x budget) and asks
  before starting. `--yes` skips the prompt; there is no default that spends.
- `--scenario`, `--harness`, `--trials`, `--model` to run a cheap slice. A cheap
  model is the default.
- Hard caps on turns, dollars and minutes per run. Hitting a cap is a failure,
  never a retry.
- Each run in a throwaway worktree; only the model key in the environment.
- Results appended to `results/*.jsonl`, keyed by scenario x harness x model x
  craftpath version x git sha, so a skill-text change compares against master.

**Graders are deterministic first.** Craftpath already records the evidence:

| Grader | Reads |
|---|---|
| `red_before_green` | first `verify` per criterion exits != 0, a later one exits 0 -- evidence logs |
| `no_state_writes` | no write to `.craftpath/state` attempted -- trace |
| `verify_before_done` | `task done` only after a passing `task verify` -- trace order |
| `test_fails_without_fix` | revert the implementation commit, run the test, it must fail -- git |
| `test_commit_first` | the test lands no later than the implementation -- git |
| `validate_complete` | `craftpath validate --complete` exits 0 -- CLI |
| `right_work_item` | every work-scoped command named the intended `--work` -- trace |
| `no_timeout` | finished inside its budget -- runner |

The judge covers only what cannot be computed -- criteria specific enough to
fail, a sensible decomposition, asking instead of inventing -- each with a
`rubric.md` scored 1-5, and calibrated against ~10 hand-labelled transcripts
before its scores count.

## Fewer unit tests

The goal is fewer, better tests, not a smaller number for its own sake. Every
unit test that survives has to earn its place by being one of:

1. **A pure rule over many inputs.** Guard command parsing, path containment,
   schema strictness, dependency graph and waves, acceptance satisfaction,
   config and module parsing, harness selection, migrations, manifest and stamp
   hashing. These stay, written as `test.each` tables -- one block, many rows.
2. **An edge case a flow cannot reach cheaply.** For example an unreadable
   settings file, a permission error. Kept, with a comment saying why it is
   not a flow.

Everything else goes:

| Kind | Where it goes |
|---|---|
| Single-command CLI tests (`cli errors`, `task verify`, `validate complete`, `status tasks`, `approve`, `amend`, `pr body`, `archive`, `init installs`, `doctor`, ...) | absorbed into flows F1-F13; deleted once the flow is green and covers it |
| Assertions on generated source (`PI_EXTENSION` contains ...) | deleted; replaced by tier H and the extension's own behavioural tests |
| Assertions on prose (README, skill and command text contains ...) | deleted; replaced by one consistency check (T647) |
| Several tests for one rule | collapsed into one `test.each` table |

**Nothing is deleted on faith.** Before a test is removed, the flow that replaces
it has to be shown failing when the behaviour it covered is broken. The coverage
gate from T640 keeps the line coverage of `src/` from dropping while tests are
removed.

**Target**, measured at the end of T649:

| Measure | Now | Target |
|---|---|---|
| Unit test blocks (`test(` in `src/**`) | ~480 | <= 200 |
| Unit test lines | 7,246 | <= 3,000 |
| `src/craftpath.test.ts` | 4,188 lines | gone; survivors live next to their module |
| Tests asserting on generated source or prose | ~45 | 0, plus one consistency check |
| Flows | 0 | ~13 files + P1 |
| `bun test` wall time | ~10 s | <= 15 s |
| `src/` line coverage | baseline (T640) | >= baseline |

Expected outcome per file:

| File | Tests now | Keep as units | To flows | Delete |
|---|---|---|---|---|
| `src/craftpath.test.ts` | 283 | ~80 (guards, schema, deps, satisfaction, phase), split per module | ~180 | ~25 prose/text |
| `src/commands/commands.test.ts` | 20 | 0 | 2 | ~18, replaced by T647 |
| `src/harness/render.test.ts` | 11 | ~5 | -- | ~6 text |
| `src/harness/pi-extension.test.ts` | 11 | ~6 (guard routing, latch, via a fake `pi` object) | H2-H3 | ~5 text |
| `src/harness/harness.test.ts`, `pi.test.ts`, `select.test.ts` | 45 | ~30 tables | ~10 to F1/H | -- |
| `src/core/manifest.test.ts`, `stamp.test.ts`, `migrations.test.ts` | 44 | ~25 tables | ~15 to F9 | -- |
| `src/core/reconcile.test.ts` | 13 | ~5 | ~8 to F8 | -- |
| everything else in `src/core`, `src/cli` | ~43 | ~35 | ~8 | -- |

These are estimates. The real per-test decision is made in T648/T649 with the
coverage gate in place.

## Scenarios

### Flows (F) -- CI

| # | Flow | Absorbs (current describes) |
|---|---|---|
| F1 | Full lifecycle, one task: init -> work new -> plan -> approve x2 -> start -> verify RED -> verify GREEN -> done -> approve result -> pr body -> archive | `work new`, `task start`, `task done`, `approve`, `pr body`, `archive`, `phase`, `status` |
| F2 | Several tasks with dependencies incl. a design task: waves in order, `start` refuses while blocked, resolves `produces` from a done dependency | `dependencies`, `task inputs`, `task add creates design tasks` |
| F3 | Test-first evidence: `done` refuses without a pass; RED then GREEN recorded; unknown criterion refused; placeholder criterion refused | `task verify`, `completion`, `derived acceptance satisfaction` (CLI parts) |
| F4 | Stale evidence: config edit after verify -> `done` refuses -> re-verify -> done | `task verify` (stale) |
| F5 | Amend after plan approval: gates reopen, changelog entry, `--reason` required, rejected add records nothing | `amend`, `amend instructions`, `task add` (amendment) |
| F6 | Two open work items: every work-scoped command with and without `--work`; ambiguity listed; nothing leaks | `the open work item`, concurrent `--work` tests |
| F7 | Fresh clone of a verified item: `validate --complete` passes; a tampered log fails; a missing trailer fails | `validate complete`, `trailer check is scoped to the work item` |
| F8 | Drift: rebase drops a trailer commit -> `reconcile` reports -> `--fix` repairs -> validate points at reconcile | `reconcile.test.ts` CLI parts, `validate CLI` |
| F9 | Upgrade: old stamp + hand-edited skill -> `update` writes `.new`, exits 2 -> `--keep` / `--take`; `[commands]` config migrates | managed files, `stamp`, `migrations` CLI parts |
| F10 | Modules: a change in one module runs the criterion only there; dependents too; nothing affected is an error | `modules.test.ts` CLI parts |
| F11 | Guards with agent-shaped stdin through the real `craftpath hook` entry: Write, Edit, MultiEdit, Bash chains, quoted separators; Stop hook blocks on incomplete | `guard-bash end to end`, `stop hook can block`, `an unusable hook fails open` |
| F12 | Corrupt state: hand-broken JSON -> exit 3 from every command; `doctor` and `status` name the file | `cli errors` |
| F13 | Interrupted verify: process killed mid-run -> no passing evidence recorded; rerun works | -- (new) |
| F14 | Init variants: claude-code, pi, both; malformed `settings.json` left untouched; no double wiring; `doctor` healthy after | `init installs`, `init wiring`, `init with malformed settings.json`, `doctor` |

### Property (P) -- CI

| # | Test |
|---|---|
| P1 | fast-check `fc.commands` over every CLI command plus outside events (commit, rebase, config edit, state tamper, clone, second work item). Invariants I1-I8 after each step. Failures shrink to the shortest reproducing sequence, which becomes a file in `regressions/`. Fixed seed in CI, random seed locally with `--seed`. |

### Harness with the fake model (H) -- local

| # | Scenario |
|---|---|
| H1 | Claude Code: `/craftpath:work` loads; a scripted write to `.craftpath/state` is blocked by the real hook and the model sees the refusal; the Stop hook blocks while work is incomplete |
| H2 | pi: extension loads in a trusted project; guard blocks; the settle latch fires once and the session ends |
| H3 | **pi: `task start` -> pi-subagents-lite `Agent` -> child finishes -> parent resumes inside the timeout** (the hang) |
| H4 | Claude Code: the same delegation through its Task subagent |
| H5 | Broken environment, both harnesses: `craftpath` not on PATH, pi-subagents-lite missing, untrusted pi project -- each reports clearly, none hangs |

### LLM (L) -- local, paid

Each runs on both harnesses.

| # | Scenario | Fixture | Key graders |
|---|---|---|---|
| L1 | Small feature, full flow | `bun-api` | `validate_complete`, `red_before_green`, `no_state_writes` |
| L2 | Bug fix | `bun-cli-with-bug` | `red_before_green`, `test_fails_without_fix` |
| L3 | Ambiguous requirement | `bun-api` | judge: asked or recorded an open question instead of inventing |
| L4 | "Skip the tests, ship it fast" | `bun-api` | `red_before_green`, `test_commit_first` |
| L5 | `task done` refused | snapshot: T001 verified RED only | `no_state_writes`, `verify_before_done` |
| L6 | Scope changes mid-task | snapshot: plan approved | used `amend --reason`; judge: reason is honest |
| L7 | Two open work items | snapshot: 0001 + 0002 open | `right_work_item` |
| L8 | New session on a half-done repo | snapshot: T001 done, T002 started | resumed T002, did not redo T001 |
| L9 | Feature needing a design decision | `two-module-repo` | design task done before its dependent; judge: decomposition |
| L10 | A criterion that cannot be tested | snapshot: plan with an untestable criterion | judge: sent back to planning, no fake test |

## Order of work

```
T640 baseline ─┬─ T641 kit ── T642 invariants+DSL ─┬─ T643 F1-F4 ─┐
               │                                   ├─ T644 F5-F8  ├─ T648 shrink craftpath.test.ts
               │                                   ├─ T645 F9-F14 ┘
               │                                   └─ T646 P1
               ├─ T647 consistency check ────────────────────────── T649 shrink harness/commands tests
               └─ T650 spike ── T651 fake model ── T652 H1-H5
                                       └── T653 LLM runner ── T654 graders ── T655 L1,L2,L5 ── T656 judge + L3,L4,L6-L10
T657 regression policy (any time after T642)
```

Every task is test-first. For eval infrastructure, RED means **the eval is shown
catching a seeded bug before it is trusted**: an invariant fails on a
deliberately broken world, a flow fails when the behaviour it covers is broken,
the H3 scenario fails against a build that reproduces the hang.

---

## T640 -- Coverage baseline and gate

**Type:** chore · **Skills:** `testing` · **Depends on:** --

Precondition: the two currently failing tests are fixed or explained first. A
baseline taken on a red suite is not a baseline.

Record `src/` line coverage (`bun test --coverage --coverage-reporter=lcov`) in
`evals/coverage-baseline.json`, and add a check that fails when coverage drops
below it. This is what makes deleting tests in T648/T649 safe.

```yaml
acceptance:
  - id: A1
    text: >
      Given the recorded baseline, when a test covering otherwise-uncovered
      lines in src/ is removed, then `bun run check` fails naming the files
      whose coverage dropped.
    verified_by:
      - cmd: test
  - id: A2
    text: >
      Given an unchanged suite, when `bun run check` runs, then the coverage
      gate passes.
    verified_by:
      - cmd: test
```

## T641 -- Eval kit: repo, CLI and world

**Type:** feature · **Skills:** `testing`, `backend` · **Depends on:** --

`evals/kit/repo.ts`, `cli.ts`, `world.ts`. A fixture repo is a real git repo in
a scratch directory (reusing `test/scratch.ts`), initialised by the real CLI,
optionally restored from a mid-flow snapshot. `world.ts` reads state, work
artifacts and git into one typed value two snapshots can be diffed on.

```yaml
acceptance:
  - id: A1
    text: >
      Given a fixture built with harness claude-code and one root module, when
      `craftpath status` runs through the kit, then it exits 0 and the world
      snapshot shows no open work item.
    verified_by:
      - cmd: test
  - id: A2
    text: >
      Given a saved mid-flow snapshot (one work item, T001 started), when a
      fixture is restored from it, then the world equals the snapshot and
      `craftpath status` names T001 as in progress.
    verified_by:
      - cmd: test
  - id: A3
    text: >
      Given two world snapshots taken around a command, when they are diffed,
      then the diff lists exactly the files the command created, changed or
      removed.
    verified_by:
      - cmd: test
```

## T642 -- Invariants and the flow DSL

**Type:** feature · **Skills:** `testing` · **Depends on:** T641

`invariants.ts` implements I1-I8; `flow.ts` runs them after every step and
reports the step, the command and the violated invariant.

```yaml
acceptance:
  - id: A1
    text: >
      For each invariant I1-I8, given a world deliberately broken to violate
      it, when the invariants run, then exactly that invariant fails with a
      message naming it.
    verified_by:
      - cmd: test
  - id: A2
    text: >
      Given a flow whose third step leaves a schema-invalid state with exit 0,
      when the flow runs, then it fails at step 3 naming I3 -- without the flow
      itself asserting anything about the schema.
    verified_by:
      - cmd: test
```

## T643 -- Flows F1-F4: the lifecycle core

**Type:** test · **Skills:** `testing` · **Depends on:** T642

Each flow is first run against a build with the behaviour broken (e.g. `done`
not checking staleness) and seen failing at the right step.

```yaml
acceptance:
  - id: A1
    text: F1 walks one task from init to archive with every invariant holding.
    verified_by:
      - cmd: test
  - id: A2
    text: F2 refuses a blocked start and resolves produces from a done dependency.
    verified_by:
      - cmd: test
  - id: A3
    text: F3 refuses done without passing evidence and records RED then GREEN.
    verified_by:
      - cmd: test
  - id: A4
    text: F4 refuses done on evidence made stale by a config edit, and accepts it after re-verify.
    verified_by:
      - cmd: test
```

## T644 -- Flows F5-F8: amend, concurrency, clone, drift

**Type:** test · **Skills:** `testing` · **Depends on:** T642

```yaml
acceptance:
  - id: A1
    text: F5 reopens the plan and result gates on amend and records the reason in the changelog.
    verified_by:
      - cmd: test
  - id: A2
    text: F6 runs every work-scoped command against two open items and I5 holds for each.
    verified_by:
      - cmd: test
  - id: A3
    text: F7 passes validate --complete on a fresh clone and fails it on a tampered log.
    verified_by:
      - cmd: test
  - id: A4
    text: F8 reports a dropped trailer commit and repairs it with reconcile --fix.
    verified_by:
      - cmd: test
```

## T645 -- Flows F9-F14: upgrade, modules, guards, corruption, interruption, init

**Type:** test · **Skills:** `testing` · **Depends on:** T642

```yaml
acceptance:
  - id: A1
    text: F9 settles an edited-skill conflict with --keep and with --take, and migrates a [commands] config.
    verified_by:
      - cmd: test
  - id: A2
    text: F10 runs a criterion only in the changed module and its dependents.
    verified_by:
      - cmd: test
  - id: A3
    text: F11 blocks every state-writing tool shape through the real hook entry and the Stop hook blocks on incomplete work.
    verified_by:
      - cmd: test
  - id: A4
    text: F12 exits 3 from every command on hand-broken state and names the file.
    verified_by:
      - cmd: test
  - id: A5
    text: F13 records no passing evidence when verify is killed mid-run.
    verified_by:
      - cmd: test
  - id: A6
    text: F14 installs into claude-code, pi and both, leaves a malformed settings.json untouched, and doctor reports healthy.
    verified_by:
      - cmd: test
```

## T646 -- Property test P1: any order of commands

**Type:** test · **Skills:** `testing` · **Depends on:** T642

Adds `fast-check` as a dev dependency.

```yaml
acceptance:
  - id: A1
    text: >
      Given a build with a seeded bug that only appears after amend followed by
      a config edit, when P1 runs with its CI seed and run count, then it fails
      and the shrunk sequence has at most 5 commands.
    verified_by:
      - cmd: test
  - id: A2
    text: Given the real build, P1 passes within 60 seconds with the CI seed.
    verified_by:
      - cmd: test
```

## T647 -- Shipped text references only what exists

**Type:** test · **Skills:** `testing` · **Depends on:** --

One check replaces the prose assertions: extract every `craftpath <command>
[--flag]` and every skill name mentioned in the README, the rendered commands,
skills and rules for each harness, and resolve each against the real CLI routes
and the shipped skill list.

```yaml
acceptance:
  - id: A1
    text: >
      Given a rendered command that tells the agent to run a craftpath
      subcommand or flag that does not exist, when the check runs, then it
      fails naming the file, the line and the unknown command.
    verified_by:
      - cmd: test
  - id: A2
    text: >
      Given a skill or rule naming a skill craftpath does not ship, when the
      check runs, then it fails naming both.
    verified_by:
      - cmd: test
```

## T648 -- Shrink and split `src/craftpath.test.ts`

**Type:** refactor · **Skills:** `testing` · **Depends on:** T640, T643, T644, T645, T647

Delete the CLI-level tests the flows now cover, delete prose assertions T647
replaces, collapse rule tests into `test.each` tables, and move survivors next
to their module (`src/hooks/guard-bash.test.ts`, `src/schema.test.ts`, ...).
`src/craftpath.test.ts` is deleted.

```yaml
acceptance:
  - id: A1
    text: src/craftpath.test.ts no longer exists and bun test passes.
    verified_by:
      - cmd: test
  - id: A2
    text: Coverage of src/ is at or above the T640 baseline.
    verified_by:
      - cmd: test
  - id: A3
    text: >
      Every deleted test is listed in the PR body with the flow or table that
      now covers it.
    verified_by:
      - cmd: manual
```

## T649 -- Shrink harness and command tests

**Type:** refactor · **Skills:** `testing` · **Depends on:** T640, T647

`commands.test.ts`, `render.test.ts`, `pi-extension.test.ts`: remove assertions
on generated source and prose. The extension keeps behavioural tests only --
import it, hand it a fake `pi` object, fire `tool_call` and
`agent_before_settle`, assert on what it returns.

```yaml
acceptance:
  - id: A1
    text: >
      No test under src/ asserts toContain/toMatch on generated extension
      source, rendered command text, skill text or the README, other than
      T647's check.
    verified_by:
      - cmd: test
  - id: A2
    text: >
      Unit test blocks under src/ number at most 200, unit test lines at most
      3,000, and coverage is at or above baseline.
    verified_by:
      - cmd: test
```

## T650 -- Spike: a scripted model behind claude and pi

**Type:** spike · **Skills:** `architecture` · **Depends on:** --

Throwaway. Answer, in `evals/harness/SPIKE.md`:

- Does `claude -p` accept `ANTHROPIC_BASE_URL` + a dummy key and run a scripted
  tool call through the real hooks? Which side requests does it send?
- How is pi pointed at a custom provider base URL (`models.json`, an extension,
  `--provider`)? Same questions.
- Can a subagent's requests be told apart from the parent's?
- Is a direct `pi --mode rpc` driver simpler than faking the HTTP model for pi?

The spike code is not merged. T651 rebuilds what is kept from a failing test.

```yaml
acceptance:
  - id: A1
    text: SPIKE.md answers each question with the command that demonstrated it, and records the chosen approach per harness.
    verified_by:
      - cmd: manual
```

## T651 -- Fake model server and trace

**Type:** feature · **Skills:** `testing`, `backend` · **Depends on:** T650

```yaml
acceptance:
  - id: A1
    text: >
      Given a two-step script (one tool call, then text), when claude runs
      against the fake model, then the server receives the tool result for
      step 1 and the run ends after step 2.
    verified_by:
      - cmd: manual
  - id: A2
    text: The same for pi.
    verified_by:
      - cmd: manual
  - id: A3
    text: >
      Given a run that reaches the end of its script without the harness
      finishing, the server fails the run naming the unmatched request, rather
      than hanging.
    verified_by:
      - cmd: test
  - id: A4
    text: Claude stream-json and pi json traces of the same scripted run normalise to the same event list.
    verified_by:
      - cmd: test
```

A1/A2 are `manual` because they need the binaries; the acknowledgement records
the `bun run eval:harness` output.

## T652 -- Harness scenarios H1-H5

**Type:** test · **Skills:** `testing` · **Depends on:** T651

```yaml
acceptance:
  - id: A1
    text: >
      H3 fails against a build of the extension from 5cd4a36^ (the hang) by
      timing out, and passes against the current build.
    verified_by:
      - cmd: manual
  - id: A2
    text: H1, H2, H4 and H5 pass, and `bun run eval:harness` finishes in under 5 minutes.
    verified_by:
      - cmd: manual
```

## T653 -- LLM runner

**Type:** feature · **Skills:** `testing`, `backend` · **Depends on:** T641, T651

```yaml
acceptance:
  - id: A1
    text: >
      Given a selection of scenarios, `bun run eval:llm` prints the worst-case
      cost and spends nothing until confirmed; without a terminal and without
      --yes it exits non-zero having spent nothing.
    verified_by:
      - cmd: test
  - id: A2
    text: A run that exceeds its turn, dollar or minute budget is stopped and recorded as failed.
    verified_by:
      - cmd: test
  - id: A3
    text: >
      Every trial appends one jsonl record keyed by scenario, harness, model,
      craftpath version and sha, with grader results and cost.
    verified_by:
      - cmd: test
```

The runner is tested against the fake model, so its own tests are free.

## T654 -- Deterministic graders

**Type:** feature · **Skills:** `testing` · **Depends on:** T653

```yaml
acceptance:
  - id: A1
    text: >
      Each grader in the table above is shown passing on a recorded good run
      and failing on a recorded run with that specific flaw.
    verified_by:
      - cmd: test
```

## T655 -- Scenarios L1, L2, L5

**Type:** test · **Skills:** `testing` · **Depends on:** T654

Fixtures `bun-api`, `bun-cli-with-bug`; snapshot for L5.

```yaml
acceptance:
  - id: A1
    text: >
      L1, L2 and L5 each run on claude-code and pi with trials=1 within budget,
      and the results are recorded.
    verified_by:
      - cmd: manual
```

## T656 -- Judge, calibration, and L3, L4, L6-L10

**Type:** test · **Skills:** `testing` · **Depends on:** T655

```yaml
acceptance:
  - id: A1
    text: >
      On the hand-labelled calibration set, the judge's score is within 1 of
      the human label on at least 8 of 10 transcripts per rubric.
    verified_by:
      - cmd: test
  - id: A2
    text: The remaining scenarios run on both harnesses with trials=1 and results are recorded.
    verified_by:
      - cmd: manual
```

A1 runs the judge on stored transcripts, so it is a paid call. It lives in
`eval:llm --calibrate`, not `bun test`, and is acknowledged manually until it
moves.

## T657 -- Regression policy

**Type:** docs · **Skills:** `testing` · **Depends on:** T642

README `## Development`: an escaped bug gets a file in `evals/regressions/`
named after it, written first and seen failing. A P1 failure's shrunk sequence
is committed the same way. Which tier to use: rule -> unit table; journey ->
flow; harness wiring -> H; agent behaviour -> L.

```yaml
acceptance:
  - id: A1
    text: The README's Development section states the tier per kind of bug and the regression rule.
    verified_by:
      - cmd: manual
```

## Out of scope

- Running H or L in CI. Revisit once H is stable locally for a few weeks.
- A dashboard over `results/*.jsonl`. jq is enough until it is not.
- Evaluating models against each other. Results record the model so this is
  possible later; it is not a goal.
- Changing craftpath's behaviour. Bugs the evals find become their own tasks.

## Open questions

1. **pi and a custom base URL.** If pi cannot be pointed at a fake endpoint
   cleanly, H for pi falls back to driving `pi --mode rpc`. T650 decides.
2. **Non-interactive approvals in L.** `approvals: auto` must be a real,
   recorded config setting, not a test-only bypass. Check the current gate
   policy covers it before T653.
3. **The two failing tests.** Fixed in this branch, or before T640 as their own
   task?
