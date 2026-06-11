"""Tests for the event-driven status wait helper (wait_until_status_event)."""

import asyncio
from unittest.mock import patch

import pytest

from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.services.event_bus import bus
from cli_agent_orchestrator.utils.terminal import wait_until_status_event

TERMINAL_ID = "abc12345"
TOPIC = f"terminal.{TERMINAL_ID}.status"


def _patch_status(value: TerminalStatus):
    """Patch the status_monitor snapshot read inside the helper."""
    return patch(
        "cli_agent_orchestrator.services.status_monitor.status_monitor.get_status",
        return_value=value,
    )


@pytest.mark.asyncio
class TestWaitUntilStatusEvent:
    async def test_already_reached_returns_immediately(self):
        """A terminal already in a target status must not block (latched statuses never re-emit)."""
        with _patch_status(TerminalStatus.COMPLETED):
            reached = await wait_until_status_event(
                TERMINAL_ID, {TerminalStatus.COMPLETED}, timeout=5.0
            )
        assert reached is True
        assert TOPIC not in bus._exact  # subscription cleaned up

    async def test_wakes_on_matching_event(self):
        """A published matching transition resolves the wait without polling."""
        with _patch_status(TerminalStatus.PROCESSING):
            task = asyncio.create_task(
                wait_until_status_event(TERMINAL_ID, {TerminalStatus.COMPLETED}, timeout=5.0)
            )
            await asyncio.sleep(0.05)  # let the task subscribe + snapshot
            bus._dispatch(TOPIC, {"status": TerminalStatus.COMPLETED.value})
            reached = await asyncio.wait_for(task, timeout=2.0)
        assert reached is True
        assert TOPIC not in bus._exact

    async def test_ignores_non_target_status_then_times_out(self):
        """Non-target transitions are consumed but do not resolve the wait."""
        with _patch_status(TerminalStatus.PROCESSING):
            task = asyncio.create_task(
                wait_until_status_event(TERMINAL_ID, {TerminalStatus.COMPLETED}, timeout=0.4)
            )
            await asyncio.sleep(0.05)
            bus._dispatch(TOPIC, {"status": TerminalStatus.PROCESSING.value})
            reached = await asyncio.wait_for(task, timeout=2.0)
        assert reached is False
        assert TOPIC not in bus._exact

    async def test_other_terminals_events_do_not_wake(self):
        """Exact-topic subscription: another terminal's transition is invisible."""
        with _patch_status(TerminalStatus.PROCESSING):
            task = asyncio.create_task(
                wait_until_status_event(TERMINAL_ID, {TerminalStatus.COMPLETED}, timeout=0.4)
            )
            await asyncio.sleep(0.05)
            bus._dispatch("terminal.other999.status", {"status": TerminalStatus.COMPLETED.value})
            reached = await asyncio.wait_for(task, timeout=2.0)
        assert reached is False

    async def test_timeout_returns_false_and_unsubscribes(self):
        """No events at all → False at timeout, no leaked subscription."""
        with _patch_status(TerminalStatus.UNKNOWN):
            reached = await wait_until_status_event(
                TERMINAL_ID, {TerminalStatus.COMPLETED}, timeout=0.2
            )
        assert reached is False
        assert TOPIC not in bus._exact

    async def test_accepts_single_status_and_set(self):
        """Both a bare TerminalStatus and a set of them are valid targets."""
        with _patch_status(TerminalStatus.IDLE):
            assert await wait_until_status_event(TERMINAL_ID, TerminalStatus.IDLE, timeout=1.0)
            assert await wait_until_status_event(
                TERMINAL_ID, {TerminalStatus.IDLE, TerminalStatus.ERROR}, timeout=1.0
            )

    async def test_transition_between_subscribe_and_snapshot_not_lost(self):
        """A transition landing DURING the snapshot read is already queued
        (subscribe happens first), so it still resolves the wait."""

        def snapshot_with_concurrent_transition(terminal_id):
            # The transition fires while the snapshot is being taken and the
            # snapshot returns the PRE-transition value — the queued event
            # must still resolve the wait.
            bus._dispatch(TOPIC, {"status": TerminalStatus.COMPLETED.value})
            return TerminalStatus.PROCESSING

        with patch(
            "cli_agent_orchestrator.services.status_monitor.status_monitor.get_status",
            side_effect=snapshot_with_concurrent_transition,
        ):
            reached = await asyncio.wait_for(
                wait_until_status_event(TERMINAL_ID, {TerminalStatus.COMPLETED}, timeout=5.0),
                timeout=2.0,
            )
        assert reached is True

    async def test_snapshot_lap_resolves_without_events(self):
        """Backends that never publish status events (herdr) resolve via the
        periodic re-snapshot instead of burning the full timeout."""
        snapshots = iter(
            [TerminalStatus.PROCESSING, TerminalStatus.PROCESSING, TerminalStatus.COMPLETED]
        )
        with patch(
            "cli_agent_orchestrator.services.status_monitor.status_monitor.get_status",
            side_effect=lambda _tid: next(snapshots),
        ):
            reached = await asyncio.wait_for(
                wait_until_status_event(
                    TERMINAL_ID,
                    {TerminalStatus.COMPLETED},
                    timeout=5.0,
                    snapshot_interval=0.1,
                ),
                timeout=3.0,
            )
        assert reached is True
        assert TOPIC not in bus._exact

    async def test_should_abort_releases_wait_early(self):
        """An abandoned wait (client disconnected) returns promptly instead of
        holding the subscription for the full timeout."""

        async def gone():
            return True

        with _patch_status(TerminalStatus.PROCESSING):
            reached = await asyncio.wait_for(
                wait_until_status_event(
                    TERMINAL_ID,
                    {TerminalStatus.COMPLETED},
                    timeout=60.0,
                    snapshot_interval=0.1,
                    should_abort=gone,
                ),
                timeout=3.0,
            )
        assert reached is False
        assert TOPIC not in bus._exact
