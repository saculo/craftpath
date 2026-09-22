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
project to refresh the generated commands and pick up any new skills or rules.
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
| Isolated task context | built-in subagent | `craftpath_task`, registered by that extension |

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
`init` never overwrites a template, skill or rule that exists; `craftpath
update` rewrites the slash commands and adds any skill or rule a newer
craftpath ships.

Then fill in the commands in `.craftpath/config.toml` — they are deliberately
blank, because a guessed command that silently does nothing is worse than an
empty one.

Restart the agent after `init`, then run the work command it printed.

## Development

```bash
bun run check     # typecheck + tests
bun test          # tests only
```

Plans for unbuilt work live in `PLAN-*.md` at the repository root.
