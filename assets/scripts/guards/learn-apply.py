"""Guard for /craftpath-learn-apply <work id>: KNOWLEDGE.md is complete. Nothing ticked is fine."""

from checks import check_knowledge, incomplete
from craftpath import Refusal, command, work_item


def check(cwd: str, args: str, invoked: str) -> None:
    work_id, work = work_item(args, invoked, cwd)
    path = work / "KNOWLEDGE.md"
    if not path.exists():
        raise Refusal(f"There is no KNOWLEDGE.md yet -- run {command('learn')} {work_id} first.")
    incomplete("KNOWLEDGE.md", check_knowledge(work))

