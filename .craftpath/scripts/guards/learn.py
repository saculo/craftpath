"""Guard for /craftpath-learn <work id>: the review has no open point."""

from checks import review_closed
from craftpath import work_item


def check(cwd: str, args: str, invoked: str) -> None:
    work_id, work = work_item(args, invoked, cwd)
    review_closed(work, work_id)
