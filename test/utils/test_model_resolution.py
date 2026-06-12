"""Tests for effective-model resolution."""

import json

from cli_agent_orchestrator.utils.model_resolution import effective_model


class TestEffectiveModel:
    def test_pinned_model_wins(self):
        assert effective_model("claude_code", "sonnet") == "sonnet"

    def test_claude_default_read_and_prettified(self, tmp_path, monkeypatch):
        from pathlib import Path as P

        monkeypatch.setattr(P, "home", classmethod(lambda cls: tmp_path))
        (tmp_path / ".claude").mkdir()
        (tmp_path / ".claude" / "settings.json").write_text(
            json.dumps({"model": "claude-fable-5[1m]"})
        )
        assert effective_model("claude_code", None) == "fable-5"

    def test_kimi_default_read(self, tmp_path, monkeypatch):
        from pathlib import Path as P

        monkeypatch.setattr(P, "home", classmethod(lambda cls: tmp_path))
        (tmp_path / ".kimi").mkdir()
        (tmp_path / ".kimi" / "config.toml").write_text(
            'default_model = "kimi-code/kimi-for-coding"\n'
        )
        assert effective_model("kimi_cli", None) == "kimi-for-coding"

    def test_unknown_provider_or_missing_config_is_none(self, tmp_path, monkeypatch):
        from pathlib import Path as P

        monkeypatch.setattr(P, "home", classmethod(lambda cls: tmp_path))
        assert effective_model("claude_code", None) is None
        assert effective_model("gemini_cli", None) is None
