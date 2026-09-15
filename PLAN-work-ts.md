# Plan — implement `src/core/work.ts`

**Status: APPROVED shape, questions resolved. Ready to execute.**
Written with the `planning` skill; checked against its ten-point gate at the end.

## Requirement

`src/core/work.ts` is a 0-byte file. `bin/craftpath.ts` imports `workNew` from
it at line 65 and `status` at line 73, so `bun run typecheck` fails with two
errors and `craftpath work new` / `craftpath status` exit non-zero at the import.
`bun test` is green at 45/45, so the gap is entirely in this one module.

Two exports, with signatures already fixed by the call sites:

```ts
workNew(root: string, title: string, mode: "light" | "standard"): Promise<void>
status(root: string, brief: boolean): Promise<void>
```

### What constrains the implementation

- **Trust boundary (§1).** Code owns id allocation and status; the model owns
  content. `workNew` writes `.craftpath/state/` — the guard at
  `src/hooks/guard-write.ts` denies the *agent* that path, not the CLI.
- **`init` already made the directories** (`src/core/init.ts`): `.craftpath/work`,
  `state`, `templates`, `archive`, `specs`, `decisions`. `workNew` scaffolds into
  them, and init's own comment says per-work-item files "are scaffolded from
  `.craftpath/templates/` by `craftpath work new`".
- **Modes differ only in which artifacts exist (§9.1)**, not in phases.
- **`craftpath task add` is M1.** At M0 there are no task files unless someone
  wrote one by hand, so `status` must read zero tasks as a normal state rather
  than an error.

### Probed before planning

Two unknowns that would have changed the shape, checked against this repo's
runtime (Bun 1.3.10):

```
Bun.YAML: object
parsed: {"id":"D001","title":"Design the admin table","depends_on":[],
         "skills":["ux"],"produces":["a/b.md"],"acceptance":[...]}
Bun.CryptoHasher sha256: 2d711642b726b044...
```

So task frontmatter parses into exactly the shape `TaskProse` validates, and
config hashing is available. **No new dependency for either.**

### Scenarios

| # | Scenario | Covered by |
|---|---|---|
| S1 | A new work item gets the next free id, above anything in work *or* archive | T102-A1 |
| S2 | A title becomes a readable slug; one that slugs to nothing is refused | T102-A2, A3 |
| S3 | Light mode scaffolds fewer artifacts than standard, and neither scaffolds design.md | T102-A4 |
| S4 | A second `work new` while one is open is refused, not silently duplicated | T102-A5 |
| S5 | A crash mid-scaffold leaves no work item that `status` will report | T102-A6 |
| S6 | `status` in a repo with no work item exits 0 and says so | T103-A1 |
| S7 | `status` reports id, mode, phase and gate state | T103-A2 |
| S8 | `status --brief` is one line | T103-A3 |
| S9 | `status` reports tasks, what is blocked, and the next unblocked one | T104-A1, A2 |
| S10 | A malformed task file is named, not swallowed | T104-A4 |
| S11 | A new work item lands on its own branch, named from the configured prefix | T105-A1, A2 |
| S12 | A work item is created even when the branch cannot be | T105 out-of-scope, by decision |

---

## T101 — Add the work item schema

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`work.json` is described in §4 as holding "gates, mode, phase status" and has no
schema. Everything else in the trusted kernel is defined in `src/schema.ts`;
this is the hole.

`.strict()` for the same reason as the rest of the file: a model inventing a
field must fail loudly. Note that `work.json` is kernel state, so nothing but
the CLI writes it — but it is still parsed on every `status`, and a hand-edited
file is exactly what strictness is for.

### Code

`src/schema.ts`, alongside the existing kernel types:

