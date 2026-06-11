"""CAO operations MCP server implementation."""

import asyncio
import functools
from typing import Annotated, Any, Dict, List, Optional

import requests  # type: ignore[import-untyped]
from fastmcp import FastMCP
from pydantic import Field

from cli_agent_orchestrator.constants import API_BASE_URL, DEFAULT_PROVIDER
from cli_agent_orchestrator.ops_mcp_server.models import (
    InstallResult,
    LaunchResult,
    ProfileListResult,
    SendMessageResult,
    SessionListResult,
)
from cli_agent_orchestrator.utils.terminal import generate_session_name

JsonDict = Dict[str, Any]

mcp = FastMCP(
    "cao-ops-mcp",
    instructions="""
    # CAO Operations MCP Server

    Manage CLI Agent Orchestrator profiles and sessions from outside a CAO session.
    Requires the CAO API server running at localhost:9889.

    ## Typical Workflow
    1. list_profiles to inspect available profiles
    2. get_profile_details to review a profile's full prompt and metadata
    3. install_profile to install a profile for a target provider
    4. launch_session to start a new CAO session
    5. send_session_message to deliver a prompt to a running terminal
    6. wait_for_terminal_status to block until a worker finishes (event-driven;
       prefer this over polling get_terminal_status, which is for one-shot checks)
    7. get_terminal_result to review the worker's REAL git state (branch, diff,
       changed files); get_terminal_output for its narrative response text
    8. get_session_info or list_sessions to monitor overall progress
    9. shutdown_session to clean up when done
    """,
)


def _response_detail(response: requests.Response) -> str:
    """Extract the most useful error detail from an API response."""
    try:
        payload = response.json()
    except ValueError:
        text = response.text.strip()
        return text or f"HTTP {response.status_code}"

    if isinstance(payload, dict):
        detail = payload.get("detail") or payload.get("message")
        if isinstance(detail, str) and detail:
            return detail

    text = response.text.strip()
    return text or f"HTTP {response.status_code}"


def _request_json(
    method: str,
    path: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    json: Optional[Any] = None,
    operation: str,
    timeout: Optional[tuple[float, float]] = None,
) -> tuple[Optional[Any], Optional[str]]:
    """Execute an API request and return either JSON data or an error message.

    ``timeout`` is a requests-style ``(connect, read)`` tuple. Long-poll
    callers (wait_for_terminal_status) must set the read timeout LONGER than
    the server-side wait so the client socket outlives the long-poll, while
    the short connect timeout makes an unreachable server fail in seconds.
    NOTE: this function blocks the calling thread for up to the read timeout —
    async tools must run it via ``asyncio.to_thread`` so the MCP server's
    event loop stays responsive (pings, cancellation, parallel tool calls).
    """
    request_kwargs: Dict[str, Any] = {"params": params, "json": json}
    if timeout is not None:
        request_kwargs["timeout"] = timeout
    try:
        response = requests.request(
            method,
            f"{API_BASE_URL}{path}",
            **request_kwargs,
        )
    except requests.RequestException as exc:
        return None, f"{operation} failed: {exc}"

    if response.status_code >= 400:
        return None, f"{operation} failed: {_response_detail(response)}"

    try:
        return response.json(), None
    except ValueError as exc:
        return None, f"{operation} failed: invalid JSON response ({exc})"


def _serialize_allowed_tools(allowed_tools: Optional[List[str]]) -> Optional[str]:
    """Serialize allowed tools for the session creation API."""
    if not allowed_tools:
        return None
    return ",".join(allowed_tools)


async def _launch_session_impl(
    agent_profile: str,
    provider: Optional[str] = None,
    session_name: Optional[str] = None,
    working_directory: Optional[str] = None,
    allowed_tools: Optional[List[str]] = None,
) -> LaunchResult:
    """Create a new CAO session and return the session identifiers."""
    resolved_session_name = session_name or generate_session_name()
    params: Dict[str, Any] = {
        "agent_profile": agent_profile,
        "session_name": resolved_session_name,
    }
    if provider is not None:
        params["provider"] = provider
    if working_directory:
        params["working_directory"] = working_directory

    serialized_allowed_tools = _serialize_allowed_tools(allowed_tools)
    if serialized_allowed_tools:
        params["allowed_tools"] = serialized_allowed_tools

    session_data, error = _request_json(
        "post", "/sessions", params=params, operation="Launch session"
    )
    if error:
        return LaunchResult(
            success=False,
            message=error,
            session_name=resolved_session_name,
            terminal_id=None,
        )

    if not isinstance(session_data, dict) or "id" not in session_data:
        return LaunchResult(
            success=False,
            message="Launch session failed: invalid session response",
            session_name=resolved_session_name,
            terminal_id=None,
        )

    terminal_id = str(session_data["id"])
    return LaunchResult(
        success=True,
        message=f"Session '{resolved_session_name}' launched successfully",
        session_name=resolved_session_name,
        terminal_id=terminal_id,
    )


