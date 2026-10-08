"""Guard for craftpath's steps: a PreToolUse hook on shell commands.

Every step starts by running its script (`python3 .craftpath/scripts/plan.py
C-00001`). Claude Code's PreToolUse hook -- and on pi the Claude-compatible
hooks extension -- hand this guard that tool call first. When the command runs
a step's script, the step's own guard, `guards/<step>.py`, checks the step may
start, and a refusal is answered with the JSON both harnesses read. A script
with no guard file, and any other command, passes straight through.

Adding a guard for a step is one file: `guards/<step>.py` with
`check(cwd, args, command)` that raises `Refusal` with the reason.
"""

import importlib.util
import json
import re
import shlex
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from craftpath import Refusal, config, main_root  # noqa: E402

# A step's script, as the agent runs it: `python3 .craftpath/scripts/plan.py C-00001`.
STEP_SCRIPT = re.compile(
    r"(?:^|[\s;&|(])(?:\S*/)?python3?\s+(?:\S*/)?\.craftpath/scripts/([a-z-]+)\.py\b([^;&|\n]*)"
)


def guard_for(step: str):
    """The `check` from guards/<step>.py, or None when the step has no guard."""
    path = HERE / "guards" / f"{step}.py"
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(f"craftpath_guard_{step}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.check


def deny(reason: str) -> None:
    """The PreToolUse refusal both Claude Code and the pi hooks extension read."""
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
    if match is None:
        sys.exit(0)
    step = match.group(1)
    check = guard_for(step)
    if check is None:
        sys.exit(0)
    try:
        args = " ".join(shlex.split(match.group(2)))
    except ValueError:
        args = match.group(2).strip()
    cwd = str(event.get("cwd") or ".")
    try:
        config(main_root(cwd))
        check(cwd, args, f"/craftpath-{step}")
    except Refusal as reason:
        deny(str(reason))
    sys.exit(0)


if __name__ == "__main__":
    main()
