# Plan — config loading and `craftpath doctor`

**Status: DRAFT for review.** Written with the `planning` skill.
Covers point 3: making `config.toml` load, validate, and report its own health.

## Requirement

`init` writes a `config.toml` whose commands are deliberately blank (D21 — no
stack detection, because a guessed command that silently does nothing is worse
than a blank one):

```toml
[commands.test]
run = ""                 # e.g. "bun test" / "./gradlew test" / "pytest"
```

Nothing reads this file. Nothing validates it. Nothing tells you it is still
empty. So today a project can be fully "set up" and have zero real verification,
with no signal until M1 tries to execute a selector against `run = ""`.

§8 specifies `doctor` as the answer, and is explicit that it **reports health
rather than gating** — legacy repos with weak tests are exactly where explicit
verification discipline pays off, so refusing to operate on them is wrong.

### Verified before planning

Bun imports TOML natively, so config loading needs no parser dependency:

```
$ bun -e 'const c = await import("./.craftpath/config.toml"); console.log(...)'
{ "commands": { "test": { "run": "" }, "lint": { "run": "" } },
  "skills":   { "backend": { "default_verify": ["test"] } },
  "gates":    { "requirement": "auto", "plan": "auto_if_simple", ... } }
```

### Scenarios

| # | Scenario | Covered by |
|---|---|---|
| S1 | A well-formed config parses into typed values | T301-A1 |
| S2 | A config with an unknown key is rejected, naming the key | T301-A2 |
| S3 | A selector-scoped criterion against a command with no selector_template is refused | T301-A4 |
| S4 | `doctor` reports a blank command as MISSING rather than passing it | T302-A1 |
| S5 | `doctor` on a repo with no working verification still exits 0 | T302-A3 |
| S6 | `doctor` names a command that takes over five minutes | T303-A1 |
| S7 | `doctor` says when the guards are not actually installed | T303-A2 |

---

## T301 — Load and validate config.toml

**Type:** feature · **Skills:** `backend` · **Depends on:** —

A Zod schema for the config, in `src/schema.ts` beside the others, plus a loader.
`.strict()` again: a typo'd key in a hand-edited config must fail loudly rather
than silently disabling the thing it was meant to configure.

### Code

```ts
export const CommandSpec = z
    .object({
        run: z.string().describe("Shell command. Empty means not configured."),
        selector_template: z
            .string()
            .optional()
            .describe('How this runner scopes ONE test, with a {selector} placeholder.'),
    })
    .strict()
    .refine((s) => s.selector_template?.includes("{selector}") ?? true, {
        message: "selector_template must contain the {selector} placeholder",
        path: ["selector_template"],
    });

export const Config = z
    .object({
        commands: z.record(z.string(), CommandSpec).default({}),
        skills: z
            .record(z.string(), z.object({ default_verify: z.array(z.string()) }).strict())
            .default({}),
        gates: z
            .object({
                requirement: z.string(),
                plan: z.string(),
                result: z.string(),
            })
            .strict(),
        git: z.object({ work_branch_prefix: z.string() }).strict(),
    })
    .strict();
```

Two derived helpers, both pure so they are testable without a filesystem:

```ts
/** A command is usable when it has a non-empty run. */
export function isConfigured(spec: CommandSpec): boolean {
    return spec.run.trim().length > 0;
}

/**
 * A selector-scoped criterion needs a runner that can select one test.
 * Without selector_template, `verified_by.selector` is decorative -- the suite
 * runs whole and the evidence proves nothing about that criterion in particular.
 */
export function canRunSelector(spec: CommandSpec): boolean {
    return isConfigured(spec) && spec.selector_template !== undefined;
}

/** The shell command, optionally scoped. The selector is POSIX single-quoted. */
export function commandFor(spec: CommandSpec, selector?: string): string;
```