@mcp.tool()
async def list_profiles() -> ProfileListResult:
    """List available agent profiles.

    Scans built-in store, local store, and all configured provider agent
    directories. Profiles are deduplicated by name with source metadata.

    Returns:
        ProfileListResult with success status and profiles list
    """
    data, error = _request_json("get", "/agents/profiles", operation="List profiles")
    if error:
        return ProfileListResult(success=False, message=error)
    if isinstance(data, list):
        return ProfileListResult(success=True, profiles=data)
    return ProfileListResult(
        success=False,
        message="List profiles failed: invalid response payload",
    )


@mcp.tool()
async def get_profile_details(
    name: Annotated[str, Field(description="The agent profile name to inspect")],
) -> JsonDict:
    """Get the full parsed content of a specific agent profile.

    Returns all AgentProfile fields (name, description, system_prompt, role,
    provider, allowedTools, mcpServers, model) with None-valued fields excluded.

    Args:
        name: Agent profile name to inspect

    Returns:
        Dict with profile fields, or {"success": False, "message": ...} on error
    """
    data, error = _request_json(
        "get",
        f"/agents/profiles/{name}",
        operation=f"Get profile details for '{name}'",
    )
    if error:
        return {"success": False, "message": error}
    if isinstance(data, dict):
        return data
    return {"success": False, "message": "Get profile details failed: invalid response payload"}


@mcp.tool()
async def install_profile(
    source: Annotated[str, Field(description="Agent name or https:// URL to install")],
    provider: Annotated[
        str,
        Field(description="Target provider for the installed profile"),
    ] = DEFAULT_PROVIDER,
    env_vars: Annotated[
        Optional[Dict[str, str]],
        Field(description="Optional environment variables to inject before install"),
    ] = None,
) -> InstallResult:
    """Install an agent profile for a target provider.

    ## Source Resolution

    Remote callers (HTTP API / MCP) may install by either:
    1. https:// URL from an allow-listed host (``github.com``,
       ``raw.githubusercontent.com`` by default; extend via the
       ``CAO_PROFILE_ALLOWED_HOSTS`` env var on ``cao-server``).
    2. Profile name matching ``[A-Za-z0-9_-]{1,64}`` — looked up in the local
       store, provider dirs, then the built-in store.

    Installing by local filesystem path is CLI-only and is rejected from the
    HTTP API and this MCP tool.

    ## Provider Config

    - q_cli, kiro_cli: JSON config written to the provider's agents directory
    - copilot_cli: frontmatter markdown written to the Copilot agents directory
    - claude_code, codex: context file only, no provider-specific config

    Args:
        source: Agent name or https:// URL from an allow-listed host
        provider: Target provider (default: kiro_cli)
        env_vars: Optional env vars written to the managed .env before install

    Returns:
        InstallResult with success status, file paths, and unresolved env vars
    """
    body: Dict[str, Any] = {"source": source, "provider": provider}
    if env_vars:
        body["env_vars"] = env_vars

    data, error = _request_json(
        "post",
        "/agents/profiles/install",
        json=body,
        operation=f"Install profile '{source}'",
    )
    if error:
        return InstallResult(success=False, message=error)
    if isinstance(data, dict):
        return InstallResult(**data)
    return InstallResult(success=False, message="Install profile failed: invalid response payload")


@mcp.tool()
async def launch_session(
    agent_profile: Annotated[str, Field(description="The agent profile to launch")],
    provider: Annotated[
        Optional[str],
        Field(description="The provider to use for the launched session"),
    ] = None,
    session_name: Annotated[
        Optional[str],
        Field(description="Optional custom CAO session name"),
    ] = None,
    working_directory: Annotated[
        Optional[str],
        Field(description="Optional working directory for the launched session"),
    ] = None,
    allowed_tools: Annotated[
        Optional[List[str]],
        Field(description="Optional list of allowed tool restrictions"),
    ] = None,
) -> LaunchResult:
    """Create a new CAO session with the given provider and agent profile.

    Returns immediately with session_name and terminal_id. Use
    send_session_message to deliver an initial prompt once the session is
    running, and get_session_info or list_sessions to monitor progress.

    Args:
        agent_profile: Agent profile for the new session
        provider: CLI provider (default: profile provider or kiro_cli)
        session_name: Optional custom session name (auto-generated if omitted)
        working_directory: Optional working directory for the session
        allowed_tools: Optional list of tool restrictions

    Returns:
        LaunchResult with success status, session_name, and terminal_id
    """
    return await _launch_session_impl(
        agent_profile=agent_profile,
        provider=provider,
        session_name=session_name,
        working_directory=working_directory,
        allowed_tools=allowed_tools,
    )