```ts
export const WorkId = z
    .string()
    .regex(/^\d{4}-[a-z0-9]+(-[a-z0-9]+)*$/, "must look like 0042-avatar-upload");

export const Mode = z.enum(["light", "standard"]);

/** Logical phases (§9.2). Artifacts are a persistence policy, not a phase. */
export const Phase = z.enum([
    "requirement", "understand", "clarify", "design",
    "plan", "execute", "integrate", "result",
]);

/**
 * Gate state. `auto` is a config policy, not a stored value -- a gate that was
 * auto-approved still records `approved`, so evidence of approval never depends
 * on re-reading the policy that granted it.
 */
export const GateState = z.enum(["pending", "approved"]);

export const WorkState = z
    .object({
        id: WorkId,
        title: z.string().min(1),
        mode: Mode,
        phase: Phase,
        gates: z
            .object({
                requirement: GateState,
                plan: GateState,
                result: GateState,
            })
            .strict(),
        created_at: z.iso.datetime(),
    })
    .strict();

export type WorkState = z.infer<typeof WorkState>;
export type Mode = z.infer<typeof Mode>;
export type Phase = z.infer<typeof Phase>;
```

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a work state object with id '0042-avatar-upload', mode 'light',
      phase 'requirement' and all three gates pending, when WorkState parses
      it, then it succeeds and mode is 'light'.
    verified_by:
      - cmd: test
        selector: "work schema > accepts a well-formed work state"
  - id: A2
    text: >
      Given a work state carrying an extra key, when WorkState parses it, then
      it throws and no object is returned.
    verified_by:
      - cmd: test
        selector: "work schema > rejects an unknown key"
  - id: A3
    text: >
      Given ids 'avatar-upload', '42-avatar' and '0042-Avatar', when WorkId
      parses each, then all three throw.
    verified_by:
      - cmd: test
        selector: "work schema > rejects a malformed work id"
  - id: A4
    text: >
      Given a work state missing the plan gate, when WorkState parses it, then
      it throws; all three gates are required.
    verified_by:
      - cmd: test
        selector: "work schema > requires every gate to be present"
```

### Out of scope

- Task-related schema. `TaskProse` and `TaskState` already exist and are correct.
- Persisting which gate policy (`auto`, `manual`) applied. Gate evaluation is M1.

---

## T102 — Scaffold a new work item

**Type:** feature · **Skills:** `backend` · **Depends on:** T101

`workNew` allocates an id, refuses to create a second open work item, scaffolds
the artifacts its mode calls for, and writes kernel state last.

### Two decisions worth reviewing

**Id allocation scans `archive/` as well as `work/`.** Archiving moves a work
item out of `work/`, so an allocator that only looked at `work/` would reissue
`0042` after the first archive, and every git trailer, branch name and log path
carrying that id would then be ambiguous. Ids are permanent even when the work
is gone.

**Kernel state is written last.** If the process dies mid-scaffold, the failure
mode is a stray directory under `.craftpath/work/` with no `state/` entry — and
`status` keys off state, so it reports nothing rather than half a work item.
The inverse order would produce a work item that `status` reports and whose
artifacts do not exist. Neither is atomic; one fails quietly and one fails
confusingly.

### Code

```ts
/** Artifacts per mode (§9.1). design.md is deliberately in neither. */
const ARTIFACTS: Record<Mode, string[]> = {
    light: ["requirement.md", "spec-delta.md", "changelog.md"],
    standard: [
        "requirement.md", "context.md", "plan.md",
        "result.md", "spec-delta.md", "changelog.md",
    ],
};
```

`design.md` is absent from both on purpose: §9.1 says "when needed", and a
scaffolded empty file is an invitation to fill it in. It is copied from
`.craftpath/templates/` on demand, by whoever decides design work is warranted.

```ts
/** Next free 4-digit id. Pure, so the allocation rule is testable alone. */
export function nextId(existing: string[]): string {
    const highest = existing
        .map((name) => Number.parseInt(name.slice(0, 4), 10))
        .filter((n) => Number.isInteger(n))
        .reduce((a, b) => Math.max(a, b), 0);
    return String(highest + 1).padStart(4, "0");
}

/** Title -> url-safe slug. Pure. */
export function slugify(title: string): string {
    return title
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/[\s-]+/g, "-")
        .slice(0, 48)
        .replace(/^-|-$/g, "");
}

export async function workNew(root: string, title: string, mode: Mode): Promise<void> {
    // 1. refuse a second open work item  -> PreconditionError
    // 2. id = nextId(readdir(work) ++ readdir(archive)) + "-" + slugify(title)
    // 3. mkdir work/<id>/tasks
    // 4. copy ARTIFACTS[mode] from .craftpath/templates/
    // 5. mkdir state/<id>/logs
    // 6. write state/<id>/work.json   <- LAST
}
```

Reuses `PreconditionError` from `src/transitions.ts` so the exit code mapping
(`Exit.PRECONDITION_FAILED`) stays in one place.

### Both pure functions probed against the criteria

The criteria below assert exact strings, so the implementations above were run
before the plan claimed them:

```
"Add an Admin Page!"       -> "add-an-admin-page"
"  Spaces  everywhere  "   -> "spaces-everywhere"
"***"                      -> ""                  (T102-A3 refuses this)
"Café déjà vu"             -> "cafe-deja-vu"       (NFKD strips the accents)
"--leading and trailing--" -> "leading-and-trailing"

