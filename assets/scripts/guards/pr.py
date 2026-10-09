"""Guard for /craftpath-pr <work id>: the review has no open point and saw the code proposed."""

from checks import FIELD, review_closed
from craftpath import KNOWLEDGE_PATHS, Refusal, git, uncommitted_outside, work_item


def check(cwd: str, args: str, command: str) -> None:
    work_id, work = work_item(args, command, cwd)
    text = review_closed(work, work_id)
    root = work.parents[2]
    reviewed = dict(FIELD.findall(text))["Reviewed at"].strip()
    # Not code: the work item's own files, and what /craftpath-learn-apply writes.
    skip = [f":(exclude){path}" for path in (work.relative_to(root), *KNOWLEDGE_PATHS)]
    changed = git("log", "--format=%h %s", f"{reviewed}..HEAD", "--", ".", *skip, cwd=root)
    if changed:
        listed = "\n".join(f"- {line}" for line in changed.splitlines())
        raise Refusal(f"The code changed after the review -- run /craftpath-review {work_id} again:\n{listed}")
    dirty = uncommitted_outside(root, work)
    if dirty:
        listed = "\n".join(f"- {path}" for path in dirty)
        raise Refusal(f"Commit or discard these changes first -- the review did not see them:\n{listed}")
