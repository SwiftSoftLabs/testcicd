#!/usr/bin/env bash
# Re-encode public/demo.mp4 for homepage About section (~2–5MB target).
# Requires ffmpeg: brew install ffmpeg
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/public/demo.mp4"
OUT="$ROOT/public/demo.optimized.mp4"

ffmpeg -y -i "$SRC" \
  -vf "scale='min(1920,iw)':-2" \
  -c:v libx264 -preset slow -crf 28 \
  -movflags +faststart \
  -an \
  "$OUT"

echo "Wrote $OUT ($(du -h "$OUT" | cut -f1)). Review, then:"
echo "  mv \"$OUT\" \"$SRC\""
