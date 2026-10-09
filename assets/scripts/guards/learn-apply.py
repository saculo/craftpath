"""Guard for /craftpath-learn-apply <work id>: KNOWLEDGE.md is complete. Nothing ticked is fine."""

from checks import check_knowledge, incomplete
from craftpath import Refusal, work_item


def check(cwd: str, args: str, command: str) -> None:
    work_id, work = work_item(args, command, cwd)
    path = work / "KNOWLEDGE.md"
    if not path.exists():
        raise Refusal(f"There is no KNOWLEDGE.md yet -- run /craftpath-learn {work_id} first.")
    incomplete("KNOWLEDGE.md", check_knowledge(work))

