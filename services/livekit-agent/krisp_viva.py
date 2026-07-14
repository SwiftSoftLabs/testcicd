"""Optional Krisp VIVA server-side noise filter for the meeting agent (Hetzner/on-prem)."""

from __future__ import annotations

import dataclasses
import logging
import os
from typing import Any

from livekit.agents.voice import room_io

logger = logging.getLogger("onework-agent")


def krisp_viva_enabled() -> bool:
    return os.environ.get("KRISP_VIVA_ENABLED", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def build_krisp_viva_processor() -> Any | None:
    if not krisp_viva_enabled():
        return None

    model_path = os.environ.get("KRISP_VIVA_FILTER_MODEL_PATH", "").strip()
    if not model_path:
        logger.warning("KRISP_VIVA_ENABLED but KRISP_VIVA_FILTER_MODEL_PATH is unset")
        return None

    try:
        from livekit.plugins import krisp

        level = int(os.environ.get("KRISP_VIVA_NOISE_SUPPRESSION_LEVEL", "100"))
        processor = krisp.KrispVivaFilterFrameProcessor(
            model_path=model_path,
            noise_suppression_level=level,
            frame_duration_ms=10,
        )
        logger.info("Krisp VIVA noise filter ready (model=%s)", model_path)
        return processor
    except Exception as exc:
        logger.warning("Krisp VIVA unavailable: %s", exc)
        return None


def room_input_options(krisp_processor: Any | None) -> room_io.RoomInputOptions:
    """Build RoomInputOptions, attaching Krisp when supported by installed livekit-agents."""
    opts: dict[str, Any] = {"close_on_disconnect": False}
    if krisp_processor is not None:
        field_names = {f.name for f in dataclasses.fields(room_io.RoomInputOptions)}
        if "noise_cancellation" in field_names:
            opts["noise_cancellation"] = krisp_processor
        else:
            logger.warning(
                "livekit-agents RoomInputOptions lacks noise_cancellation; "
                "upgrade livekit-agents and install livekit-plugins-krisp"
            )
    return room_io.RoomInputOptions(**opts)
