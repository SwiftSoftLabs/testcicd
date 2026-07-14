"""
OneWork meeting assistant — LiveKit Python agent.

STT captions via faster-whisper + Silero VAD.
Optional voice LLM via Gemini webhook when CALL_AI_LLM_WEBHOOK_SECRET is set.

Run:
  python agent.py dev
  python agent.py start
"""

from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
)
from livekit.agents.stt import StreamAdapter
from livekit.agents.voice import room_io
from livekit.plugins import silero

from llm import build_llm, voice_assistant_enabled
from krisp_viva import build_krisp_viva_processor, room_input_options
from transcription import FasterWhisperSTT
from whisper_config import (
    runtime_summary as whisper_runtime_summary,
    silero_activation_threshold,
    silero_min_silence_duration,
    silero_prefix_padding_duration,
)

load_dotenv()

logger = logging.getLogger("onework-agent")

AGENT_NAME = os.environ.get("LIVEKIT_AGENT_NAME", "onework-meeting-assistant")

# Whisper + VAD can take >10s on a 2 GB VPS; LiveKit defaults to 10s process init.
INITIALIZE_PROCESS_TIMEOUT_S = float(
    os.environ.get("AGENT_INITIALIZE_PROCESS_TIMEOUT", "180"),
)


def prewarm(proc: JobProcess) -> None:
    """Load heavy STT models once per job process (not on every room join)."""
    logger.info("prewarm: loading VAD + whisper (%s)…", whisper_runtime_summary())
    proc.userdata["vad"] = silero.VAD.load(
        min_silence_duration=silero_min_silence_duration(),
        prefix_padding_duration=silero_prefix_padding_duration(),
        activation_threshold=silero_activation_threshold(),
    )
    proc.userdata["whisper"] = FasterWhisperSTT()
    proc.userdata["stt"] = StreamAdapter(
        stt=proc.userdata["whisper"],
        vad=proc.userdata["vad"],
    )
    logger.info("prewarm: STT ready")


class MeetingAssistant(Agent):
    def __init__(self, *, call_id: str, workspace_id: str) -> None:
        super().__init__(
            instructions=(
                "You are the OneWork meeting assistant. Be concise for voice. "
                "Use only facts from the conversation and workspace context."
            ),
        )
        self._call_id = call_id
        self._workspace_id = workspace_id


async def entrypoint(ctx: JobContext) -> None:
    metadata: dict[str, str] = {}
    if ctx.job.metadata:
        try:
            metadata = json.loads(ctx.job.metadata)
        except json.JSONDecodeError:
            logger.warning("Invalid job metadata: %s", ctx.job.metadata)

    call_id = metadata.get("call_id", "")
    workspace_id = metadata.get("workspace_id", "")

    logger.info(
        "onework agent joining room=%s call_id=%s whisper=%s",
        ctx.room.name,
        call_id,
        whisper_runtime_summary(),
    )

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    vad = ctx.proc.userdata["vad"]
    stt = ctx.proc.userdata["stt"]
    logger.info("STT model ready (prewarmed)")

    llm_instance = build_llm(call_id) if call_id else None
    if voice_assistant_enabled():
        logger.info("voice assistant LLM enabled (CALL_AI_VOICE_ASSISTANT=true)")
    else:
        logger.info("STT-only mode (set CALL_AI_VOICE_ASSISTANT=true for spoken LLM replies)")

    krisp_processor = build_krisp_viva_processor()

    session = AgentSession(
        stt=stt,
        vad=vad,
        **({"llm": llm_instance} if llm_instance else {}),
    )

    @session.on("user_input_transcribed")
    def _on_user_transcribed(ev) -> None:
        if ev.is_final and ev.transcript:
            logger.info("caption [%s]: %s", ev.language, ev.transcript)

    await session.start(
        agent=MeetingAssistant(call_id=call_id, workspace_id=workspace_id),
        room=ctx.room,
        room_input_options=room_input_options(krisp_processor),
        room_output_options=room_io.RoomOutputOptions(
            transcription_enabled=True,
            audio_enabled=False,
        ),
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=AGENT_NAME,
            # 2 GB VPS: avoid idle child processes holding Whisper in RAM.
            num_idle_processes=0,
            initialize_process_timeout=INITIALIZE_PROCESS_TIMEOUT_S,
        )
    )
