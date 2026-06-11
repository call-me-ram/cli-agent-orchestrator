"""Per-worker git worktree isolation.

Gives each orchestrated worker its own git worktree and branch so parallel
workers editing the same repository can never collide on files. Prompt-only
guidance cannot guarantee that; isolation has to be structural.

Layout convention (no DB schema needed):
    <WORKTREES_DIR>/<terminal_id>     ← the worker's worktree
    branch: cao/<profile>-<terminal_id>

create_worktree() runs at terminal creation; remove_worktree() at deletion
resolves the main repository from the worktree itself, removes the worktree,
and deliberately KEEPS the branch — unmerged work must survive worker cleanup
so the orchestrator can still review or merge it.
"""

import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple

from cli_agent_orchestrator.constants import WORKTREES_DIR

logger = logging.getLogger(__name__)

_BRANCH_SAFE = re.compile(r"[^A-Za-z0-9_\-]+")


def _run_git(cwd: str, *args: str, timeout: float = 60.0) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", cwd, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def is_git_repo(path: str) -> bool:
    """True if ``path`` is inside a git work tree."""
    try:
        proc = _run_git(path, "rev-parse", "--is-inside-work-tree", timeout=15.0)
    except Exception:
        return False
    return proc.returncode == 0 and proc.stdout.strip() == "true"


def create_worktree(repo_path: str, terminal_id: str, agent_profile: str) -> Tuple[str, str]:
    """Create an isolated worktree + branch for a worker terminal.

    Args:
        repo_path: A directory inside the repository to branch from (HEAD).
        terminal_id: The worker's terminal ID (names the worktree dir/branch).
        agent_profile: Used in the branch name for human readability.

    Returns:
        (worktree_path, branch_name)

    Raises:
        RuntimeError: If git cannot create the worktree.
    """
    WORKTREES_DIR.mkdir(parents=True, exist_ok=True)
    worktree_path = WORKTREES_DIR / terminal_id
    safe_profile = _BRANCH_SAFE.sub("-", agent_profile)[:40] or "worker"
    branch = f"cao/{safe_profile}-{terminal_id}"

    proc = _run_git(repo_path, "worktree", "add", "-b", branch, str(worktree_path), "HEAD")
    if proc.returncode != 0:
        raise RuntimeError(
            f"git worktree add failed for {terminal_id}: {proc.stderr.strip() or proc.stdout}"
        )
    logger.info(f"Created worktree {worktree_path} on branch {branch} for {terminal_id}")
    return str(worktree_path), branch


def remove_worktree(terminal_id: str) -> bool:
    """Remove a worker's worktree if one exists; keep its branch.

    Returns True if a worktree was found and removed (or force-cleaned).
    """
    worktree_path = WORKTREES_DIR / terminal_id
    if not worktree_path.exists():
        return False

    main_repo = _main_repo_for(worktree_path)
    if main_repo:
        proc = _run_git(main_repo, "worktree", "remove", "--force", str(worktree_path))
        if proc.returncode == 0:
            logger.info(f"Removed worktree {worktree_path}")
            return True
        logger.warning(
            f"git worktree remove failed for {terminal_id} "
            f"({proc.stderr.strip()}); force-deleting directory"
        )

    shutil.rmtree(worktree_path, ignore_errors=True)
    if main_repo:
        _run_git(main_repo, "worktree", "prune")
    logger.info(f"Force-removed worktree {worktree_path}")
    return True


def _main_repo_for(worktree_path: Path) -> Optional[str]:
    """Resolve the main repository directory a worktree belongs to."""
    try:
        proc = _run_git(
            str(worktree_path),
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
            timeout=15.0,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    common_dir = Path(proc.stdout.strip())
    # <main-repo>/.git → <main-repo>
    return str(common_dir.parent) if common_dir.name == ".git" else None
