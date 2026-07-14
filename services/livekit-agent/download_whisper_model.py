#!/usr/bin/env python3
"""Pre-download faster-whisper weights (reads WHISPER_* from .env if present)."""

from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv
from faster_whisper import WhisperModel

from whisper_config import (
    runtime_summary,
    whisper_compute_type,
    whisper_device,
    whisper_download_root,
    whisper_model_size,
)


def main() -> int:
    load_dotenv(Path(__file__).resolve().parent / ".env")

    model_size = whisper_model_size()
    device = whisper_device()
    compute_type = whisper_compute_type(device)
    download_root = whisper_download_root()

    print(f"Downloading faster-whisper model: {runtime_summary()}")
    print(f"Cache directory: {download_root}")
    print("(~1.5 GB for distil-large-v3 — may take several minutes)")

    Path(download_root).mkdir(parents=True, exist_ok=True)

    WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
        download_root=download_root,
    )

    print(f"Done. Model '{model_size}' is ready at {download_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
