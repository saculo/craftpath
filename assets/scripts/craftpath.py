"""Shared helpers for craftpath's step scripts. Standard library only.

Every script works from anywhere in the repository -- the main checkout or a
work item's worktree -- because each is resolved through git.
"""

import re
import subprocess
import sys
import tomllib
import unicodedata
from pathlib import Path


# How the user runs a step, written in by `craftpath init` for the harnesses it
# installed: "/craftpath-{step}" on Claude Code, "/skill:craftpath-{step}" on pi.
COMMANDS = "{{COMMANDS}}"


def command(step: str) -> str:
    """How the user runs `step`, for example /craftpath-review."""
    return COMMANDS.replace("{step}", step)


class Refusal(Exception):
    """A reason to stop, for the user."""


def git(*args: str, cwd: Path | str = ".", check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise Refusal(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def git_ok(*args: str, cwd: Path | str = ".") -> bool:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True).returncode == 0


def main_root(cwd: Path | str = ".") -> Path:
    """The main checkout, also when called from inside a worktree."""
    if not git_ok("rev-parse", "--git-dir", cwd=cwd):
        raise Refusal("This is not a git repository. Run `craftpath init` in one.")
    common = git("rev-parse", "--path-format=absolute", "--git-common-dir", cwd=cwd)
    return Path(common).parent


def config(root: Path) -> dict:
    path = root / ".craftpath" / "config.toml"
    if not path.exists():
        raise Refusal("craftpath is not initialised here: run `craftpath init` first.")
    try:
        return tomllib.loads(path.read_text())
    except tomllib.TOMLDecodeError as error:
        raise Refusal(f".craftpath/config.toml is not valid TOML: {error}") from error


def base_branch(cfg: dict) -> str:
    return cfg.get("git", {}).get("base_branch", "main")


def worktrees_dir(root: Path) -> Path:
    """Work item worktrees live next to the repository: `<repo>.craftpath/`."""
    return root.parent / f"{root.name}.craftpath"


WORK_ID = re.compile(r"C-(\d{5})")


def next_id(root: Path) -> str:
    """One more than the highest C- number in any branch, worktree or commit message."""
    seen = "\n".join(
        [
            git("for-each-ref", "--format=%(refname)", cwd=root),
            git("worktree", "list", "--porcelain", cwd=root),
            git("log", "--all", "--format=%s", cwd=root, check=False),
        ]
    )
    highest = max((int(n) for n in WORK_ID.findall(seen)), default=0)
    return f"C-{highest + 1:05d}"


def slugify(title: str) -> str:
    text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return slug[:48].rstrip("-") or "work"


class TestsFailed(Exception):
    """A module's tests failed; the output has been printed."""


def run_tests(root: Path, modules: list[str], paths: dict[str, str]) -> None:
    """Run each module's `test` command in its directory, stopping at the first red one."""
    commands = config(root).get("modules", {})
    for module in modules:
        command = commands[module].get("test", "")
        if not command:
            raise Refusal(f"Module {module} has no test command -- set it in .craftpath/config.toml")
        print(f"{module}: {command}")
        result = subprocess.run(command, shell=True, cwd=root / paths[module], capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stdout + result.stderr)
            raise TestsFailed(f"{module}'s tests failed (exit {result.returncode}).")


# Where /craftpath-learn-apply writes: decisions, and lines for agents.
ADR_DIR = "docs/adr"
INSTRUCTION_FILES = ("CLAUDE.md", "AGENTS.md")
KNOWLEDGE_PATHS = (ADR_DIR, *INSTRUCTION_FILES)


def branch_base(root: Path) -> str:
    """Where the work item's branch left the base branch."""
    return git("merge-base", base_branch(config(root)), "HEAD", cwd=root)


def uncommitted_outside(root: Path, work: Path) -> list[str]:
    """Uncommitted files of the worktree, other than the work item's own."""
    own = str(work.relative_to(root)) + "/"
    status = git("status", "--porcelain", "--untracked-files=all", cwd=root)
    paths = [line[3:] for line in status.splitlines() if line.strip()]
    return [path for path in paths if not path.startswith(own)]


def refuse(message: str) -> None:
    """Exit 2 with the message on stderr: the code both harnesses read as a refusal."""
    print(message, file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------------------
# Work items
# ---------------------------------------------------------------------------

WORK_ID_ARG = re.compile(r"^C-\d{5}$")


def open_work(root: Path) -> dict[str, Path]:
    """Work item id -> its worktree, for every worktree on a craftpath/C-... branch."""
    found: dict[str, Path] = {}
    path: Path | None = None
    for line in git("worktree", "list", "--porcelain", cwd=root).splitlines():
        if line.startswith("worktree "):
            path = Path(line[len("worktree ") :])
        elif line.startswith("branch refs/heads/craftpath/") and path is not None:
            match = WORK_ID.match(line[len("branch refs/heads/craftpath/") :])
            if match:
                found[match.group(0)] = path
    return found


def work_item(args: str, command: str, cwd: Path | str = ".") -> tuple[str, Path]:
    """The work id named first in a command's arguments, and its work directory."""
    words = args.split()
    if not words or not WORK_ID_ARG.match(words[0]):
        raise Refusal(f"Name the work item: {command} <work id>, for example {command} C-00001")
    work_id = words[0]
    items = open_work(main_root(cwd))
    if work_id not in items:
        listed = ", ".join(sorted(items)) or "none -- start one with the spec command"
        raise Refusal(f"{work_id} is not an open work item. Open work items: {listed}")
    return work_id, items[work_id] / ".craftpath" / "work" / work_id


def title_of(work: Path) -> str:
    """The title from SPEC.md's first line: `# C-00001 — <title>`."""
    first = (work / "SPEC.md").read_text().splitlines()[0]
    return first.split("—", 1)[1].strip() if "—" in first else first.lstrip("# ").strip()


def from_template(work: Path, name: str, values: dict[str, str]) -> str:
    """A template from the work item's worktree, with {{KEY}} values filled in."""
    text = (work.parents[2] / ".craftpath" / "templates" / name).read_text()
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text


def commit_files(work: Path, work_id: str, what: str, files: list[Path]) -> str | None:
    """Commit a step's files as `docs(<work id>): add <what>`, when any is uncommitted.

    Each step commits the file of the step before it, once its guard has
    passed: until then the user may still edit it. Only these files go in.
    Returns the commit as `<short sha> <subject>`, or None when nothing changed.
    """
    root = work.parents[2]
    paths = [str(f.relative_to(root)) for f in files if f.exists()]
    if not paths or not git("status", "--porcelain", "--", *paths, cwd=root):
        return None
    git("add", "--", *paths, cwd=root)
    git("commit", "-q", "-m", f"docs({work_id}): add {what}", "--", *paths, cwd=root)
    return git("log", "-1", "--format=%h %s", cwd=root)
