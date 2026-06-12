"""Resolve the EFFECTIVE LLM model an agent terminal runs.

A profile-pinned model wins (CAO passes it as ``--model``). Otherwise the
provider CLI uses its own configured default, which is readable from its
config — surfacing it answers the very reasonable operator question
"is this worker burning Fable, or Sonnet?" without scraping any TUI.
"""

import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# "claude-fable-5[1m]" -> "fable-5"; "claude-sonnet-4-6" -> "sonnet-4-6"
_CLAUDE_PREFIX = re.compile(r"^claude-")
_BRACKET_SUFFIX = re.compile(r"\[[^\]]*\]$")
_KIMI_DEFAULT = re.compile(r'^default_model\s*=\s*"([^"]+)"', re.MULTILINE)


def _prettify_claude(raw: str) -> str:
    return _CLAUDE_PREFIX.sub("", _BRACKET_SUFFIX.sub("", raw.strip()))


def effective_model(provider: str, profile_model: Optional[str]) -> Optional[str]:
    """The model this terminal actually runs, or None when undeterminable."""
    if profile_model:
        return profile_model
    try:
        if provider == "claude_code":
            settings_path = Path.home() / ".claude" / "settings.json"
            if settings_path.is_file():
                raw = json.loads(settings_path.read_text()).get("model")
                if isinstance(raw, str) and raw:
                    return _prettify_claude(raw)
        elif provider == "kimi_cli":
            config_path = Path.home() / ".kimi" / "config.toml"
            if config_path.is_file():
                match = _KIMI_DEFAULT.search(config_path.read_text())
                if match:
                    return match.group(1).split("/")[-1]
    except Exception as e:
        logger.debug(f"Could not resolve default model for {provider}: {e}")
    return None