@mcp.tool()
async def send_session_message(
    terminal_id: Annotated[str, Field(description="The terminal ID to deliver the message to")],
    message: Annotated[str, Field(description="The message text to deliver")],
) -> SendMessageResult:
    """Queue a message for delivery to a running CAO terminal via the inbox service.

    Messages are delivered by the CAO inbox service when the terminal reaches
    IDLE or COMPLETED status. Use get_session_info to retrieve terminal IDs
    from an active session.

    Args:
        terminal_id: Target terminal ID (from launch_session or get_session_info)
        message: Message text to deliver

    Returns:
        SendMessageResult with success status and target terminal_id
    """
    _, error = _request_json(
        "post",
        f"/terminals/{terminal_id}/inbox/messages",
        params={"sender_id": "cao-ops-mcp", "message": message},
        operation=f"Send message to terminal '{terminal_id}'",
    )
    if error:
        return SendMessageResult(success=False, message=error, terminal_id=terminal_id)
    return SendMessageResult(
        success=True,
        message=f"Message queued for terminal '{terminal_id}'",
        terminal_id=terminal_id,
    )


@mcp.tool()
async def get_terminal_status(
    terminal_id: Annotated[str, Field(description="The terminal ID to inspect")],
) -> JsonDict:
    """Get a single terminal's live status and metadata.

    Use this to poll a worker an external supervisor launched: it returns the
    current status (one of unknown / idle / processing / completed /
    waiting_user_answer / error) so the supervisor knows when a delegated task
    has finished before reading its output.

    Args:
        terminal_id: Target terminal ID (from launch_session or get_session_info)

    Returns:
        Dict with id, name, provider, session_name, agent_profile, status,
        last_active — or {"success": False, "message": ...} on error
    """
    data, error = _request_json(
        "get",
        f"/terminals/{terminal_id}",
        operation=f"Get terminal status for '{terminal_id}'",
    )
    if error:
        return {"success": False, "message": error}
    if isinstance(data, dict):
        return data
    return {"success": False, "message": "Get terminal status failed: invalid response payload"}


@mcp.tool()
async def wait_for_terminal_status(
    terminal_id: Annotated[str, Field(description="The terminal ID to wait on")],
    target_statuses: Annotated[
        Optional[List[str]],
        Field(
            description=(
                "Statuses that complete the wait, any of: idle, processing, "
                "completed, waiting_user_answer, error. Default: completed + error."
            )
        ),
    ] = None,
    timeout: Annotated[
        float,
        Field(
            description=(
                "Max seconds to block server-side (<=3600). Keep BELOW your MCP "
                "client's per-tool-call timeout; for very long tasks call this "
                "repeatedly with a bounded timeout (e.g. 120) — each call is "
                "still event-driven, not a poll."
            ),
            gt=0,
            le=3600,
        ),
    ] = 600.0,
) -> JsonDict:
    """Block until a worker terminal reaches a target status (event-driven).

    Use this INSTEAD of looping get_terminal_status: the CAO server parks the
    request on its internal event bus and responds the instant the worker's
    status changes — zero polling, zero missed-transition latency. A timeout
    is a normal outcome (``reached: false, timed_out: true``), not an error;
    re-invoke to keep waiting.

    Prefer STICKY targets (completed, error — the defaults). Transient
    statuses make unreliable targets: 'processing' may be over before the
    wait starts, and a finished worker latches 'completed', so a bare
    ['idle'] wait can stall — if you wait for readiness, use
    ['idle', 'completed'].

    Args:
        terminal_id: Target terminal ID (from launch_session or get_session_info)
        target_statuses: Statuses to wait for (default: ["completed", "error"])
        timeout: Max seconds to block server-side

    Returns:
        Dict with terminal_id, reached (bool), timed_out (bool), and status
        (the terminal's status at return) — or {"success": False, ...} on error
    """
    statuses = target_statuses or ["completed", "error"]
    # to_thread: the sync HTTP call would otherwise pin the MCP event loop
    # for the whole long-poll, freezing pings/cancellation/parallel tools.
    data, error = await asyncio.to_thread(
        functools.partial(
            _request_json,
            "get",
            f"/terminals/{terminal_id}/wait",
            params={"status": statuses, "timeout": timeout},
            operation=f"Wait for terminal status on '{terminal_id}'",
            timeout=(5.0, timeout + 30.0),
        )
    )
    if error:
        return {"success": False, "message": error}
    if isinstance(data, dict):
        return data
    return {"success": False, "message": "Wait for terminal status failed: invalid response"}


