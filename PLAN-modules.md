# Plan: modules, and commands run where the change is

## The problem

`task verify` runs every command from the repo root
(`src/core/task.ts`, `Bun.$\`sh -c ${line}\`.cwd(root)`), and `CommandSpec`
has nothing but `run`. A project laid out as `./module1`, `./module2` has to
write the location into the command:

```toml
[commands.module1]
run = "cd module1 && bun test"
```

That puts a directory into a string that should only say what to run, needs a
key per module, and makes the plan name modules (`cmd: module1`) where it
should name a behaviour (`cmd: test`).

Alongside it, `[skills.*] default_verify` assigns commands to skills. Nothing
in `src/` reads it; modules are the right owner of commands, so it goes.

## The design

A project is a set of modules. Each declares where it lives, its commands, and
what it depends on. After implementation, the changed files decide which
modules are affected, the dependency graph widens that to their dependents,
and `verify` runs the criterion's command in each affected module's directory.

```toml
[modules.shared]
path = "./shared"
test = "bun test"
build = "bun run build"

[modules.api]
path = "./api"
test = "./gradlew test"
build = "./gradlew build"
depends_on = ["shared"]

[modules.web]
path = "./apps/web"
test = "bun test"
depends_on = ["shared"]
```

A project without submodules is one module at the root -- no second format:

```toml
[modules.app]
path = "./"
test = "bun test"
```

A criterion keeps naming a behaviour:

```yaml
verified_by:
  - cmd: test
```

Changing `./shared/src/x.ts` runs `test` in `shared`, then `api` and `web`.
Changing `./apps/web/page.tsx` runs `test` in `web` only.

### Decisions

- **Four fields, strict:** `path`, `test`, `build`, `depends_on`. Anything
  else in a module is a config error. A criterion's `cmd` is `test`, `build`
  or `manual`.
- **`path` is required and project-relative,** written `./apps/web`; `./` is
  the project root. Trailing slashes are normalised. Absolute paths and `..`
  are refused.
- **Changed files** are the diff against the merge-base with the base branch,
  plus uncommitted and untracked files. Each belongs to the module with the
  longest matching `path`, so a root module owns whatever no other module
  claims.
- **Affected** = the modules owning a changed file, plus everything depending
  on them, transitively. Run in dependency order.
- **A file no module owns triggers nothing** and is not an error. (With a root
  module there is no such file.)
- **Nothing affected is an error, not a pass.** A criterion naming `test` that
  runs no tests has proven nothing.
- **An affected module without the named command is an error,** raised before
  anything runs. Skipping it would make "test passed" mean "test passed in the
  modules that happen to have tests".
- **One evidence record per command,** as today, so `proves()` does not
  change. It gains a `modules` list naming where it ran, its exit is non-zero
  if any module failed, and its log has one section per module.
- **Order of work: additive, then remove.** T620-T623 add `[modules]` next to
  `[commands]` (modules win when present), so every PR stays green. T624
  then deletes `[commands]` and `[skills]`. No migration: no project predates
  modules (decided 2026-10-03, as for managed files).

---

## T620 — Declare modules in config.toml

**Type:** feature · **Skills:** `backend` · **Depends on:** —

`Config` learns `[modules]` and refuses a graph that cannot be walked.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given [modules.web] with path "./apps/web/", test, build and depends_on,
      when the config is loaded, then web has path "./apps/web" and the other
      fields as written.
    verified_by:
      - cmd: test
        selector: "modules config > reads path, test, build and depends_on"
  - id: A2
    text: >
      Given a module with a field other than path, test, build and depends_on,
      when the config is loaded, then loading fails naming the module and the
      field.
    verified_by:
      - cmd: test
        selector: "modules config > refuses an unknown field"
  - id: A3
    text: >
      Given a module whose path is absolute, contains "..", or does not start
      with "./", when the config is loaded, then loading fails naming the
      module.
    verified_by:
      - cmd: test
        selector: "modules config > refuses a path outside the project"
  - id: A4
    text: >
      Given a module whose depends_on names an undeclared module, when the
      config is loaded, then loading fails naming both modules.
    verified_by:
      - cmd: test
        selector: "modules config > refuses a dependency on an unknown module"
  - id: A5
    text: >
      Given modules whose depends_on form a cycle, when the config is loaded,
      then loading fails naming the modules in the cycle.
    verified_by:
      - cmd: test
        selector: "modules config > refuses a dependency cycle"
  - id: A6
    text: >
      Given two modules with the same path after normalising, when the config
      is loaded, then loading fails naming both.
    verified_by:
      - cmd: test
        selector: "modules config > refuses two modules with one path"
```

### Out of scope

- Running anything; removing `[commands]` (T624).

---

## T621 — Work out which modules a change affects

**Type:** feature · **Skills:** `backend` · **Depends on:** T620

A function from changed files and the module graph to the affected modules in
dependency order, and the git call that supplies the changed files.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given modules shared and api, and a change to ./api/src/a.ts, then the
      affected modules are [api].
    verified_by:
      - cmd: test
        selector: "affected modules > a changed file selects the module that owns it"
  - id: A2
    text: >
      Given api and web depending on shared, and a change to ./shared/x.ts,
      then the affected modules are shared, then api and web.
    verified_by:
      - cmd: test
        selector: "affected modules > a change reaches every transitive dependent, dependencies first"
  - id: A3
    text: >
      Given a module at "./" and a module web at "./apps/web", then a change to
      ./apps/web/p.tsx affects only web, and a change to ./src/root.ts affects
      only the root module.
    verified_by:
      - cmd: test
        selector: "affected modules > the longest matching path owns the file"
  - id: A4
    text: >
      Given modules shared and api and no root module, and a change only to
      ./README.md, then no module is affected and no error is raised.
    verified_by:
      - cmd: test
        selector: "affected modules > a file no module owns affects nothing"
  - id: A5
    text: >
      Given a git repo branched from the base, with one committed change, one
      uncommitted change and one untracked file, then the changed files are
      exactly those three.
    verified_by:
      - cmd: test
        selector: "changed files > committed, uncommitted and untracked against the merge-base"
```

