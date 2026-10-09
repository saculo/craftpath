"""`/craftpath-learn-apply <work id>`: write the ticked knowledge candidates, then commit them.

Runs after the guard has found KNOWLEDGE.md complete. An [ADR] becomes
docs/adr/ADR-<n>.md from the template, numbered one past the highest there;
a [CLAUDE.md] or [AGENTS.md] line is appended under that file's `## Learned`
section. Each is marked `(applied: <path>)` and never applied again; the
files written and KNOWLEDGE.md are committed as `docs(<work id>): add
knowledge`, and the commit is printed. With nothing ticked, nothing is
applied and KNOWLEDGE.md is still committed: it records what was not kept.
"""

import datetime
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import pending  # noqa: E402
from craftpath import ADR_DIR, Refusal, commit_files, from_template, work_item  # noqa: E402

def write_adr(root: Path, work: Path, work_id: str, candidate: dict) -> Path:
    folder = root / ADR_DIR
    folder.mkdir(parents=True, exist_ok=True)
    numbers = [int(m.group(1)) for f in folder.glob("ADR-*.md") if (m := re.match(r"ADR-(\d+)", f.name))]
    number = f"{max(numbers, default=0) + 1:04d}"
    fields = candidate["fields"]
    source = f"{work_id} {candidate['id']}" + (f" -- {fields['Source']}" if fields.get("Source") else "")
    path = folder / f"ADR-{number}.md"
    path.write_text(
        from_template(
            work,
            "ADR.md",
            {
                "NUMBER": number,
                "TITLE": candidate["title"],
                "DATE": datetime.date.today().isoformat(),
                "SOURCE": source,
                "CONTEXT": fields["Context"],
                "DECISION": fields["Decision"],
                "CONSEQUENCES": fields["Consequences"],
            },
        )
    )
    return path


def append_line(path: Path, line: str) -> Path:
    """Add `- <line>` at the end of the `## Learned` section, adding the section when missing."""
    entry = f"- {line}\n"
    text = path.read_text() if path.exists() else ""
    heading = re.search(r"^## Learned[ \t]*$", text, re.M)
    if heading is None:
        body = text.rstrip("\n")
        path.write_text(f"{body}\n\n## Learned\n\n{entry}" if body else f"## Learned\n\n{entry}")
        return path
    after = re.search(r"^## ", text[heading.end() :], re.M)
    end = heading.end() + after.start() if after else len(text)
    section = text[:end].rstrip("\n") + "\n" + entry
    rest = text[end:]
    path.write_text(section + ("\n" + rest if rest else ""))
    return path


def main(args: str) -> None:
    work_id, work = work_item(args, "/craftpath-learn-apply")
    root = work.parents[2]
    knowledge = work / "KNOWLEDGE.md"
    text = knowledge.read_text()
    written: list[Path] = []
    todo = pending(text)
    if not todo:
        print("Nothing to apply: no ticked candidate is waiting.")
    for candidate in todo:
        if candidate["target"] == "ADR":
            path = write_adr(root, work, work_id, candidate)
        else:
            path = append_line(root / candidate["target"], candidate["title"])
        written.append(path)
        relative = path.relative_to(root)
        text = text.replace(candidate["line"] + "\n", f"{candidate['line']} (applied: {relative})\n", 1)
        print(f"{candidate['id']} applied: {relative}")
    knowledge.write_text(text)
    commit = commit_files(work, work_id, "knowledge", [*written, knowledge])
    print(f"Committed: {commit}" if commit else "Nothing to commit: KNOWLEDGE.md is already committed.")


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
