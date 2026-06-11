"""Tests for per-worker git worktree isolation."""

import subprocess
from unittest.mock import patch

import pytest

from cli_agent_orchestrator.services import git_worktree_service

TERMINAL_ID = "abc12345"


@pytest.fixture
def repo(tmp_path):
    """A real git repo with one commit."""
    repo = tmp_path / "repo"
    repo.mkdir()
    run = lambda *args: subprocess.run(  # noqa: E731
        ["git", "-C", str(repo), *args], capture_output=True, check=True, text=True
    )
    run("init", "-b", "main")
    run("config", "user.email", "test@example.com")
    run("config", "user.name", "Test")
    (repo / "app.py").write_text("print('v1')\n")
    run("add", ".")
    run("commit", "-m", "initial")
    return repo


@pytest.fixture
def worktrees_dir(tmp_path):
    """Redirect WORKTREES_DIR into the test sandbox."""
    target = tmp_path / "worktrees"
    with patch.object(git_worktree_service, "WORKTREES_DIR", target):
        yield target


class TestIsGitRepo:
    def test_true_inside_repo(self, repo):
        assert git_worktree_service.is_git_repo(str(repo)) is True

    def test_false_outside_repo(self, tmp_path):
        plain = tmp_path / "plain"
        plain.mkdir()
        assert git_worktree_service.is_git_repo(str(plain)) is False

    def test_false_for_missing_dir(self, tmp_path):
        assert git_worktree_service.is_git_repo(str(tmp_path / "nope")) is False


class TestCreateWorktree:
    def test_creates_isolated_worktree_and_branch(self, repo, worktrees_dir):
        path, branch = git_worktree_service.create_worktree(str(repo), TERMINAL_ID, "dev-sonnet")

        assert path == str(worktrees_dir / TERMINAL_ID)
        assert branch == f"cao/dev-sonnet-{TERMINAL_ID}"
        # The worktree is a usable checkout on its own branch.
        head = subprocess.run(
            ["git", "-C", path, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
        ).stdout.strip()
        assert head == branch
        assert (worktrees_dir / TERMINAL_ID / "app.py").read_text() == "print('v1')\n"

    def test_two_workers_get_disjoint_checkouts(self, repo, worktrees_dir):
        path_a, branch_a = git_worktree_service.create_worktree(str(repo), "aaaa1111", "dev")
        path_b, branch_b = git_worktree_service.create_worktree(str(repo), "bbbb2222", "dev")
        assert path_a != path_b
        assert branch_a != branch_b
        # Edits in A are invisible in B.
        (worktrees_dir / "aaaa1111" / "app.py").write_text("print('A')\n")
        assert (worktrees_dir / "bbbb2222" / "app.py").read_text() == "print('v1')\n"

    def test_profile_name_is_sanitized_for_branch(self, repo, worktrees_dir):
        _, branch = git_worktree_service.create_worktree(str(repo), TERMINAL_ID, "weird name!?")
        assert branch == f"cao/weird-name--{TERMINAL_ID}"

    def test_failure_raises_runtime_error(self, tmp_path, worktrees_dir):
        plain = tmp_path / "plain"
        plain.mkdir()
        with pytest.raises(RuntimeError):
            git_worktree_service.create_worktree(str(plain), TERMINAL_ID, "dev")


class TestRemoveWorktree:
    def test_removes_worktree_but_keeps_branch(self, repo, worktrees_dir):
        path, branch = git_worktree_service.create_worktree(str(repo), TERMINAL_ID, "dev")

        assert git_worktree_service.remove_worktree(TERMINAL_ID) is True
        assert not (worktrees_dir / TERMINAL_ID).exists()
        branches = subprocess.run(
            ["git", "-C", str(repo), "branch", "--list", branch],
            capture_output=True,
            text=True,
        ).stdout
        assert branch in branches  # unmerged work survives

    def test_removes_dirty_worktree(self, repo, worktrees_dir):
        path, _ = git_worktree_service.create_worktree(str(repo), TERMINAL_ID, "dev")
        (worktrees_dir / TERMINAL_ID / "app.py").write_text("uncommitted edit\n")

        assert git_worktree_service.remove_worktree(TERMINAL_ID) is True
        assert not (worktrees_dir / TERMINAL_ID).exists()

    def test_no_worktree_returns_false(self, worktrees_dir):
        assert git_worktree_service.remove_worktree("eeee9999") is False


class TestCreateTerminalIntegration:
    @pytest.mark.asyncio
    async def test_worker_cwd_is_replaced_by_worktree_when_enabled(self, repo, worktrees_dir):
        """create_terminal swaps a git-repo working_directory for a fresh worktree."""
        from cli_agent_orchestrator.services import terminal_service

        captured = {}

        def fake_create_window(session, window, tid, working_directory, extra_env=None):
            captured["working_directory"] = working_directory
            return window

        with (
            patch.object(terminal_service, "ENABLE_GIT_WORKTREE", True),
            patch("cli_agent_orchestrator.services.terminal_service.get_backend") as mock_backend,
            patch("cli_agent_orchestrator.services.terminal_service._enforce_worker_cap"),
            patch("cli_agent_orchestrator.services.terminal_service.get_session_env"),
            patch(
                "cli_agent_orchestrator.services.terminal_service.generate_terminal_id",
                return_value=TERMINAL_ID,
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                side_effect=FileNotFoundError,
            ),
        ):
            mock_backend.return_value.session_exists.return_value = True
            mock_backend.return_value.create_window.side_effect = fake_create_window
            # Provider init will fail fast after window creation; the worktree
            # decision has already been captured by then.
            try:
                await terminal_service.create_terminal(
                    "claude_code",
                    "developer",
                    session_name="cao-test",
                    new_session=False,
                    working_directory=str(repo),
                )
            except Exception:
                pass

        assert captured["working_directory"] == str(worktrees_dir / TERMINAL_ID)

    @pytest.mark.asyncio
    async def test_kimi_workers_keep_shared_directory(self, repo, worktrees_dir):
        """kimi_cli runs in its own temp dir; no worktree is provisioned."""
        from cli_agent_orchestrator.services import terminal_service

        captured = {}

        def fake_create_window(session, window, tid, working_directory, extra_env=None):
            captured["working_directory"] = working_directory
            return window

        with (
            patch.object(terminal_service, "ENABLE_GIT_WORKTREE", True),
            patch("cli_agent_orchestrator.services.terminal_service.get_backend") as mock_backend,
            patch("cli_agent_orchestrator.services.terminal_service._enforce_worker_cap"),
            patch("cli_agent_orchestrator.services.terminal_service.get_session_env"),
            patch(
                "cli_agent_orchestrator.services.terminal_service.generate_terminal_id",
                return_value="ffff0000",
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                side_effect=FileNotFoundError,
            ),
        ):
            mock_backend.return_value.session_exists.return_value = True
            mock_backend.return_value.create_window.side_effect = fake_create_window
            try:
                await terminal_service.create_terminal(
                    "kimi_cli",
                    "developer",
                    session_name="cao-test",
                    new_session=False,
                    working_directory=str(repo),
                )
            except Exception:
                pass

        assert captured["working_directory"] == str(repo)
        assert not (worktrees_dir / "ffff0000").exists()
