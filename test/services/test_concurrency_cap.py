"""Tests for the orchestration worker concurrency cap."""

from unittest.mock import MagicMock, patch

import pytest

from cli_agent_orchestrator.models.agent_profile import AgentProfile
from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.services.terminal_service import (
    ConcurrencyCapExceededError,
    _count_active_workers,
    _enforce_worker_cap,
)


def _terminal(tid: str, profile: str = "developer") -> dict:
    return {"id": tid, "agent_profile": profile}


def _profile(role: str | None) -> AgentProfile:
    return AgentProfile(name="x", description="x", role=role)


def _patch_status(mapping: dict):
    """Patch live status lookups: mapping of terminal_id -> TerminalStatus."""
    return patch(
        "cli_agent_orchestrator.services.terminal_service.status_monitor.get_status",
        side_effect=lambda tid: mapping.get(tid, TerminalStatus.PROCESSING),
    )


@pytest.fixture(autouse=True)
def _registered_providers():
    """Make every test terminal look live in this process (provider registered).

    The cap deliberately ignores terminals with no registered provider (stale
    DB rows); these unit tests exercise the counting rules, so all their
    terminals are 'live' unless a test says otherwise.
    """
    with patch(
        "cli_agent_orchestrator.services.terminal_service.provider_manager.get_provider",
        return_value=MagicMock(),
    ):
        yield


class TestCountActiveWorkers:
    def test_counts_busy_workers(self):
        terminals = [_terminal("a" * 8), _terminal("b" * 8)]
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                return_value=_profile("developer"),
            ),
            _patch_status({}),
        ):
            assert _count_active_workers(terminals) == 2

    def test_excludes_supervisor_and_memory_manager(self):
        terminals = [
            _terminal("a" * 8, "analysis_supervisor"),
            _terminal("b" * 8, "memory_manager"),
            _terminal("c" * 8, "developer"),
        ]

        def fake_load(name):
            return _profile("supervisor" if name == "analysis_supervisor" else "developer")

        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                side_effect=fake_load,
            ),
            _patch_status({}),
        ):
            assert _count_active_workers(terminals) == 1

    def test_excludes_finished_workers(self):
        terminals = [_terminal("a" * 8), _terminal("b" * 8), _terminal("c" * 8)]
        statuses = {
            "a" * 8: TerminalStatus.COMPLETED,
            "b" * 8: TerminalStatus.ERROR,
        }
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                return_value=_profile("developer"),
            ),
            _patch_status(statuses),
        ):
            assert _count_active_workers(terminals) == 1

    def test_unloadable_profile_counts_as_worker(self):
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                side_effect=FileNotFoundError("gone"),
            ),
            _patch_status({}),
        ):
            assert _count_active_workers([_terminal("a" * 8, "ghost")]) == 1

    def test_unregistered_terminals_do_not_count(self):
        """Stale DB rows (no provider in this process) are invisible to the cap."""
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.provider_manager.get_provider",
                return_value=None,
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                return_value=_profile("developer"),
            ),
            _patch_status({}),
        ):
            assert _count_active_workers([_terminal("a" * 8), _terminal("b" * 8)]) == 0


class TestEnforceWorkerCap:
    def _busy(self, n: int) -> list:
        return [_terminal(f"{i:08x}") for i in range(n)]

    def test_under_cap_passes(self):
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_terminals_by_session",
                return_value=self._busy(2),
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_all_terminals",
                return_value=self._busy(3),
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                return_value=_profile("developer"),
            ),
            _patch_status({}),
        ):
            _enforce_worker_cap("cao-test")  # no raise

    def test_session_cap_rejects(self):
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_terminals_by_session",
                return_value=self._busy(8),
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                return_value=_profile("developer"),
            ),
            _patch_status({}),
        ):
            with pytest.raises(ConcurrencyCapExceededError, match="cap 8"):
                _enforce_worker_cap("cao-test")

    def test_global_cap_rejects(self):
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_terminals_by_session",
                return_value=self._busy(2),
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_all_terminals",
                return_value=self._busy(16),
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                return_value=_profile("developer"),
            ),
            _patch_status({}),
        ):
            with pytest.raises(ConcurrencyCapExceededError, match="cap 16"):
                _enforce_worker_cap("cao-test")

    def test_finished_workers_free_capacity(self):
        """COMPLETED workers do not block new fan-out."""
        terminals = self._busy(8)
        statuses = {t["id"]: TerminalStatus.COMPLETED for t in terminals[:4]}
        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_terminals_by_session",
                return_value=terminals,
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_all_terminals",
                return_value=terminals,
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.load_agent_profile",
                return_value=_profile("developer"),
            ),
            _patch_status(statuses),
        ):
            _enforce_worker_cap("cao-test")  # 4 active < 8 cap


class TestCapAtApiLayer:
    def test_cap_rejection_maps_to_429(self, monkeypatch):
        from fastapi.testclient import TestClient

        from cli_agent_orchestrator.api.main import app
        from cli_agent_orchestrator.plugins import PluginRegistry

        async def rejecting_create(*args, **kwargs):
            raise ConcurrencyCapExceededError("Session 'cao-x' already has 8 active workers")

        monkeypatch.setattr(
            "cli_agent_orchestrator.api.main.terminal_service.create_terminal",
            rejecting_create,
        )
        app.state.plugin_registry = PluginRegistry()
        client = TestClient(app)
        resp = client.post(
            "/sessions/cao-x/terminals",
            params={"agent_profile": "developer", "provider": "claude_code"},
            headers={"Host": "localhost"},
        )
        assert resp.status_code == 429
        assert "active workers" in resp.json()["detail"]