nextId(["0001-a", "0007-b"]) -> "0008"
nextId([])                   -> "0001"
nextId([".gitkeep"])         -> "0001"
```

**That last line is the one that matters.** `init` writes a `.gitkeep` into
`.craftpath/work/` and `.craftpath/archive/` so the layout survives a clone, so
the allocator reads it on every single call. `Number.parseInt(".git")` is `NaN`
and the `Number.isInteger` filter drops it — but only because the filter is
there. Remove it as "defensive clutter" and the first `work new` in a fresh repo
allocates `NaN`. T102-A1 exercises this by including `.gitkeep` in its input.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given directory entries ['0001-a', '.gitkeep'] from work and ['0007-b']
      from archive, when nextId is called with both, then it returns '0008'
      and the .gitkeep entry contributes nothing.
    verified_by:
      - cmd: test
        selector: "work new > allocates above the highest id in work and archive"
  - id: A2
    text: >
      Given the title 'Add an Admin Page!', when slugify is called, then it
      returns 'add-an-admin-page'.
    verified_by:
      - cmd: test
        selector: "work new > turns a title into a readable slug"
  - id: A3
    text: >
      Given a title of '***', when workNew is called, then it throws a usage
      error and creates no directory under work.
    verified_by:
      - cmd: test
        selector: "work new > refuses a title that slugs to nothing"
  - id: A4
    text: >
      Given an initialised repo, when workNew runs in light mode, then
      requirement.md, spec-delta.md and changelog.md exist and context.md,
      plan.md, result.md and design.md do not.
    verified_by:
      - cmd: test
        selector: "work new > light mode scaffolds only its own artifacts"
  - id: A5
    text: >
      Given one work item already present under work, when workNew is called
      again, then it throws a precondition error naming the open item and
      creates no second directory.
    verified_by:
      - cmd: test
        selector: "work new > refuses a second open work item"
  - id: A6
    text: >
      Given workNew has completed, when state/<id>/work.json is parsed by
      WorkState, then it validates and its phase is 'requirement' with all
      three gates pending.
    verified_by:
      - cmd: test
        selector: "work new > writes valid kernel state with gates pending"
  - id: A7
    text: >
      Given standard mode, when workNew runs, then context.md, plan.md and
      result.md exist alongside the light-mode artifacts, and design.md still
      does not.
    verified_by:
      - cmd: test
        selector: "work new > standard mode adds context plan and result"
```

### Out of scope

- Creating the git branch named by `config.toml`'s `work_branch_prefix`. That is
  a separate concern with its own failure modes, and `work new` should not be
  the thing that fails because the tree is dirty.
- Rendering templates. Files are copied byte for byte; the guidance comments are
  stripped by whoever fills them in.
- Any phase transition. `workNew` creates a work item at `requirement`; advancing
  it is M1.

---

## T103 — Report where the work item stands

**Type:** feature · **Skills:** `backend` · **Depends on:** T101

`status` finds the open work item, parses its kernel state, and prints it.
`--brief` prints one line, because the Stop hook and the `/craftpath:status`
slash command both want a glance rather than a page.

**No work item is a normal state, not an error.** `craftpath status` is the
first thing `/craftpath:work` runs, in a repo that may have nothing yet, so it
exits 0 and says what to run.

### Code

```ts
export async function status(root: string, brief: boolean): Promise<void> {
    const state = await readOpenWork(root);           // WorkState | null
    if (!state) {
        console.log(brief ? "no open work item" : NOTHING_OPEN);
        return;                                        // exit 0, deliberately
    }
    // brief:  "0042-avatar-upload  light  phase=plan  gates: R=ok P=pending R=pending"
    // full:   the above, plus the task table from T104
}
```

A corrupt or unparseable `work.json` is *not* the same as no work item: it
throws `CorruptStateError` (exit 3) rather than printing "nothing open", because
silently reporting an empty repo when state exists is how a resume loses work.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given an initialised repo with no work item, when status runs, then it
      exits 0 and its output names the command to create one.
    verified_by:
      - cmd: test
        selector: "status > an empty repo exits zero and says what to run"
  - id: A2
    text: >
      Given a work item 0042-avatar-upload in light mode at phase 'plan', when
      status runs, then the output contains the id, the mode, the phase and a
      state for each of the three gates.
    verified_by:
      - cmd: test
        selector: "status > reports id mode phase and every gate"
  - id: A3
    text: >
      Given the same work item, when status runs with brief true, then the
      output is exactly one line.
    verified_by:
      - cmd: test
        selector: "status > brief output is a single line"
  - id: A4
    text: >
      Given a work.json containing invalid JSON, when status runs, then it
      exits 3 and does not report the repo as having no work item.
    verified_by:
      - cmd: test
        selector: "status > corrupt kernel state is not reported as empty"
