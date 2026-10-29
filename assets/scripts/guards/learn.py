"""Guard for /craftpath-learn <work id>: the verification has no open point."""

from checks import verify_closed
from craftpath import work_item


def check(cwd: str, args: str, invoked: str) -> None:
    work_id, work = work_item(args, invoked, cwd)
    verify_closed(work, work_id)
