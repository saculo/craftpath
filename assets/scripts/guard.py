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
from checks import check_design, check_spec  # noqa: E402
from craftpath import Refusal, base_branch, config, git_ok, main_root, refuse, work_item  # noqa: E402


def guard_spec(cwd: str, args: str, command: str) -> None:
    if not args.strip():
        refuse(f"Give the work item a title: {command} <title>")
    root = main_root(cwd)
    base = base_branch(config(root))
    if not git_ok("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}", cwd=root):
        refuse(f'The base branch "{base}" does not exist. Set base_branch in .craftpath/config.toml.')
    if not git_ok("cat-file", "-e", f"{base}:.craftpath/scripts/spec.py", cwd=root):
        refuse(
            f"craftpath's files are not on {base} yet. The work item's worktree is created "
            f"from {base}, so commit .craftpath/ (and the harness files) there first."
        )


def incomplete(name: str, problems: list[str]) -> None:
    if problems:
        refuse("\n".join([f"{name} is not complete yet:", *[f"- {p}" for p in problems]]))


def guard_design(cwd: str, args: str, command: str) -> None:
    _, work = work_item(args, command, cwd)
    incomplete("SPEC.md", check_spec(work))


def guard_plan(cwd: str, args: str, command: str) -> None:
    _, work = work_item(args, command, cwd)
    incomplete("SPEC.md", check_spec(work))
    if (work / "DESIGN.md").exists():
        incomplete("DESIGN.md", check_design(work))


GUARDS = {"spec": guard_spec, "design": guard_design, "plan": guard_plan}


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
        # The command as the user typed it: the pi extension says it is pi.
        command = f"/craftpath-{step}" if event.get("harness") == "pi" else f"/craftpath:{step}"
        if step in GUARDS:
            GUARDS[step](cwd, str(event.get("command_args", "")), command)
    except Refusal as reason:
        refuse(str(reason))
    sys.exit(0)


if __name__ == "__main__":
    main()
