"""Guard for /craftpath-plan <work id>: the spec is complete, and the design if there is one."""

from checks import check_design, check_spec, incomplete
from craftpath import work_item


def check(cwd: str, args: str, command: str) -> None:
    _, work = work_item(args, command, cwd)
    incomplete("SPEC.md", check_spec(work))
    if (work / "DESIGN.md").exists():
        incomplete("DESIGN.md", check_design(work))
