"""Guard for craftpath's harness commands.

Runs before a command reaches the agent: as a Claude Code UserPromptExpansion
hook, and from craftpath's pi extension, both handing it the same JSON on
stdin. Exit 2 refuses the command, with the reason on stderr; exit 0 lets it
through. A step with no guard here is let through.
"""

import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from craftpath import Refusal, base_branch, config, git_ok, main_root, refuse  # noqa: E402


def guard_spec(cwd: str, args: str) -> None:
    if not args.strip():
        refuse("Give the work item a title: /craftpath:spec <title>")
    root = main_root(cwd)
    base = base_branch(config(root))
    if not git_ok("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}", cwd=root):
        refuse(f'The base branch "{base}" does not exist. Set base_branch in .craftpath/config.toml.')
    if not git_ok("cat-file", "-e", f"{base}:.craftpath/scripts/spec.py", cwd=root):
        refuse(
            f"craftpath's files are not on {base} yet. The work item's worktree is created "
            f"from {base}, so commit .craftpath/ (and the harness files) there first."
        )


GUARDS = {"spec": guard_spec}


def main() -> None:
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        sys.exit(0)
    name = str(event.get("command_name", ""))
    if not name.startswith("craftpath:"):
        sys.exit(0)
    step = name.split(":", 1)[1]
    cwd = str(event.get("cwd") or ".")
    try:
        config(main_root(cwd))
        if step in GUARDS:
            GUARDS[step](cwd, str(event.get("command_args", "")))
    except Refusal as reason:
        refuse(str(reason))
    sys.exit(0)


if __name__ == "__main__":
    main()
