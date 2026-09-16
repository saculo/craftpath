# craftpath

A repo-native engineering harness for coding agents. The model writes content;
the CLI owns bookkeeping — ids, status, dependencies, approvals, verification
execution, and evidence.

## Install

Craftpath needs [Bun](https://bun.sh), and must resolve as a command from any
directory. The hooks it wires into a project's `.claude/settings.json` invoke it
by name:

```json
{ "type": "command", "command": "craftpath hook guard-write", "timeout": 5 }
```

Once per machine:

```bash
git clone https://github.com/saculo/craftpath.git
cd craftpath
bun install
bun add -g "$PWD"
craftpath version        # must work from any directory
```

`bun add -g` links Bun's global bin directory (`~/.bun/bin`, unless
`BUN_INSTALL` is set) to this checkout, so a later `git pull` takes effect
without reinstalling. If `craftpath version` is not found, that directory is not
on your `PATH`; `bun add -g` prints the line to add.

**This step is not optional.** Claude Code hooks fail open — a hook whose
command cannot be found does not block the tool call. Without it the guards
protecting `.craftpath/state/` silently do not run, while `settings.json` still
claims they are wired. `craftpath init` warns when it detects this and
`craftpath doctor` reports it; both print the exact install command for the
checkout they run from.

To upgrade, `git pull` in the checkout, then run `craftpath update` in each
project. To uninstall, `bun remove -g craftpath`.

## Use

```bash
craftpath init                      # scaffold .craftpath/, wire hooks, install commands and skills
craftpath work new "<title>"        # allocate a work item and scaffold its artifacts
craftpath status [--brief]          # current work item, gates, tasks
craftpath validate [--complete]     # structural, or completion checks
```

There is no per-project install step. `craftpath init` copies everything a
project needs into it: the slash commands, the hooks, the artifact templates,
the engineering skills (`.claude/skills/`) and the test-first rule
(`.claude/rules/tdd.md`). They are the project's copies — edit them freely.
`init` never overwrites a template, skill or rule that exists; `craftpath
update` rewrites the slash commands and adds any skill or rule a newer
craftpath ships.

Then fill in the commands in `.craftpath/config.toml` — they are deliberately
blank, because a guessed command that silently does nothing is worse than an
empty one.

Restart Claude Code after `init`, then run `/craftpath:work` in chat.

## Development

```bash
bun run check     # typecheck + tests
bun test          # tests only
```

Plans for unbuilt work live in `PLAN-*.md` at the repository root.
