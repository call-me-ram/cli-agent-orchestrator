"""Tests for the file/git-based worker result contract (get_result)."""

import json
import subprocess
from unittest.mock import patch

import pytest

from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.services import terminal_service

TERMINAL_ID = "abc12345"


@pytest.fixture
def git_repo(tmp_path):
    """A real git repo with one committed file."""
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


def _patch_cwd(path):
    return patch(
        "cli_agent_orchestrator.services.terminal_service.get_working_directory",
        return_value=str(path) if path is not None else None,
    )


def _patch_status(value=TerminalStatus.COMPLETED):
    return patch(
        "cli_agent_orchestrator.services.terminal_service.status_monitor.get_status",
        return_value=value,
    )


class TestGetResult:
    def test_dirty_repo_reports_branch_files_and_diff(self, git_repo):
        (git_repo / "app.py").write_text("print('v2')\n")
        (git_repo / "new_module.py").write_text("x = 1\n")

        with _patch_cwd(git_repo), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)

        assert result["is_git_repo"] is True
        assert result["branch"] == "main"
        states = {f["path"]: f["state"] for f in result["files_changed"]}
        assert states["app.py"] == "M"
        assert states["new_module.py"] == "??"
        assert "-print('v1')" in result["git_diff"]
        assert "+print('v2')" in result["git_diff"]
        assert result["git_diff_truncated"] is False
        assert "app.py" in result["git_diff_stat"]
        assert result["status"] == "completed"

    def test_clean_repo_reports_empty_changes(self, git_repo):
        with _patch_cwd(git_repo), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)
        assert result["is_git_repo"] is True
        assert result["files_changed"] == []
        assert result["git_diff"] == ""

    def test_namespaced_manifest_is_read_in_shared_directory(self, git_repo):
        """In a shared directory only the per-terminal manifest is trusted."""
        manifest = {"summary": "implemented foo()", "status": "done"}
        cao_dir = git_repo / ".cao"
        cao_dir.mkdir()
        (cao_dir / f"result-{TERMINAL_ID}.json").write_text(json.dumps(manifest))
        (cao_dir / "result.json").write_text(json.dumps({"summary": "someone else's"}))

        with _patch_cwd(git_repo), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)
        assert result["manifest"] == manifest
        assert result["shared_working_directory"] is True

    def test_generic_manifest_ignored_in_shared_directory(self, git_repo):
        """A bare result.json could be another worker's — ignored when shared."""
        cao_dir = git_repo / ".cao"
        cao_dir.mkdir()
        (cao_dir / "result.json").write_text(json.dumps({"summary": "ambiguous"}))

        with _patch_cwd(git_repo), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)
        assert result["manifest"] is None

    def test_untracked_file_content_is_included(self, git_repo):
        """New modules (untracked) must be reviewable, not just listed as ??."""
        (git_repo / "brand_new.py").write_text("def fresh(): return 42\n")

        with _patch_cwd(git_repo), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)
        assert result["untracked_files"] == [
            {"path": "brand_new.py", "content": "def fresh(): return 42\n"}
        ]

    def test_non_git_directory_degrades_gracefully(self, tmp_path):
        with _patch_cwd(tmp_path), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)
        assert result["is_git_repo"] is False
        assert result["branch"] is None
        assert result["git_diff"] is None
        assert result["files_changed"] == []

    def test_no_working_directory_returns_minimal_result(self):
        with _patch_cwd(None), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)
        assert result["working_directory"] is None
        assert result["is_git_repo"] is False

    def test_oversized_diff_is_truncated(self, git_repo):
        (git_repo / "big.py").write_text("")
        subprocess.run(["git", "-C", str(git_repo), "add", "."], check=True)
        subprocess.run(
            ["git", "-C", str(git_repo), "commit", "-m", "add big"],
            check=True,
            capture_output=True,
        )
        (git_repo / "big.py").write_text("x = 'a'\n" * 50_000)

        with _patch_cwd(git_repo), _patch_status():
            result = terminal_service.get_result(TERMINAL_ID)
        assert result["git_diff_truncated"] is True
        assert len(result["git_diff"]) == terminal_service.GIT_DIFF_MAX_CHARS

    def test_unknown_terminal_raises(self):
        with patch(
            "cli_agent_orchestrator.services.terminal_service.get_working_directory",
            side_effect=ValueError("Terminal 'abc12345' not found"),
        ):
            with pytest.raises(ValueError):
                terminal_service.get_result(TERMINAL_ID)


class TestResultEndpoint:
    def test_endpoint_returns_result(self, git_repo, monkeypatch):
        from fastapi.testclient import TestClient

        from cli_agent_orchestrator.api.main import app
        from cli_agent_orchestrator.plugins import PluginRegistry

        with _patch_cwd(git_repo), _patch_status():
            app.state.plugin_registry = PluginRegistry()
            client = TestClient(app)
            resp = client.get(f"/terminals/{TERMINAL_ID}/result", headers={"Host": "localhost"})
        assert resp.status_code == 200
        assert resp.json()["is_git_repo"] is True

    def test_endpoint_404_for_unknown_terminal(self):
        from fastapi.testclient import TestClient

        from cli_agent_orchestrator.api.main import app
        from cli_agent_orchestrator.plugins import PluginRegistry

        with patch(
            "cli_agent_orchestrator.services.terminal_service.get_working_directory",
            side_effect=ValueError("Terminal 'abc12345' not found"),
        ):
            app.state.plugin_registry = PluginRegistry()
            client = TestClient(app)
            resp = client.get(f"/terminals/{TERMINAL_ID}/result", headers={"Host": "localhost"})
        assert resp.status_code == 404
