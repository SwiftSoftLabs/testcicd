"""High-accuracy faster-whisper STT (StreamAdapter + Silero VAD)."""

from __future__ import annotations

import asyncio
import logging

import numpy as np
from faster_whisper import WhisperModel
from livekit import rtc
from livekit.agents import stt
from livekit.agents.types import APIConnectOptions
from livekit.agents.utils import AudioBuffer, merge_frames

from whisper_config import (
    whisper_beam_size,
    whisper_best_of,
    whisper_compression_ratio_threshold,
    whisper_compute_type,
    whisper_device,
    whisper_download_root,
    whisper_initial_prompt,
    whisper_language,
    whisper_logprob_threshold,
    whisper_model_size,
    whisper_no_speech_threshold,
    whisper_patience,
    runtime_summary,
)

logger = logging.getLogger("onework-agent")

WHISPER_SAMPLE_RATE = 16_000


def _to_mono_pcm(frame: rtc.AudioFrame) -> np.ndarray:
    """Convert LiveKit PCM int16 frame to float32 mono in [-1, 1]."""
    pcm = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0
    if frame.num_channels > 1:
        pcm = pcm.reshape(-1, frame.num_channels).mean(axis=1)
    return pcm


def _resample_pcm(pcm: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate or pcm.size == 0:
        return pcm
    target_len = max(1, int(round(pcm.size * target_rate / source_rate)))
    source_idx = np.arange(pcm.size, dtype=np.float64)
    target_idx = np.linspace(0, pcm.size - 1, target_len)
    return np.interp(target_idx, source_idx, pcm).astype(np.float32)


class FasterWhisperSTT(stt.STT):
    """Batch whisper — pair with ``StreamAdapter`` + Silero VAD in the agent."""

    def __init__(self, *, model_size: str | None = None) -> None:
        super().__init__(
            capabilities=stt.STTCapabilities(
                streaming=False,
                interim_results=False,
                offline_recognize=True,
            ),
        )
        self._model_name = model_size or whisper_model_size()
        device = whisper_device()
        compute_type = whisper_compute_type(device)
        logger.info("Loading faster-whisper: %s", runtime_summary())
        self._model = WhisperModel(
            self._model_name,
            device=device,
            compute_type=compute_type,
            download_root=whisper_download_root(),
        )
        self._language = whisper_language()
        self._initial_prompt = whisper_initial_prompt()
        self._utterance_timeline_s = 0.0

    @property
    def model(self) -> str:
        return self._model_name

    @property
    def provider(self) -> str:
        return "faster-whisper"

    async def _recognize_impl(
        self,
        buffer: AudioBuffer,
        *,
        language: str | None = None,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        frame = merge_frames(buffer) if isinstance(buffer, list) else buffer
        pcm = _to_mono_pcm(frame)
        pcm = _resample_pcm(pcm, frame.sample_rate, WHISPER_SAMPLE_RATE)

        if pcm.size == 0:
            return stt.SpeechEvent(
                type=stt.SpeechEventType.FINAL_TRANSCRIPT,
                alternatives=[],
            )

        lang = (language or self._language or "en").split("-")[0]

        def _transcribe() -> str:
            segments, info = self._model.transcribe(
                pcm,
                language=lang,
                task="transcribe",
                # Silero VAD already segments utterances — avoid double-filtering.
                vad_filter=False,
                beam_size=whisper_beam_size(),
                best_of=whisper_best_of(),
                patience=whisper_patience(),
                temperature=0.0,
                # Avoid repeating earlier phrases in each new VAD segment.
                condition_on_previous_text=False,
                initial_prompt=self._initial_prompt,
                no_speech_threshold=whisper_no_speech_threshold(),
                log_prob_threshold=whisper_logprob_threshold(),
                compression_ratio_threshold=whisper_compression_ratio_threshold(),
                without_timestamps=True,
            )
            return " ".join(seg.text.strip() for seg in segments).strip()

        text = await asyncio.to_thread(_transcribe)

        if text:
            logger.info("whisper segment: %s", text[:120])

        duration_s = float(frame.duration)
        start_time = self._utterance_timeline_s
        end_time = start_time + duration_s
        self._utterance_timeline_s = end_time

        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[
                stt.SpeechData(
                    text=text,
                    language=lang,
                    start_time=start_time,
                    end_time=end_time,
                )
            ],
        )
