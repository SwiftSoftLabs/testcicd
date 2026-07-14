"""Environment-driven faster-whisper settings tuned for meeting accuracy."""

from __future__ import annotations

import os
import platform
from pathlib import Path

_AGENT_DIR = Path(__file__).resolve().parent


def _env_str(name: str, default: str) -> str:
    raw = os.environ.get(name, default).strip()
    if not raw:
        return default
    # Inline comments in .env (e.g. "int8  # note") break ctranslate2 compute types.
    if "#" in raw:
        raw = raw.split("#", 1)[0].strip()
    return raw or default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    return int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    return float(raw)


def whisper_download_root() -> str:
    """Directory for faster-whisper model weights (gitignored under .cache/whisper)."""
    explicit = os.environ.get("WHISPER_DOWNLOAD_ROOT", "").strip()
    if explicit:
        return explicit
    return str(_AGENT_DIR / ".cache" / "whisper")


def whisper_model_size() -> str:
    # distil-large-v3: strong accuracy with reasonable CPU latency (vs base.en).
    # Set WHISPER_MODEL_SIZE=large-v3 for maximum quality on capable hardware.
    return _env_str("WHISPER_MODEL_SIZE", "distil-large-v3")


def whisper_language() -> str:
    return _env_str("WHISPER_LANGUAGE", "en")


def whisper_initial_prompt() -> str:
    return _env_str(
        "WHISPER_INITIAL_PROMPT",
        "OneWork video meeting. Participants discuss projects, tasks, deadlines, "
        "action items, pull requests, and workspace updates.",
    )


def whisper_device() -> str:
    explicit = os.environ.get("WHISPER_DEVICE", "").strip()
    if explicit and explicit != "auto":
        return explicit

    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:
        pass

    return "cpu"


def whisper_compute_type(device: str) -> str:
    explicit = os.environ.get("WHISPER_COMPUTE_TYPE", "").strip()
    if explicit:
        return explicit
    if device == "cuda":
        return "float16"
    # Apple Silicon / some ARM hosts lack int8_float16 kernels in ctranslate2.
    if platform.machine().lower() in ("arm64", "aarch64"):
        return "int8"
    # int8_float16 retains more precision than int8 on x86 CPU.
    return "int8_float16"


def whisper_beam_size() -> int:
    return _env_int("WHISPER_BEAM_SIZE", 3)


def whisper_best_of() -> int:
    return _env_int("WHISPER_BEST_OF", 3)


def whisper_patience() -> float:
    return _env_float("WHISPER_PATIENCE", 1.0)


def whisper_no_speech_threshold() -> float:
    return _env_float("WHISPER_NO_SPEECH_THRESHOLD", 0.5)


def whisper_logprob_threshold() -> float:
    return _env_float("WHISPER_LOGPROB_THRESHOLD", -1.0)


def whisper_compression_ratio_threshold() -> float:
    return _env_float("WHISPER_COMPRESSION_RATIO_THRESHOLD", 2.4)


def silero_min_silence_duration() -> float:
    return _env_float("SILERO_MIN_SILENCE_DURATION", 0.35)


def silero_prefix_padding_duration() -> float:
    return _env_float("SILERO_PREFIX_PADDING_DURATION", 0.35)


def silero_activation_threshold() -> float:
    return _env_float("SILERO_ACTIVATION_THRESHOLD", 0.45)


def runtime_summary() -> str:
    device = whisper_device()
    return (
        f"model={whisper_model_size()} device={device} "
        f"compute={whisper_compute_type(device)} lang={whisper_language()} "
        f"beam={whisper_beam_size()} host={platform.machine()}"
    )