@mcp.tool()
async def get_terminal_output(
    terminal_id: Annotated[str, Field(description="The terminal ID to read output from")],
    mode: Annotated[
        str,
        Field(
            description=(
                "'last' returns only the worker's final response (provider-extracted); "
                "'full' returns the recent rolling output buffer."
            )
        ),
    ] = "last",
) -> JsonDict:
    """Read a worker terminal's output so the supervisor can review its work.

    Pair with get_terminal_status: poll until status is completed/idle, then
    read with mode='last' to get the worker's final message. Note the returned
    text is screen-scraped from the worker's TUI and can be truncated on very
    long turns — for code review, prefer inspecting the worker's files / git
    diff directly rather than relying solely on this text.

    Args:
        terminal_id: Target terminal ID
        mode: 'last' (final response, default) or 'full' (rolling buffer)

    Returns:
        Dict with output and mode, or {"success": False, "message": ...} on error
    """
    normalized = (mode or "last").lower()
    if normalized not in ("last", "full"):
        return {
            "success": False,
            "message": f"Get terminal output failed: mode must be 'last' or 'full', got '{mode}'",
        }
    data, error = _request_json(
        "get",
        f"/terminals/{terminal_id}/output",
        params={"mode": normalized},
        operation=f"Get terminal output for '{terminal_id}'",
    )
    if error:
        return {"success": False, "message": error}
    if isinstance(data, dict):
        return data
    return {"success": False, "message": "Get terminal output failed: invalid response payload"}


@mcp.tool()
async def get_terminal_result(
    terminal_id: Annotated[str, Field(description="The terminal ID to read the result from")],
) -> JsonDict:
    """Read a worker's structured file/git-based result — the trustworthy
    review surface for code work.

    Returns the worker's REAL git state from its working directory: current
    branch, changed files (porcelain), diff stat, the diff vs HEAD (capped),
    and an optional worker-written ``.cao/result.json`` manifest. Prefer this
    over get_terminal_output for reviewing code: it cannot be garbled by TUI
    rendering or truncated scrollback. Typical review loop:
    wait_for_terminal_status → get_terminal_result → inspect git_diff →
    merge or send a revision via send_session_message.

    Args:
        terminal_id: Target terminal ID

    Returns:
        Dict with terminal_id, status, working_directory, is_git_repo, branch,
        files_changed, git_diff_stat, git_diff (+ git_diff_truncated), and
        manifest — or {"success": False, "message": ...} on error
    """
    data, error = _request_json(
        "get",
        f"/terminals/{terminal_id}/result",
        operation=f"Get terminal result for '{terminal_id}'",
    )
    if error:
        return {"success": False, "message": error}
    if isinstance(data, dict):
        return data
    return {"success": False, "message": "Get terminal result failed: invalid response payload"}


@mcp.tool()
async def list_sessions() -> SessionListResult:
    """List active CAO sessions with terminal counts and statuses.

    Returns:
        SessionListResult with success status and sessions list
    """
    data, error = _request_json("get", "/sessions", operation="List sessions")
    if error:
        return SessionListResult(success=False, message=error)
    if isinstance(data, list):
        return SessionListResult(success=True, sessions=data)
    return SessionListResult(
        success=False,
        message="List sessions failed: invalid response payload",
    )


@mcp.tool()
async def get_session_info(
    session_name: Annotated[str, Field(description="The CAO session name to inspect")],
) -> JsonDict:
    """Get detailed session metadata including per-terminal status.

    Returns session fields along with a terminals array containing each
    terminal's status, provider, profile, and last activity.

    Args:
        session_name: CAO session name to inspect

    Returns:
        Dict with session fields, or {"success": False, "message": ...} on error
    """
    data, error = _request_json(
        "get",
        f"/sessions/{session_name}",
        operation=f"Get session info for '{session_name}'",
    )
    if error:
        return {"success": False, "message": error}
    if isinstance(data, dict):
        return data
    return {"success": False, "message": "Get session info failed: invalid response payload"}


@mcp.tool()
async def shutdown_session(
    session_name: Annotated[str, Field(description="The CAO session name to shut down")],
) -> JsonDict:
    """Cleanly shut down a CAO session.

    Exits all providers, kills the tmux session, and removes database records.

    Args:
        session_name: CAO session name to shut down

    Returns:
        Dict with success status and cleanup details, or failure dict on error
    """
    data, error = _request_json(
        "delete",
        f"/sessions/{session_name}",
        operation=f"Shutdown session '{session_name}'",
    )
    if error:
        return {"success": False, "message": error}
    if isinstance(data, dict):
        return data
    return {"success": False, "message": "Shutdown session failed: invalid response payload"}


def main() -> None:
    """Run the operations MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
