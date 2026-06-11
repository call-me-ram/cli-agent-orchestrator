"""MCP server models."""

from typing import Optional

from pydantic import BaseModel, Field


class HandoffResult(BaseModel):
    """Result of a handoff operation."""

    success: bool = Field(description="Whether the handoff was successful")
    message: str = Field(description="A message describing the result of the handoff")
    output: Optional[str] = Field(None, description="The output from the target agent")
    terminal_id: Optional[str] = Field(None, description="The terminal ID used for the handoff")
    result: Optional[dict] = Field(
        None,
        description=(
            "Structured file/git-based result captured before worker cleanup: "
            "branch, files_changed, git_diff (capped), manifest. Prefer this "
            "over `output` when reviewing code work — it is real git state, "
            "not TUI-scraped text."
        ),
    )