### Out of scope

- Inferring dependencies from package.json, Gradle or anything else. The graph
  is what `depends_on` says.

---

## T622 — Run a criterion's command in each affected module

**Type:** feature · **Skills:** `backend` · **Depends on:** T621

`task verify` resolves `cmd` per affected module and runs it from that
module's directory.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given [modules.api] with test = "pwd > out", and a change under ./api,
      when task verify runs, then ./api/out contains the api directory.
    verified_by:
      - cmd: test
        selector: "module verify > runs the command from the module's directory"
  - id: A2
    text: >
      Given modules api and web, and a change only under ./web, when task
      verify runs, then web's test runs and api's does not.
    verified_by:
      - cmd: test
        selector: "module verify > runs only affected modules"
  - id: A3
    text: >
      Given an affected module that does not declare the command a criterion
      names, when task verify runs, then it fails naming the module and the
      command, and no module's command has run.
    verified_by:
      - cmd: test
        selector: "module verify > refuses before running when an affected module lacks the command"
  - id: A4
    text: >
      Given modules declared and a change only to a file no module owns, when
      task verify runs, then it fails saying no module is affected, and
      records no evidence.
    verified_by:
      - cmd: test
        selector: "module verify > refuses when no module is affected"
  - id: A5
    text: >
      Given two affected modules where one test fails, when task verify runs,
      then both run, the evidence for test records both modules and a non-zero
      exit, and the log has a section for each.
    verified_by:
      - cmd: test
        selector: "module verify > one failing module fails the command's evidence"
  - id: A6
    text: >
      Given a config with [commands] and no [modules], when task verify runs,
      then commands run from the repo root exactly as before.
    verified_by:
      - cmd: test
        selector: "module verify > a config without modules verifies as before"
```

### Out of scope

- Showing affected modules in the task summary; small once evidence carries
  them, so a follow-up.

---

## T623 — init and doctor speak modules

**Type:** feature · **Skills:** `backend` · **Depends on:** T620

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a project with no config, when init runs, then config.toml has
      [modules.app] with path "./" and blank test and build, and no [commands]
      or [skills] table.
    verified_by:
      - cmd: test
        selector: "init detection > writes one root module"
  - id: A2
    text: >
      Given a project whose package.json declares a test script, when init
      runs, then [modules.app] has test = "bun run test".
    verified_by:
      - cmd: test
        selector: "init detection > fills the root module from what the project declares"
  - id: A3
    text: >
      Given [modules.api] with test set and build blank, when doctor runs,
      then it reports api's test as configured and api's build as not.
    verified_by:
      - cmd: test
        selector: "doctor > reports each module's commands"
```

### Out of scope

- Detecting submodules. `init` writes one root module; more are declared by
  hand.
- Detecting `build`. The existing probes only know `test`; `lint` detection
  goes, since `lint` is no longer a command.

---

## T624 — Remove [commands] and [skills]; every shipped text speaks modules

**Type:** feature · **Skills:** `backend` · **Depends on:** T622, T623

No migration: nobody runs a craftpath older than this, so there is no config
with `[commands]` to carry over. `[commands]` and `[skills]` leave the schema,
a criterion's `cmd` is `test`, `build` or `manual`, and every text craftpath
ships stops describing the old shape -- otherwise the model reads the skills,
writes `cmd: test-integration`, and verify refuses it.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Given a config with a [commands] table, when it is loaded, then loading
      fails naming [commands] and saying to declare [modules] instead.
    verified_by:
      - cmd: test
        selector: "modules config > refuses [commands]"
  - id: A2
    text: >
      Given a task whose criterion names cmd lint, when the task is parsed,
      then parsing fails saying cmd is test, build or manual.
    verified_by:
      - cmd: test
        selector: "modules config > a criterion names test, build or manual"
  - id: A3
    text: >
      Given every skill, rule, command and template craftpath ships, then none
      names a criterion command other than test, build or manual, none
      mentions [commands] or [skills] or "a key in config commands", and the
      planning skill, the test-first rule and the work command each mention
      modules.
    verified_by:
      - cmd: test
        selector: "init installs > shipped texts describe modules"
  - id: A4
    text: >
      Given the README, then it shows a [modules] table, says changed files
      choose the modules verify runs in, and no longer shows [commands].
    verified_by:
      - cmd: test
        selector: "cli install > readme describes modules"
```

### Out of scope

- A migration for configs with `[commands]` (none exist).
- T622-A6 ("a config without modules verifies as before") is deleted with
  `[commands]`: there is no such config any more.

---

## Dependency graph

```
T620 ──┬──▶ T621 ──▶ T622 ──┬──▶ T624
       └──▶ T623 ───────────┘
```

Waves: `[T620]` → `[T621, T623]` → `[T622]` → `[T624]`.

## Decided

- **Base branch:** an optional `[git] base_branch`, defaulting to `master`,
  with a precondition error when it does not exist. Lands with T621.
