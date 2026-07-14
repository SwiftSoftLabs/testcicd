"""Gemini meeting assistant via OneWork Vercel webhook."""

from __future__ import annotations

import os
from typing import Any

import httpx
from livekit.agents import llm
from livekit.agents.llm.tool_context import Tool
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)


class OneWorkWebhookLLMStream(llm.LLMStream):
    def __init__(
        self,
        parent: "OneWorkWebhookLLM",
        *,
        chat_ctx: llm.ChatContext,
        tools: list[Tool],
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(
            parent,
            chat_ctx=chat_ctx,
            tools=tools,
            conn_options=conn_options,
        )
        self._parent = parent

    async def _run(self) -> None:
        messages = [
            {"role": m.role, "content": m.text_content or ""}
            for m in self._chat_ctx.items
            if hasattr(m, "role") and m.text_content
        ]
        url = f"{self._parent._app_base_url}/api/calls/{self._parent._call_id}/ai/llm"
        headers = {"x-onework-llm-secret": self._parent._webhook_secret}

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, json={"messages": messages})
            resp.raise_for_status()
            data = resp.json()

        text = data.get("text") or data.get("content") or ""
        if not text and isinstance(data.get("choices"), list) and data["choices"]:
            choice = data["choices"][0]
            text = (
                choice.get("message", {}).get("content")
                or choice.get("text")
                or ""
            )

        self._event_ch.send_nowait(
            llm.ChatChunk(
                id="onework",
                delta=llm.ChoiceDelta(role="assistant", content=text),
            )
        )
        completion_tokens = max(1, len(text.split())) if text else 0
        self._event_ch.send_nowait(
            llm.ChatChunk(
                id="onework",
                usage=llm.CompletionUsage(
                    completion_tokens=completion_tokens,
                    prompt_tokens=0,
                    total_tokens=completion_tokens,
                ),
            )
        )


class OneWorkWebhookLLM(llm.LLM):
    def __init__(
        self,
        *,
        app_base_url: str,
        webhook_secret: str,
        call_id: str,
    ) -> None:
        super().__init__()
        self._app_base_url = app_base_url.rstrip("/")
        self._webhook_secret = webhook_secret
        self._call_id = call_id

    @property
    def model(self) -> str:
        return "gemini-webhook"

    @property
    def provider(self) -> str:
        return "onework"

    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[Any] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> llm.LLMStream:
        return OneWorkWebhookLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options,
        )


def voice_assistant_enabled() -> bool:
    return os.environ.get("CALL_AI_VOICE_ASSISTANT", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def build_llm(call_id: str) -> OneWorkWebhookLLM | None:
    if not call_id or not voice_assistant_enabled():
        return None

    app_url = os.environ.get("NEXT_PUBLIC_APP_URL", "http://localhost:3000")
    secret = (
        os.environ.get("CALL_AI_LLM_WEBHOOK_SECRET", "").strip()
        or os.environ.get("AGORA_LLM_WEBHOOK_SECRET", "").strip()
        or "dev-local-llm-webhook-secret"
    )
    return OneWorkWebhookLLM(
        app_base_url=app_url,
        webhook_secret=secret,
        call_id=call_id,
    )
