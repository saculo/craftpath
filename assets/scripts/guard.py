"""Guard for craftpath's steps: a PreToolUse hook on shell commands.

Every step starts by running its script (`python3 .craftpath/scripts/plan.py
C-00001`). Claude Code's PreToolUse hook and craftpath's pi extension hand this
guard that tool call first. When the command runs a step's script, the guard
checks the step may start -- its inputs are complete -- and refuses with the
JSON both harnesses read. Any other command passes straight through.
"""

import json
import re
import shlex
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import check_design, check_spec  # noqa: E402
from craftpath import Refusal, base_branch, config, git_ok, main_root, work_item  # noqa: E402


def guard_spec(cwd: str, args: str, command: str) -> None:
    if not args.strip():
        raise Refusal(f"Give the work item a title: {command} <title>")
    root = main_root(cwd)
    base = base_branch(config(root))
    if not git_ok("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}", cwd=root):
        raise Refusal(f'The base branch "{base}" does not exist. Set base_branch in .craftpath/config.toml.')
    if not git_ok("cat-file", "-e", f"{base}:.craftpath/scripts/spec.py", cwd=root):
        raise Refusal(
            f"craftpath's files are not on {base} yet. The work item's worktree is created "
            f"from {base}, so commit .craftpath/ (and the harness files) there first."
        )


def incomplete(name: str, problems: list[str]) -> None:
    if problems:
        raise Refusal("\n".join([f"{name} is not complete yet:", *[f"- {p}" for p in problems]]))


def guard_design(cwd: str, args: str, command: str) -> None:
    _, work = work_item(args, command, cwd)
    incomplete("SPEC.md", check_spec(work))


def guard_plan(cwd: str, args: str, command: str) -> None:
    _, work = work_item(args, command, cwd)
    incomplete("SPEC.md", check_spec(work))
    if (work / "DESIGN.md").exists():
        incomplete("DESIGN.md", check_design(work))


GUARDS = {"spec": guard_spec, "design": guard_design, "plan": guard_plan}


# A step's script, as the agent runs it: `python3 .craftpath/scripts/plan.py C-00001`.
STEP_SCRIPT = re.compile(r"(?:^|[\s;&|(])(?:\S*/)?python3?\s+(?:\S*/)?\.craftpath/scripts/([a-z-]+)\.py\b([^;&|\n]*)")


def deny(reason: str) -> None:
    """The PreToolUse refusal both Claude Code and craftpath's pi extension read."""
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    sys.exit(0)


def main() -> None:
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        sys.exit(0)
    command = (event.get("tool_input") or {}).get("command")
    if not isinstance(command, str):
        sys.exit(0)
    match = STEP_SCRIPT.search(command)
    if match is None or match.group(1) not in GUARDS:
        sys.exit(0)
    step = match.group(1)
    try:
        args = " ".join(shlex.split(match.group(2)))
    except ValueError:
        args = match.group(2).strip()
    cwd = str(event.get("cwd") or ".")
    try:
        config(main_root(cwd))
        GUARDS[step](cwd, args, f"/craftpath-{step}")
    except Refusal as reason:
        deny(str(reason))
    sys.exit(0)


if __name__ == "__main__":
    main()