**This section was amended during execution.** It originally specified
`selector_flag`, a bare flag name appended before the selector. That assumes
every runner takes `<flag> <selector>` with a space, which is wrong for Maven
and for `go test`. Replaced with `selector_template` before T403 was written —
see Q1 for the reasoning and the shapes it covers.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the config.toml that init writes, when loadConfig parses it, then
      it succeeds and commands.test.run is the empty string.
    verified_by:
      - cmd: test
        selector: "config > parses the config init writes"
  - id: A2
    text: >
      Given a config containing a top-level key 'command' (singular), when
      loadConfig parses it, then it throws and the message names that key.
    verified_by:
      - cmd: test
        selector: "config > rejects an unknown top-level key"
  - id: A3
    text: >
      Given a command spec with run '  ', when isConfigured is called, then it
      returns false; given run 'bun test' it returns true.
    verified_by:
      - cmd: test
        selector: "config > whitespace-only run counts as unconfigured"
  - id: A4
    text: >
      Given a command with run 'bun test' and no selector_template, when
      canRunSelector is called, then it returns false.
    verified_by:
      - cmd: test
        selector: "config > a runner with no selector template cannot scope a selector"
  - id: A5
    text: >
      Given a config.toml that is not valid TOML, when loadConfig runs, then it
      throws CorruptStateError naming the file, not a raw parser error.
    verified_by:
      - cmd: test
        selector: "config > malformed toml reports the file it failed on"
```

### Out of scope

- Executing any command. That is M1's `task verify`.
- Per-runner selector shims. Superseded: one template covers every shape (Q1).
- Validating that `skills.*.default_verify` names commands that exist — that is
  a cross-reference check and belongs in `validate` (M1), where the whole
  work item is in scope.

---

## T302 — Report verification health with doctor

**Type:** feature · **Skills:** `backend` · **Depends on:** T301

`craftpath doctor` runs each configured command and reports, in §8's shape:

```
Verification health: DEGRADED

  test                      PASS       38s
  test-integration          MISSING
  lint                      PASS        3s

Work may continue. Criteria verified by `test-integration` cannot reach fully
verified status without a manual acknowledgement.
```

**It exits 0 in every health state.** `doctor` is a report, not a gate — §8 is
explicit that refusing to operate on imperfect repos is wrong, and a `doctor`
that fails the build is one people stop running.

### The three states

| State | Meaning |
|---|---|
| `healthy` | Every configured command runs and passes |
| `degraded` | At least one command is blank, failing, or slow — work continues |
| `unusable` | No command is configured at all; nothing can be verified |

`unusable` still exits 0. It is the state a fresh `init` is in, and telling
someone their brand-new project is broken is not useful.

### Code

```ts
type Health = "healthy" | "degraded" | "unusable";

interface CommandReport {
    name: string;
    status: "PASS" | "FAIL" | "MISSING" | "SLOW";
    durationMs: number | null;
}
```

Commands run sequentially, not in parallel: two test suites racing for the same
database is a flakiness source, and `doctor` producing a false FLAKY reading
would be worse than it being slow.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a config where commands.test.run is empty, when doctor runs, then
      test is reported MISSING and no shell command is executed for it.
    verified_by:
      - cmd: test
        selector: "doctor > a blank command is reported missing and not run"
  - id: A2
    text: >
      Given a config where every command runs and exits 0, when doctor runs,
      then the reported health is healthy.
    verified_by:
      - cmd: test
        selector: "doctor > all commands passing reports healthy"
  - id: A3
    text: >
      Given a config with no configured commands at all, when doctor runs, then
      health is unusable and the process still exits 0.
    verified_by:
      - cmd: test
        selector: "doctor > an unusable repo still exits zero"
  - id: A4
    text: >
      Given a command that exits non-zero, when doctor runs, then it is
      reported FAIL, health is degraded, and the remaining commands still run.
    verified_by:
      - cmd: test
        selector: "doctor > a failing command does not stop the report"
```

### Out of scope

- Flakiness detection. §8's example shows `FLAKY (2/5 runs failed)`, which means
  running each command five times. That is a different command with a different
  runtime budget — `doctor --flaky`, later.
- Surfacing health in the PR body. §8 asks for it; `pr body` is M1.
- Caching results between runs.

---

