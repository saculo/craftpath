"""`/craftpath:design <work id>`: create DESIGN.md for an optional design.

Runs after the guard has found SPEC.md complete. An existing DESIGN.md is left
as it is, for the agent to revise.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from craftpath import Refusal, from_template, title_of, work_item  # noqa: E402


def main(args: str) -> None:
    work_id, work = work_item(args, "/craftpath:design")
    design = work / "DESIGN.md"
    print(f"Work item {work_id}: {title_of(work)}")
    print(f"  spec:   {work / 'SPEC.md'}")
    if design.exists():
        print(f"  design: {design} (already exists -- revise it)")
        return
    design.write_text(from_template(work, "DESIGN.md", {"ID": work_id, "TITLE": title_of(work)}))
    print(f"  design: {design}")


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
