"""`check.py <spec|design|plan> <work id>`: is the step's file complete?

Prints what is missing and exits 1, or says it is complete and exits 0. The
guards apply the same checks before the next step runs.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import CHECKS  # noqa: E402
from craftpath import Refusal, work_item  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in CHECKS:
        print(f"usage: check.py <{'|'.join(CHECKS)}> <work id>", file=sys.stderr)
        return 2
    name, check = CHECKS[argv[0]]
    try:
        _, work = work_item(argv[1], "check.py " + argv[0])
    except Refusal as reason:
        print(reason, file=sys.stderr)
        return 2
    if not (work / name).exists():
        print(f"{name} does not exist yet.")
        return 1
    problems = check(work)
    if problems:
        print(f"{name} is not complete:")
        for problem in problems:
            print(f"- {problem}")
        return 1
    print(f"{name} is complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