```

### Out of scope

- Task rendering. That is T104, so this task ships a useful `status` without
  depending on it.
- Gate policy evaluation. `status` reports the stored gate state; deciding
  whether a gate *should* be auto-approved is M1.

---

## T104 — Show task state in status

**Type:** feature · **Skills:** `backend` · **Depends on:** T103

Reads `work/<id>/tasks/*.md`, parses the frontmatter with `Bun.YAML`, validates
with `TaskProse`, and renders what `transitions.ts` already derives: waves,
what is blocked and by what, and the next unblocked task.

This is where the existing derived functions finally get a caller. Nothing new
is computed here — `waves`, `isBlocked` and `unsatisfied` already exist and are
tested; this task only feeds and prints them.

**Zero tasks is normal at M0.** `craftpath task add` lands in M1, so the common
case is an empty `tasks/` directory, and the output should say so rather than
printing an empty table.

### Code

```ts
/** Frontmatter between the first two `---` fences. */
function frontmatter(source: string): unknown {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (!m) throw new CorruptStateError("task file has no frontmatter block");
    return Bun.YAML.parse(m[1]!);
}

/** sha256 of config.toml; evidence recorded under a different hash is stale. */
export async function configHash(root: string): Promise<string> {
    const text = await Bun.file(join(root, ".craftpath/config.toml")).text();
    return "sha256:" + new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
```

Task *state* (`state/<id>/T001.json`) may not exist for a task file that was
written but never started; that reads as `status: "pending"` with no evidence,
rather than as corruption.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given task files T001 with no dependencies and T002 depending on T001,
      when status runs, then T002 is shown as blocked by T001 and T001 is named
      as the next unblocked task.
    verified_by:
      - cmd: test
        selector: "status tasks > shows what is blocked and by what"
  - id: A2
    text: >
      Given T001 marked done in kernel state and T002 depending on it, when
      status runs, then T002 is no longer shown as blocked.
    verified_by:
      - cmd: test
        selector: "status tasks > a done dependency unblocks its dependent"
  - id: A3
    text: >
      Given a work item whose tasks directory is empty, when status runs, then
      it says there are no tasks yet and does not print an empty table.
    verified_by:
      - cmd: test
        selector: "status tasks > an empty tasks directory says so"
  - id: A4
    text: >
      Given a task file whose frontmatter fails TaskProse validation, when
      status runs, then it exits 3 with the offending filename in the message,
      and no other task is reported as missing.
    verified_by:
      - cmd: test
        selector: "status tasks > names the task file that failed to parse"
  - id: A5
    text: >
      Given a task file with no corresponding state file, when status runs,
      then that task is reported as pending rather than as corrupt state.
    verified_by:
      - cmd: test
        selector: "status tasks > a task with no state file reads as pending"
```

### Out of scope

- Staleness rendering. `configHash` lands here because task state needs it, but
  marking evidence stale in the output waits until there is evidence to mark —
  `task verify` is M1.
- Reconciling task files against git trailers. That is `reconcile`, M1.

---

## T105 — Create the work branch on new work

**Type:** feature · **Skills:** `backend` · **Depends on:** T102

`config.toml` defines `work_branch_prefix = "work/"` and nothing consumes it, so
the setting currently lies. `workNew` creates `<prefix><id>` — for work item
`0042-avatar-upload`, the branch `work/0042-avatar-upload`.

**Best effort, by decision.** No precondition checks, no failure handling: it
attempts the branch and continues either way. A dirty tree, an existing branch,
a repo that is not git — none of them stop or slow `work new`.

The consequence, recorded so it is not rediscovered: when the branch is not
created, nothing says so, and the work happens on whatever branch you were
already on. `reconcile` in M1 is where that surfaces, since trailers are the
durable anchor rather than the branch name. Revisit if that turns out to be
annoying in practice.

The attempt is the **last** step of `workNew`, after kernel state is written, so
a failed branch leaves a complete and valid work item behind rather than a
partial one.

### Code

```ts
/** Branch name from config; the prefix is the only configurable part. */
export function branchName(prefix: string, workId: string): string {
    return prefix.endsWith("/") ? prefix + workId : `${prefix}/${workId}`;
}

// last step of workNew -- deliberately unchecked
await Bun.$`git checkout -b ${branchName(prefix, id)}`.quiet().nothrow();
```

`.nothrow()` is the decision in one call: a non-zero exit is a value nobody
reads, not an exception.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given prefix 'work/' and id '0042-avatar-upload', when branchName is
      called, then it returns 'work/0042-avatar-upload'; and given prefix
      'work' without a trailing slash it returns the same string.
    verified_by:
      - cmd: test
        selector: "work branch > builds the branch name from the configured prefix"
  - id: A2
    text: >
      Given a git repo on its default branch, when workNew runs, then the
      current branch afterwards is work/<id>.
    verified_by:
      - cmd: test
        selector: "work branch > switches to the new work branch"
```

### Out of scope

- **Every failure path.** Existing branch, dirty tree, detached HEAD, no git
  repo, no `git` on PATH. All unchecked and unreported, by decision.
- Committing the scaffolded artifacts, pushing, or touching a remote.
- Cleaning up the branch if anything later fails.

---

## Dependency graph

```
T101 ──┬──▶ T102 ──▶ T105
       └──▶ T103 ──▶ T104
```

Waves: `[T101]` → `[T102, T103]` → `[T104, T105]`.

Every edge is real. T102 and T103 both write or parse `WorkState`, which does
not exist until T101. T104 extends the output `status` produces, so it cannot be
written against a `status` that is not there. T105 inserts a precondition step
at the front of `workNew`, which T102 creates.

**Typecheck goes green at T102 + T103**, since those two exports are the whole
of what `bin/craftpath.ts` is missing. T104 is improvement, not repair — worth
knowing if you want to stop after wave 2.

---

## Not in this plan

- **Anything in M1.** `task add`, `approve`, `amend`, `archive`, `reconcile`,
  `pr body`, and real `validate` are all out. This plan fills a hole in M0, and
  it should not grow into the next milestone because the file happened to be open.
- **Committing, pushing, or cleaning up branches.** T105 attempts one branch and
  stops there.
- **Any git failure handling.** Deliberate, not an oversight — see T105.
- **Concurrent work items.** One at a time, per Q2.
- **Multiple concurrent work items.** `workNew` refuses a second one, matching
  what `/craftpath:work` already tells the agent ("never create a duplicate").
  If concurrent work items are wanted, that is a design decision, not a flag.
- **A `Work` id in git trailers.** Task trailers exist; work-level linkage is
  reconcile's problem.

## Open questions

- ~~**Q1 — should `work new` create the git branch?**~~ **Resolved: yes.** Added
  as T105. The dirty-tree concern is handled by not treating a dirty tree as a
  failure — `git checkout -b` carries the changes over.
- ~~**Q2 — is refusing a second open work item right?**~~ **Resolved: yes, keep
  the refusal.** One work item at a time is the working assumption. It matches
  what `/craftpath:work` already instructs and keeps "the current work item" a
  coherent phrase. Revisit if interruption turns out to be common — relaxing this
  later is easy, while retrofitting single-item assumptions is not.
- ~~**Q3 — the reference and the code disagree on layout.**~~ **Withdrawn: they
  agree.** §4 of `craftpath-reference.md` nests `work/`, `state/`, `specs/`,
  `decisions/`, `archive/` and `templates/` under a `.craftpath/` parent, exactly
  as `init.ts` creates them. There is no docs task here and nothing to reconcile.

---

## Gate checklist (run against this plan)

| # | Check | Status |
|---|---|---|
| 1 | Every scenario maps to a criterion | Pass — S1–S11 by criterion; S12 is an explicit non-behaviour |
| 2 | Every criterion names a selector | Pass — 22 criteria, 0 manual; this is all machine-checkable |
| 3 | Every criterion could fail today | Pass — `work.ts` is empty, so all 22 fail now |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — T102-A3/A5 ("creates no directory"), T103-A4 ("does not report as empty"), T104-A4 ("no other task reported as missing") |
| 6 | Every task verifiable without an unfinished sibling | Pass — T103 ships a working `status` without T104 |
| 7 | Every depends_on edge would really fail | Pass — justified under the graph |
| 8 | Skills match the work | Pass — `backend` throughout; `testing` appears nowhere, since these tasks write their own unit tests |
| 9 | No task title contains "and" | Pass — T105 exists because folding it into T102 would have produced one |
| 10 | Out of scope names the assumptions | Pass |

Stronger than the design plan on check 2: every criterion here is a real test,
because this is a module with no human-judgment surface. Nothing is `manual`.
