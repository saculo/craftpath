"""`/craftpath-learn <work id>`: create or reuse KNOWLEDGE.md, and say what to learn from.

Runs after the guard has found the review without open points. Creates
KNOWLEDGE.md from the template, or keeps the existing one with all its
candidates, and prints the sources to read, the existing ADRs and instruction
files, and the next free candidate id.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import candidates  # noqa: E402
from craftpath import ADR_DIR, INSTRUCTION_FILES, Refusal, from_template, title_of, work_item  # noqa: E402


def main(args: str) -> None:
    work_id, work = work_item(args, "/craftpath-learn")
    root = work.parents[2]
    path = work / "KNOWLEDGE.md"
    if path.exists():
        state = "already exists -- keep its candidates, add new ones"
    else:
        path.write_text(from_template(work, "KNOWLEDGE.md", {"ID": work_id, "TITLE": title_of(work)}))
        state = "created"

    print(f"Work item {work_id}: {title_of(work)}")
    print(f"  knowledge: {path} ({state})")
    print("Learn from:")
    for name in ("SPEC.md", "DESIGN.md"):
        if (work / name).exists():
            print(f"  {work / name}")
    for task in sorted((work / "tasks").glob("T-*.md")):
        print(f"  {task}")
    print(f"  {work / 'REVIEW.md'}")
    adrs = sorted((root / ADR_DIR).glob("ADR-*.md")) if (root / ADR_DIR).exists() else []
    print("Existing ADRs:" if adrs else f"Existing ADRs: none ({ADR_DIR}/)")
    for adr in adrs:
        print(f"  {adr}")
    files = [name for name in INSTRUCTION_FILES if (root / name).exists()]
    print(f"Instruction files: {', '.join(files) if files else 'none yet'}")
    found, _ = candidates(path.read_text())
    highest = max((int(c["id"][1:]) for c in found), default=0)
    print(f"next candidate: K{highest + 1}")


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
