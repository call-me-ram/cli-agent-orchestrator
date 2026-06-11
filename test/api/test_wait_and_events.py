"""Tests for the event-driven wait endpoint and the SSE status stream."""

import asyncio
import json
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio

from cli_agent_orchestrator.api.main import app
from cli_agent_orchestrator.models.terminal import TerminalStatus
from cli_agent_orchestrator.plugins import PluginRegistry
from cli_agent_orchestrator.services.event_bus import bus

TERMINAL_ID = "abc12345"
TOPIC = f"terminal.{TERMINAL_ID}.status"


def _patch_terminal_exists():
    return patch(
        "cli_agent_orchestrator.api.main.terminal_service.get_terminal",
        return_value={"id": TERMINAL_ID},
    )


def _patch_status(value: TerminalStatus):
    return patch(
        "cli_agent_orchestrator.services.status_monitor.status_monitor.get_status",
        return_value=value,
    )


@pytest_asyncio.fixture
async def async_client():
    """ASGI client on the test's own event loop so bus dispatch works in-process."""
    app.state.plugin_registry = PluginRegistry()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as client:
        yield client


@pytest.mark.asyncio
class TestWaitEndpoint:
    async def test_already_reached_returns_immediately(self, async_client):
        with _patch_terminal_exists(), _patch_status(TerminalStatus.COMPLETED):
            resp = await async_client.get(
                f"/terminals/{TERMINAL_ID}/wait", params={"status": "completed", "timeout": 5}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body == {
            "terminal_id": TERMINAL_ID,
            "reached": True,
            "timed_out": False,
            "status": "completed",
        }

    async def test_resolves_on_published_transition(self, async_client):
        with _patch_terminal_exists(), _patch_status(TerminalStatus.PROCESSING):
            request = asyncio.create_task(
                async_client.get(
                    f"/terminals/{TERMINAL_ID}/wait",
                    params={"status": ["completed", "error"], "timeout": 5},
                )
            )
            await asyncio.sleep(0.1)  # let the handler subscribe
            bus._dispatch(TOPIC, {"status": TerminalStatus.COMPLETED.value})
            resp = await asyncio.wait_for(request, timeout=3.0)
        assert resp.status_code == 200
        assert resp.json()["reached"] is True
        assert resp.json()["timed_out"] is False

    async def test_timeout_is_normal_200(self, async_client):
        with _patch_terminal_exists(), _patch_status(TerminalStatus.PROCESSING):
            resp = await async_client.get(
                f"/terminals/{TERMINAL_ID}/wait", params={"status": "completed", "timeout": 0.2}
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["reached"] is False
        assert body["timed_out"] is True
        assert body["status"] == "processing"

    async def test_unknown_terminal_404(self, async_client):
        with patch(
            "cli_agent_orchestrator.api.main.terminal_service.get_terminal",
            side_effect=ValueError("Terminal not found"),
        ):
            resp = await async_client.get(
                f"/terminals/{TERMINAL_ID}/wait", params={"status": "completed"}
            )
        assert resp.status_code == 404

    async def test_invalid_status_400(self, async_client):
        with _patch_terminal_exists():
            resp = await async_client.get(
                f"/terminals/{TERMINAL_ID}/wait", params={"status": "definitely-not-a-status"}
            )
        assert resp.status_code == 400
        assert "allowed values" in resp.json()["detail"]

    async def test_timeout_above_cap_rejected(self, async_client):
        with _patch_terminal_exists():
            resp = await async_client.get(
                f"/terminals/{TERMINAL_ID}/wait",
                params={"status": "completed", "timeout": 1_000_000},
            )
        assert resp.status_code == 422

    async def test_no_subscription_leak_after_completion(self, async_client):
        with _patch_terminal_exists(), _patch_status(TerminalStatus.PROCESSING):
            await async_client.get(
                f"/terminals/{TERMINAL_ID}/wait", params={"status": "completed", "timeout": 0.2}
            )
        assert TOPIC not in bus._exact


@pytest.mark.asyncio
class TestStatusEventsSSE:
    """The generator is tested directly: httpx's ASGITransport buffers entire
    responses, so an infinite SSE stream cannot be exercised through it. The
    EventSourceResponse wrapper (ping/disconnect handling) is sse-starlette's
    own tested behavior."""

    async def test_yields_status_event_per_publish(self):
        from cli_agent_orchestrator.api.main import _status_event_stream

        baseline_wildcards = len(bus._wildcard)
        stream = _status_event_stream()
        try:
            reader = asyncio.create_task(anext(stream))
            await asyncio.sleep(0.05)  # let the generator subscribe
            assert len(bus._wildcard) == baseline_wildcards + 1
            bus._dispatch(TOPIC, {"status": "processing"})
            event = await asyncio.wait_for(reader, timeout=3.0)
        finally:
            await stream.aclose()

        assert event["event"] == "status"
        assert json.loads(event["data"]) == {"terminal_id": TERMINAL_ID, "status": "processing"}
        # aclose() routes through the generator's finally → no leaked queues.
        assert len(bus._wildcard) == baseline_wildcards

    async def test_endpoint_returns_event_stream_response(self):
        from starlette.requests import Request as StarletteRequest

        from cli_agent_orchestrator.api.main import status_events

        request = StarletteRequest(
            {"type": "http", "method": "GET", "headers": [], "client": ("127.0.0.1", 50000)}
        )
        resp = await status_events(request)
        assert resp.media_type == "text/event-stream"
        # Tear down the generator the response wraps so no subscription leaks.
        await resp.body_iterator.aclose()

    async def test_endpoint_rejects_non_allowlisted_client(self):
        from fastapi import HTTPException
        from starlette.requests import Request as StarletteRequest

        from cli_agent_orchestrator.api.main import status_events

        request = StarletteRequest(
            {"type": "http", "method": "GET", "headers": [], "client": ("10.9.8.7", 50000)}
        )
        with pytest.raises(HTTPException) as exc:
            await status_events(request)
        assert exc.value.status_code == 403
