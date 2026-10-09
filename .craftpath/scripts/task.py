"""`task.py <work id> --wave <n> "<title>"`: add a task to the plan.

Numbers the task (T-0001, ... per work item), writes tasks/T-xxxx.md from the
template, and lists it in PLAN.md under its wave. The agent then fills the
task file in.
"""

import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from craftpath import Refusal, from_template, work_item  # noqa: E402

TASK_LINE = re.compile(r"^- \[( |x)\] (T-\d{4}) — ")


def add_to_plan(plan: Path, task_id: str, wave: int, title: str) -> None:
    text = plan.read_text()
    start = text.index("## Tasks")
    rest = text[start + len("## Tasks") :]
    following = re.search(r"^## ", rest, re.M)
    body = rest[: following.start()] if following else rest
    after = rest[following.start() :] if following else ""

    preface: list[str] = []  # a guidance comment, kept in place
    waves: dict[int, list[str]] = {}
    current = None
    for line in body.splitlines():
        heading = re.match(r"^### Wave (\d+)\s*$", line)
        if heading:
            current = int(heading.group(1))
            waves.setdefault(current, [])
        elif TASK_LINE.match(line) and current is not None:
            waves[current].append(line)
        elif current is None and line.strip():
            preface.append(line)
    waves.setdefault(wave, []).append(f"- [ ] {task_id} — {title}")

    lines = ["## Tasks", ""]
    if preface:
        lines += [*preface, ""]
    for number in sorted(waves):
        lines += [f"### Wave {number}", "", *waves[number], ""]
    tasks = "\n".join(lines)
    plan.write_text(text[:start] + tasks + ("\n" + after if after else ""))


def main(argv: list[str]) -> None:
    if "--wave" not in argv or argv.index("--wave") + 1 >= len(argv):
        raise Refusal('usage: task.py <work id> --wave <n> "<title>"')
    i = argv.index("--wave")
    wave_arg = argv[i + 1]
    rest = argv[:i] + argv[i + 2 :]
    if not wave_arg.isdigit() or int(wave_arg) < 1 or len(rest) < 2:
        raise Refusal('usage: task.py <work id> --wave <n> "<title>"  (n is 1, 2, ...)')
    work_id, work = work_item(rest[0], "task.py")
    title = " ".join(rest[1:]).strip()
    plan = work / "PLAN.md"
    if not plan.exists():
        raise Refusal(f"{work_id} has no PLAN.md yet -- run the plan command first.")

    tasks = work / "tasks"
    tasks.mkdir(exist_ok=True)
    numbers = [int(f.stem[2:]) for f in tasks.glob("T-*.md") if f.stem[2:].isdigit()]
    task_id = f"T-{max(numbers, default=0) + 1:04d}"
    file = tasks / f"{task_id}.md"
    file.write_text(
        from_template(work, "TASK.md", {"ID": work_id, "TASK": task_id, "TITLE": title, "WAVE": wave_arg})
    )
    add_to_plan(plan, task_id, int(wave_arg), title)
    print(f"{task_id} (wave {wave_arg}): {file}")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
