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


def refuse(message: str) -> None:
    """Exit 2 with the message on stderr: the code both harnesses read as a refusal."""
    print(message, file=sys.stderr)
    sys.exit(2)
