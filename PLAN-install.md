# Plan — make `craftpath` resolvable as a command

**Status: DRAFT for review.** Written with the `planning` skill.
**This is the blocker.** Nothing else in the roadmap can be exercised in a real
project until it lands.

## Requirement

`init` writes hooks into every project's `.claude/settings.json`:

```json
{ "type": "command", "command": "craftpath hook guard-write", "timeout": 5 }
```

`package.json` has no `bin` field and `craftpath` is not on `PATH`, so in a real
project that hook resolves to nothing:

```
$ command -v craftpath
NOT ON PATH

$ echo '{"tool_name":"Write","tool_input":{"file_path":".craftpath/state/T1.json"}}' \
    | craftpath hook guard-write
bash: craftpath: command not found
exit=127
```

D24 says guards fail open and only exit 2 blocks. **127 is not 2, so the write is
allowed.** The trust boundary §1 calls "the first implementation task" is absent
in every project `init` touches, while `settings.json` says it is wired.

Verified working when invoked directly (`bun bin/craftpath.ts hook guard-write`
returns exit 2 with the right message), so this is purely a resolution problem.

### Scenarios

| # | Scenario | Covered by |
|---|---|---|
| S1 | `craftpath version` runs from a directory that is not this repo | T201-A1 |
| S2 | The installed binary blocks a state write with exit 2 | T201-A2 |
| S3 | `init` in a project where craftpath will not resolve says so | T202-A1 |
| S4 | `init` where it does resolve stays quiet | T202-A2 |

---

## T201 — Add a bin entry so the CLI resolves as a command

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`bin/craftpath.ts` already carries `#!/usr/bin/env bun`, so the only missing
piece is the manifest entry and a documented install step.

### Code

`package.json`:

```json
{
    "name": "craftpath",
    "module": "index.ts",
    "type": "module",
    "bin": { "craftpath": "./bin/craftpath.ts" },
    ...
}
```

Install for dogfooding, from the craftpath repo:

```
bun link            # registers the package globally
```

and in each consuming project, once:

```
bun link craftpath
```

`bun link` is the right mechanism for now rather than publishing, because D17
says the CLI ships **inside the plugin** in V0 — there is no separate package to
publish to. See Q1.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given the package is linked, when `craftpath version` runs from a
      directory outside this repository, then it prints the version and exits 0.
    verified_by:
      - cmd: test
        selector: "cli install > version runs from outside the repo"
  - id: A2
    text: >
      Given the package is linked, when the guard-write hook is invoked by name
      with a payload targeting .craftpath/state/, then it exits 2 and its
      stderr names the refusal.
    verified_by:
      - cmd: test
        selector: "cli install > the resolved binary blocks a state write"
  - id: A3
    text: >
      Given README, when it is read, then it states the link step required
      before hooks will fire in a consuming project.
    verified_by:
      - cmd: test
        selector: "cli install > readme documents the link step"
```

### Out of scope

- Publishing to a registry. See Q1.
- Bundling the CLI into a Claude Code plugin. That is the V0 distribution story
  and a separate work item.
- Supporting a runtime other than Bun. D19 settled that.

---

## T202 — Warn at init when the hook command will not resolve

**Type:** hardening · **Skills:** `backend` · **Depends on:** T201

T201 fixes the case where someone links the package. This covers the case where
they do not — because the failure is silent, permissive, and looks like success.

`init` already prints a "wired" line for the hooks. It should not claim that
when the command cannot be found.

### Code

At the end of `init`, after hooks are merged:

```ts
const resolvable = await Bun.$`command -v craftpath`.quiet().nothrow();
if (resolvable.exitCode !== 0) {
    console.error(
        "\n!! `craftpath` is not on PATH, so the hooks just wired will not run.\n" +
        "   Guards fail open, so state writes will NOT be blocked until you run:\n" +
        "     bun link craftpath\n",
    );
}
```

Stderr, not stdout, and phrased as what is *not* protected rather than as a
missing dependency. "craftpath not found" reads as cosmetic; "state writes will
not be blocked" reads as the security property it actually is.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given craftpath does not resolve on PATH, when init runs, then its stderr
      states that state writes will not be blocked and names the link command,
      and init still exits 0 with the hooks written.
    verified_by:
      - cmd: test
        selector: "cli install > init warns when the hook command will not resolve"
  - id: A2
    text: >
      Given craftpath does resolve, when init runs, then no such warning is
      printed.
    verified_by:
      - cmd: test
        selector: "cli install > init stays quiet when the command resolves"
```

### Out of scope

- Refusing to write the hooks. A project half-set-up is worse than one with a
  warning, and `init` is idempotent so re-running after linking is free.
- Attempting the link automatically. Installing something globally is not
  `init`'s decision to make.

---

## Dependency graph

```
T201 ──▶ T202
```

Both small. T202 depends on T201 only because the "resolves" branch cannot be
tested until there is something to resolve.

## Not in this plan

- **Plugin packaging.** D17's "CLI ships inside the plugin" is the real
  distribution answer and needs its own work item.
- **Version skew between the linked CLI and a project's expectations.**
  `craftpath update` exists to rewrite slash commands after an upgrade; whether
  state written by an older CLI needs migrating is an M1+ question.

## Open questions

- **Q1 — is `bun link` the intended install path, or a stopgap?** D17 says the
  CLI ships inside the plugin, which implies the plugin puts it on PATH. If that
  is the plan, T201's `bin` entry is still required but the README step changes,
  and plugin packaging becomes the blocker instead of this.
- **Q2 — should `doctor` also check this?** It is the natural home for "your
  harness is not actually protecting anything", and `doctor` already reports
  health rather than gating. Deferred to `PLAN-config-doctor.md`, which assumes
  yes.

---

## Gate checklist

| # | Check | Status |
|---|---|---|
| 1 | Every scenario maps to a criterion | Pass — S1–S4 |
| 2 | Every criterion names a selector | Pass — 5 criteria, 0 manual |
| 3 | Every criterion could fail today | Pass — no `bin` field exists |
| 4 | One trigger, concrete observable outcome | Pass |
| 5 | Criteria that forbid an effect say so | Pass — T202-A2 ("no such warning") |
| 6 | Verifiable without an unfinished sibling | Pass |
| 7 | Every depends_on edge would really fail | Pass |
| 8 | Skills match the work | Pass |
| 9 | No task title contains "and" | Pass |
| 10 | Out of scope names the assumptions | Pass |
