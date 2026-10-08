"""Guard for /craftpath-design <work id>: the spec is complete."""

from checks import check_spec, incomplete
from craftpath import work_item


def check(cwd: str, args: str, command: str) -> None:
    _, work = work_item(args, command, cwd)
    incomplete("SPEC.md", check_spec(work))