## T303 — Flag the checks that make a harness quietly useless

**Type:** hardening · **Skills:** `backend` · **Depends on:** T302

Two findings that are not about whether commands pass, and that are invisible
until something important does not happen.

**Slow commands.** §8: *"flags any command over 5 minutes — a slow gate is a gate
that gets skipped."* A command that takes six minutes is technically PASS and
practically a command nobody will let run.

**Unresolvable guards.** If `craftpath` is not on PATH in this project, the hooks
in `.claude/settings.json` do not run, guards fail open, and state writes are
unprotected while everything claims to be wired. This is `PLAN-install.md`'s Q2,
answered here: `doctor` is the right place to say it, because it is exactly the
class of thing `doctor` exists for — the harness reporting honestly on itself.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a command that takes longer than the five minute threshold, when
      doctor runs, then it is reported SLOW with its duration and health is
      degraded.
    verified_by:
      - cmd: test
        selector: "doctor > a command over the threshold is reported slow"
  - id: A2
    text: >
      Given .claude/settings.json wires `craftpath hook guard-write` and
      craftpath does not resolve on PATH, when doctor runs, then the report
      states that guards are not active and state writes are unprotected.
    verified_by:
      - cmd: test
        selector: "doctor > reports when the wired guards cannot run"
  - id: A3
    text: >
      Given craftpath resolves and the hooks are wired, when doctor runs, then
      no guard warning appears in the report.
    verified_by:
      - cmd: test
        selector: "doctor > says nothing about guards when they are active"
```

### Out of scope

- Fixing either finding. `doctor` reports; `init` wires; the user links.
- Checking that the hook *would* block — that needs invoking it, and a `doctor`
  with side effects on state is a bad trade.

---

## Dependency graph

```
T301 ──▶ T302 ──▶ T303
```

Strictly sequential, and each edge is real: `doctor` cannot run commands it
cannot load, and T303 adds findings to a report that must exist first.

## Not in this plan

- **Executing selectors and recording evidence.** That is M1 (`PLAN-m1-kernel.md`)
  and it is the consumer of everything here.
- **`doctor --flaky`.** See T302 out of scope.
- **Auto-filling config.toml.** D21 settled this: no stack detection.
- **Gate policy evaluation.** `gates` is parsed into typed values here and read
  by nobody until M1.

## Open questions

- ~~**Q1 — how far should `selector_flag` stretch?**~~ **Resolved: replaced by
  `selector_template`,** before T403 was written, since T403 builds directly on
  it and retrofitting after would have been materially more expensive.

  `selector_flag` was worse than §5.4 admitted. It assumed every runner takes
  `<flag> <selector>` with a space, which is already wrong for Maven
  (`-Dtest=X`) and for `go test` (the package comes *after* the selector). One
  `{selector}` placeholder covers every shape with no enum of runners to
  extend:

  ```
  "--tests {selector}"       gradle     "-Dtest={selector}"   maven
  "-k {selector}"            pytest     "-t {selector}"       bun, jest
  "-run {selector} ./..."    go
  ```

  The schema refuses a template without the placeholder — otherwise the
  selector is silently dropped and the whole suite runs, which is exactly the
  lie the selector exists to prevent. The substituted value is POSIX
  single-quoted, because selectors come from task files (model space) and the
  command is handed to `sh -c`.
- **Q2 — should `doctor` run commands at all by default?** Running the full test
  suite to answer "is the harness healthy" is expensive, and someone will run
  `doctor` expecting it to be instant. A `--quick` mode that only reports
  configuration without executing may be the better default.

---

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every scenario maps to a criterion | Pass — S1–S7 |
| 2 | Every criterion names a selector | Pass — 12 criteria, 0 manual |
| 3 | Every criterion could fail today | Pass — nothing reads config.toml |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — T302-A1 ("no shell command executed"), T303-A3 ("no guard warning") |
| 6 | Verifiable without an unfinished sibling | Pass |
| 7 | Every depends_on edge would really fail | Pass |
| 8 | Skills match the work | Pass |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |
