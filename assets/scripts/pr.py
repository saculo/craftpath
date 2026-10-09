"""`/craftpath-pr <work id>`: commit the review, push the branch, open the pull request.

Runs after the guard has found the review without open points and up to date
with the code. Commits REVIEW.md, pushes the work item's branch to origin, and
opens a pull request into the base branch with `gh`: the title from the spec
and the tasks' types, the body built from SPEC.md, PLAN.md and REVIEW.md. When
the branch already has a pull request, the push has updated it and nothing
else is done.
"""

import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import COMMENT, FIELD, candidates, plan_tasks, review_points, sections  # noqa: E402
from craftpath import Refusal, base_branch, branch_base, commit_files, config, git, title_of, work_item  # noqa: E402


def gh(root: Path, *args: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["gh", *args], cwd=root, capture_output=True, text=True)
    except FileNotFoundError as missing:
        raise Refusal("gh is not installed -- install the GitHub CLI, then run gh auth login") from missing


def title(work: Path, work_id: str, tasks: list[str]) -> str:
    """`<type>(<work id>): <spec title>`: feat if any task is, else fix if any is, else the first task's."""
    types = [dict(FIELD.findall(COMMENT.sub("", (work / "tasks" / f"{t}.md").read_text()))).get("Type", "").strip() for t in tasks]
    kind = next((k for k in ("feat", "fix") if k in types), types[0] if types else "feat")
    return f"{kind}({work_id}): {title_of(work)}"


def body(root: Path, work: Path, work_id: str, tasks: list[str]) -> str:
    spec = sections(COMMENT.sub("", (work / "SPEC.md").read_text()))
    scenarios = [f"- {name}" for name in sections(spec.get("Scenarios", ""), "### ")]
    since = f"{branch_base(root)}..HEAD"
    commits = []
    for task in tasks:
        found = git("log", "--reverse", "--format=%h %s", "--fixed-strings", f"--grep=({work_id}/{task})", since, cwd=root)
        commits += [f"- {line}" for line in found.splitlines()]
    points = [line for _, _, line in review_points((work / "REVIEW.md").read_text())]
    knowledge = work / "KNOWLEDGE.md"
    applied = [c["line"].removeprefix("- [x] ") for c in candidates(knowledge.read_text())[0] if c["applied"]] if knowledge.exists() else []
    parts = [
        ("Problem", spec.get("Problem", "").strip()),
        ("Scenarios", "\n".join(scenarios)),
        ("Tasks", "\n".join(commits)),
        ("Review", "\n".join(points) or "No points."),
        *([("Knowledge", "\n".join(f"- {line}" for line in applied))] if applied else []),
        ("Out of scope", spec.get("Out of scope", "").strip()),
    ]
    return "\n\n".join(f"## {name}\n\n{text}" for name, text in parts) + "\n"


def main(args: str) -> None:
    work_id, work = work_item(args, "/craftpath-pr")
    root = work.parents[2]
    commit_files(work, work_id, "review", [work / "REVIEW.md"])
    branch = git("rev-parse", "--abbrev-ref", "HEAD", cwd=root)
    git("push", "-q", "-u", "origin", branch, cwd=root)
    print(f"Pushed {branch} to origin.")

    existing = gh(root, "pr", "view", branch, "--json", "url", "-q", ".url")
    if existing.returncode == 0 and existing.stdout.strip():
        print(f"The pull request was already open; it now has the new commits: {existing.stdout.strip()}")
        return

    tasks = [tid for tid, _, _ in plan_tasks((work / "PLAN.md").read_text())]
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as file:
        file.write(body(root, work, work_id, tasks))
    try:
        created = gh(
            root, "pr", "create", "--base", base_branch(config(root)), "--head", branch,
            "--title", title(work, work_id, tasks), "--body-file", file.name,
        )
    finally:
        Path(file.name).unlink()
    if created.returncode != 0:
        raise Refusal(f"gh pr create failed: {created.stderr.strip()}")
    print(f"Opened the pull request: {created.stdout.strip()}")


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
