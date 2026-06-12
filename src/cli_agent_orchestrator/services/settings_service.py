"""Settings service for persisting user configuration."""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from cli_agent_orchestrator.constants import CAO_HOME_DIR

logger = logging.getLogger(__name__)

SETTINGS_FILE = CAO_HOME_DIR / "settings.json"

# Default agent directories per provider
_DEFAULTS = {
    "kiro_cli": str(Path.home() / ".kiro" / "agents"),
    "q_cli": str(Path.home() / ".aws" / "amazonq" / "cli-agents"),
    "claude_code": str(Path.home() / ".aws" / "cli-agent-orchestrator" / "agent-store"),
    "codex": str(Path.home() / ".aws" / "cli-agent-orchestrator" / "agent-store"),
    "cao_installed": str(Path.home() / ".aws" / "cli-agent-orchestrator" / "agent-context"),
}


def _load() -> Dict[str, Any]:
    """Load settings from disk."""
    if SETTINGS_FILE.exists():
        try:
            data = json.loads(SETTINGS_FILE.read_text())
            if isinstance(data, dict):
                return data
        except Exception as e:
            logger.warning(f"Failed to read settings: {e}")
    return {}


def _save(data: Dict[str, Any]) -> None:
    """Save settings to disk."""
    CAO_HOME_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def get_agent_dirs() -> Dict[str, str]:
    """Get configured agent directories per provider.

    Returns dict like:
      {"kiro_cli": "/home/user/.kiro/agents", "q_cli": "...", ...}
    """
    settings = _load()
    saved = settings.get("agent_dirs", {})
    # Merge defaults with saved — saved overrides defaults
    result = dict(_DEFAULTS)
    result.update(saved)
    # User-disabled defaults stay removed (GH #281: deleting a default in the
    # UI used to silently come back because defaults were always re-merged).
    disabled = set(get_disabled_agent_dirs())
    if disabled:
        result = {k: v for k, v in result.items() if v not in disabled}
    return result


def get_disabled_agent_dirs() -> List[str]:
    """Default directories the user removed; persisted so they stay removed."""
    settings = _load()
    dirs = settings.get("disabled_agent_dirs", [])
    return dirs if isinstance(dirs, list) else []


def set_disabled_agent_dirs(dirs: List[str]) -> List[str]:
    """Persist which default directories are disabled. Only known default
    paths are accepted — arbitrary entries would silently do nothing."""
    valid = set(_DEFAULTS.values())
    cleaned = [d for d in dirs if isinstance(d, str) and d.strip() and d in valid]
    settings = _load()
    settings["disabled_agent_dirs"] = cleaned
    _save(settings)
    logger.info(f"Disabled default agent dirs: {cleaned}")
    return cleaned


def set_agent_dirs(dirs: Dict[str, str]) -> Dict[str, str]:
    """Update agent directories. Only updates providers that are specified."""
    settings = _load()
    current = settings.get("agent_dirs", {})
    for provider, path in dirs.items():
        if provider in _DEFAULTS:
            current[provider] = path
    settings["agent_dirs"] = current
    _save(settings)
    logger.info(f"Updated agent directories: {current}")
    return get_agent_dirs()


def get_memory_settings() -> Dict[str, Any]:
    """Get memory-related settings.

    ``enabled`` defaults to ``True`` (opt-out) to preserve current shipping
    behavior. Setting it to ``False`` disables all memory subsystem
    operations — see ``is_memory_enabled()``.
    """
    settings = _load()
    defaults: Dict[str, Any] = {"enabled": True, "flush_threshold": 0.85}
    saved = settings.get("memory", {})
    result = dict(defaults)
    result.update(saved)
    return result


def is_memory_enabled() -> bool:
    """Return True when the memory subsystem is enabled.

    Reads the ``memory.enabled`` flag; defaults to True (opt-out) so
    existing installations preserve current behavior.
    """
    try:
        value = get_memory_settings().get("enabled", True)
    except Exception as e:
        logger.warning(f"Failed to read memory.enabled, defaulting to True: {e}")
        return True
    return bool(value)


def set_memory_setting(key: str, value: Any) -> Dict[str, Any]:
    """Update a single memory setting.

    Supported keys:
        ``enabled`` (bool) — master switch for the memory subsystem.
        ``flush_threshold`` (float, 0.0 < x ≤ 1.0) — context-usage trigger.
    """
    settings = _load()
    memory = settings.get("memory", {})

    if key == "enabled":
        if not isinstance(value, bool):
            raise ValueError(f"enabled must be a bool, got {type(value).__name__}")
        memory[key] = value
    elif key == "flush_threshold":
        fval = float(value)
        if not (0.0 < fval <= 1.0):
            raise ValueError(f"flush_threshold must be between 0.0 and 1.0, got {fval}")
        memory[key] = fval
    else:
        raise ValueError(f"Unknown memory setting: {key}")

    settings["memory"] = memory
    _save(settings)
    logger.info(f"Updated memory setting: {key}={memory[key]}")
    return get_memory_settings()


def get_session_labels() -> Dict[str, str]:
    """User-assigned friendly names for sessions (session_name -> label)."""
    settings = _load()
    labels = settings.get("session_labels", {})
    return labels if isinstance(labels, dict) else {}


def set_session_label(session_name: str, label: str) -> Dict[str, str]:
    """Set or clear a session's friendly label (empty label removes it)."""
    settings = _load()
    labels = settings.get("session_labels", {})
    if not isinstance(labels, dict):
        labels = {}
    clean = label.strip()[:60]
    if clean:
        labels[session_name] = clean
    else:
        labels.pop(session_name, None)
    settings["session_labels"] = labels
    _save(settings)
    return labels


def get_extra_agent_dirs() -> List[str]:
    """Get extra agent scan directories (user-added custom paths)."""
    settings = _load()
    dirs = settings.get("extra_agent_dirs", [])
    return dirs if isinstance(dirs, list) else []


def set_extra_agent_dirs(dirs: List[str]) -> List[str]:
    """Set extra agent scan directories."""
    settings = _load()
    extra_agent_dirs = [d for d in dirs if d.strip()]
    settings["extra_agent_dirs"] = extra_agent_dirs
    _save(settings)
    return extra_agent_dirs
