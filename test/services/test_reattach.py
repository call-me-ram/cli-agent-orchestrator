"""Tests for re-attaching surviving terminals after a server restart."""

from unittest.mock import MagicMock, patch

from cli_agent_orchestrator.services import terminal_service


def _terminal(tid: str, session: str = "cao-alive", window: str = "dev-1") -> dict:
    return {"id": tid, "tmux_session": session, "tmux_window": window}


def _run(terminals, *, live_sessions, already_registered=frozenset()):
    backend = MagicMock()
    backend.supports_event_inbox.return_value = False
    backend.session_exists.side_effect = lambda s: s in live_sessions

    with (
        patch(
            "cli_agent_orchestrator.services.terminal_service.get_backend",
            return_value=backend,
        ),
        patch(
            "cli_agent_orchestrator.services.terminal_service.list_all_terminals",
            return_value=terminals,
        ),
        patch("cli_agent_orchestrator.services.terminal_service.provider_manager") as mock_pm,
        patch("cli_agent_orchestrator.services.terminal_service.fifo_manager") as mock_fifo,
    ):
        mock_pm.has_provider.side_effect = lambda tid: tid in already_registered
        count = terminal_service.reattach_surviving_terminals()
    return count, backend, mock_pm, mock_fifo


class TestReattachSurvivingTerminals:
    def test_reattaches_surviving_terminal(self):
        count, backend, mock_pm, mock_fifo = _run(
            [_terminal("aaaa1111")], live_sessions={"cao-alive"}
        )
        assert count == 1
        mock_pm.get_provider.assert_called_once_with("aaaa1111")
        mock_fifo.create_reader.assert_called_once_with("aaaa1111")
        backend.pipe_pane.assert_called_once()

    def test_skips_stale_rows_whose_session_died(self):
        count, backend, mock_pm, _ = _run(
            [_terminal("aaaa1111", session="cao-dead")], live_sessions=set()
        )
        assert count == 0
        mock_pm.get_provider.assert_not_called()
        backend.pipe_pane.assert_not_called()

    def test_skips_terminals_already_registered(self):
        count, _, mock_pm, _ = _run(
            [_terminal("aaaa1111")],
            live_sessions={"cao-alive"},
            already_registered={"aaaa1111"},
        )
        assert count == 0
        mock_pm.get_provider.assert_not_called()

    def test_one_failure_does_not_stop_the_sweep(self):
        terminals = [_terminal("aaaa1111"), _terminal("bbbb2222")]
        backend = MagicMock()
        backend.supports_event_inbox.return_value = False
        backend.session_exists.return_value = True

        with (
            patch(
                "cli_agent_orchestrator.services.terminal_service.get_backend",
                return_value=backend,
            ),
            patch(
                "cli_agent_orchestrator.services.terminal_service.list_all_terminals",
                return_value=terminals,
            ),
            patch("cli_agent_orchestrator.services.terminal_service.provider_manager") as mock_pm,
            patch("cli_agent_orchestrator.services.terminal_service.fifo_manager") as mock_fifo,
        ):
            mock_pm.has_provider.return_value = False
            mock_pm.get_provider.side_effect = [ValueError("corrupt row"), MagicMock()]
            count = terminal_service.reattach_surviving_terminals()

        assert count == 1
        assert mock_fifo.create_reader.call_count == 1

    def test_event_inbox_backend_is_a_noop(self):
        backend = MagicMock()
        backend.supports_event_inbox.return_value = True
        with patch(
            "cli_agent_orchestrator.services.terminal_service.get_backend",
            return_value=backend,
        ):
            assert terminal_service.reattach_surviving_terminals() == 0
