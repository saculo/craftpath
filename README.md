# craftpath

A repo-native engineering harness for coding agents. The model writes content;
the CLI owns bookkeeping — ids, status, dependencies, approvals, verification
execution, and evidence.

## Install

Craftpath must resolve as a command, not just as a file in this repo. The hooks
it wires into a project's `.claude/settings.json` invoke it by name:

```json
{ "type": "command", "command": "craftpath hook guard-write", "timeout": 5 }
```

From this repository, once:

```bash
bun install
bun link
```

Then in each project that uses craftpath:

```bash
bun link craftpath
```

**This step is not optional.** Claude Code hooks fail open — a hook whose
command cannot be found does not block the tool call. So an unlinked craftpath
means the guards protecting `.craftpath/state/` silently do not run, while
`settings.json` still claims they are wired. `craftpath init` warns when it
detects this, and `craftpath doctor` reports it.

## Use

```bash
craftpath init                      # scaffold .craftpath/, wire hooks, write commands
craftpath work new "<title>"        # allocate a work item and scaffold its artifacts
craftpath status [--brief]          # current work item, gates, tasks
craftpath validate [--complete]     # structural, or completion checks
```

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
