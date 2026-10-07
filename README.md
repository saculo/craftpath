# craftpath

A repo-native engineering harness for coding agents. The model writes content;
the CLI owns bookkeeping — ids, status, dependencies, approvals, verification
execution, and evidence.

Runs on **Claude Code** and **[pi](https://pi.dev)**, from one core. What
craftpath actually guarantees — the gates, the task graph, and evidence proven
by re-reading recorded exit codes — is the same on both, because none of it
depends on the agent.

## Install

Craftpath needs [Bun](https://bun.sh). Once per machine:

```bash
bun add -g craftpath
craftpath version        # must work from any directory
```

Then, in any project:

```bash
craftpath init
```

That is the whole setup. `init` asks which harnesses to install into, scaffolds
`.craftpath/`, wires the guards, and writes the commands and skills.

**`craftpath` must resolve as a command from any directory.** The guards it
wires invoke it by name:

```json
{ "type": "command", "command": "craftpath hook guard-write", "timeout": 5 }
```

If `craftpath version` is not found, Bun's global bin directory (`~/.bun/bin`,
unless `BUN_INSTALL` is set) is not on your `PATH` — `bun add -g` prints the
line to add. This matters more than it looks: Claude Code hooks fail open, so a
hook whose command cannot be found does not block the tool call. Without it the
guards protecting `.craftpath/state/` silently do not run while the harness
config still claims they are wired. `craftpath init` warns when it detects this
and `craftpath doctor` reports it.

Upgrade with `bun update -g craftpath`, then run `craftpath update` in each
project to refresh the generated commands, skills, rules and templates.
Uninstall with `bun remove -g craftpath`.

### Working on craftpath itself

Link the checkout instead, so a `git pull` takes effect without reinstalling:

```bash
git clone https://github.com/saculo/craftpath.git
cd craftpath
bun install
bun add -g "$PWD"
```

`init` and `doctor` print whichever of the two install commands matches the copy
that is running, so the fix they suggest can always be pasted as-is.

## Use

```bash
craftpath init                      # scaffold .craftpath/, wire guards, install commands and skills
craftpath work new "<title>"        # allocate a work item and scaffold its artifacts
craftpath status [--brief]          # current work item, gates, tasks
craftpath validate [--complete]     # structural, or completion checks
```

### Harnesses

`craftpath init` asks which harnesses to install into, and accepts several:

```bash
craftpath init                          # asks, at a terminal
craftpath init --harness pi             # or say so outright
craftpath init --harness claude-code,pi # both, from one repo
```

Each gets the same skills, rules and commands, in the shape it can read:

|  | Claude Code | pi |
|---|---|---|
| Skills | `.claude/skills/` | `.pi/skills/` |
| Commands | `.claude/commands/craftpath/`, `/craftpath:work` | `.pi/prompts/`, `/craftpath-work` |
| Test-first rule | `.claude/rules/tdd.md` | `.pi/skills/tdd/SKILL.md` — pi has no rules mechanism |
| Guards | hooks in `.claude/settings.json` | `.pi/extensions/craftpath.ts` |
| Isolated task context | built-in subagent | pi-subagents-lite's `Agent` tool (`pi install -l npm:pi-subagents-lite`) |

The pi extension is a shim, not a second implementation: it spawns the same
`craftpath hook guard-*` commands Claude Code wires and translates the result.
One rule set, so the two cannot drift.

**pi only:** project resources load only after the project is trusted, so an
installed extension does nothing until you trust the repo (`pi -a`, or
`defaultProjectTrust` in `~/.pi/agent/settings.json`). `craftpath doctor`
reports the guard state per harness.

Run `craftpath update` after upgrading; it targets whatever the project already
has, and never adds a harness you did not choose.

`craftpath init` copies everything a project needs into it: the slash commands, the hooks, the artifact templates,
the engineering skills (`.claude/skills/`) and the test-first rule
(`.claude/rules/tdd.md`). They are the project's copies — edit them freely.
`init` never overwrites a template, skill or rule that exists, and records a
hash of each one it writes in `.craftpath/manifest.json` (commit it).

`craftpath update` rewrites the slash commands, and uses those hashes to tell
the files you edited from the ones you did not:

- a file you did not edit is replaced with the new version, and one a newer
  craftpath adds is written;
- a file you edited is left alone when the release does not change it;
- a file you edited that the release also changes is asked about at a
  terminal — show the diff, keep yours, or take the new version. Keeping
  yours is remembered until a later release changes that file again.

Without a terminal, as when an agent runs it, `update` asks nothing: it keeps
your file, writes the release's version beside it as `<file>.new`, finishes
everything else, and exits 2. Settle those by running `craftpath update` at a
terminal, or answer every one at once with `craftpath update --keep` or
`--take`. `craftpath doctor` lists the files you edited and any `.new` waiting.

### Modules

`.craftpath/config.toml` describes the project as modules: directories with
their own `test` and `build` commands, and the modules they depend on.

```toml
[modules.shared]
path = "./shared"
test = "bun test"

[modules.api]
path = "./api"
test = "./gradlew test"
build = "./gradlew build"
depends_on = ["shared"]
```

A criterion names `test`, `build` or `manual`. After implementation, the changed
files pick the modules a task affects — the module whose directory holds each
file, plus every module that depends on it — and `craftpath task verify` runs
the command in each, from that module's directory. A change to `./shared` is
proven in `shared` and in `api`; a change to `./api` only in `api`. The changes
are measured against `base_branch` under `[git]`, which `init` sets from the
repository: the remote's default branch, else `main` or `master`.

A project without submodules is one module at the root, which is what `init`
writes:

```toml
[modules.app]
path = "./"
test = "bun run test"
build = ""
```

`init` fills that `test` from what the project declares: a `test` script in
`package.json`, `gradlew`, `Cargo.toml`, `go.mod`, or a `[tool.pytest]` section
in `pyproject.toml`. It prints what it detects and leaves the rest blank, and it
fills nothing when two of those are present, because picking one would be a
guess. A guessed command that silently does nothing is worse than an empty one.
Fill in whatever is still blank, then run `craftpath doctor` to see which
commands actually run.

Restart the agent after `init`, then run the work command it printed.

### Modes

`craftpath work new` takes `--light` (the default) or `--standard`. Both pass
through the same three gates; standard adds the documents a reviewer reads at
them. Light keeps every gate and drops those documents, so what each gate
reviews is the explicit content that exists: the requirement, the task files
and their criteria, the evidence, and the spec delta.

|  | light | standard |
|---|---|---|
| Scaffolded | `requirement.md`, `spec-delta.md`, `changelog.md` | the same, plus `context.md`, `plan.md`, `result.md` |
| G1 requirement | `requirement.md` | `requirement.md` |
| G2 plan | the task files and their acceptance criteria | the same, plus `context.md` and `plan.md` |
| G3 result | every task done, its evidence, `spec-delta.md` | the same, plus `result.md`, which `approve result` refuses while it is the template |

`design.md` is in neither: it is copied from the templates when a boundary
decision needs one.

### One work item, end to end

The work command drives this loop for you. These are the commands it runs, so
you know what it is doing and can pick it up by hand:

```bash
craftpath work new "Avatar upload"        # allocate W-0001-avatar-upload, branch from base_branch
craftpath approve requirement             # G1, once requirement.md is written
craftpath task add T001 --title "Reject unsupported formats" --skills backend
craftpath approve plan                    # G2, once every task has its acceptance criteria
craftpath task next                       # the work command's loop: start the next eligible task
                                          # and print its brief; the agent runs it, then records
                                          # the outcome with `task report` -- craftpath runs nothing
craftpath task start T001                 # or by hand: refuses until the plan is approved, or while a
                                          # dependency is unfinished; failing test first, then the code
craftpath task verify T001                # runs test/build in each affected module; the evidence
                                          # is bound to the code as it is now
git commit                                # with trailers `Work: W-0001-avatar-upload` and `Task: T001`
craftpath task done T001                  # refuses without current evidence and the trailers,
                                          # or while source changes are uncommitted
craftpath task verify --all               # re-prove every task if later work changed the code
craftpath approve result                  # G3, once every task is done and spec-delta.md says what changed
craftpath validate --complete             # names anything still unproven
craftpath pr body > /tmp/pr.md && gh pr create --body-file /tmp/pr.md
craftpath archive                         # last commit of the PR: moves it to .craftpath/archive/
```

With more than one work item open, every work-scoped command needs
`--work <id>` -- `craftpath status` lists the open ones -- and the generated
commands always pass it. Each work item gets its own branch from `base_branch`;
running several at once is a matter of one git worktree per branch, which
craftpath leaves to you.

A rebase or squash can drop a commit's trailers, and then `validate --complete`
reports a done task with no trailer on the branch. Run `craftpath reconcile` to
see every place recorded state and the repository disagree, then `craftpath
reconcile --fix` to repair what can be: the task goes back to `in_progress`
with its evidence kept, and recommitting with the trailers and running `task
done` completes it again. Never hand-edit `.craftpath/state/`; the guards
refuse it for a reason.

## Development

```bash
bun run check     # typecheck + tests
bun test          # tests only
```

Plans for unbuilt work live in `PLAN-*.md` at the repository root.

### Releasing

A release is a reviewed pull request that bumps `version` in `package.json`.
Merging it to `master` is the whole release: the `release` workflow sees that
master declares a version npm does not have, runs `bun run check`, publishes
to npm, then tags `v<version>` and creates the GitHub Release.

Leave tagging and the Release to the workflow. It publishes before it tags, and
it reads an existing tag as "already released", so a tag pushed by hand makes
it skip the publish. To rehearse, run the workflow from the Actions tab: a
manual run is a dry run unless you untick it.
