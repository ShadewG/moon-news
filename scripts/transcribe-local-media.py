#!/usr/bin/env python3

import argparse
import json
import os
from pathlib import Path

from faster_whisper import WhisperModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="base.en")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cpu_threads = max(1, min(8, os.cpu_count() or 1))
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=cpu_threads)
    segments_iter, info = model.transcribe(
        str(input_path),
        language="en",
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )

    segments = []
    for segment in segments_iter:
        text = (segment.text or "").strip()
        if not text:
            continue
        start_ms = max(0, round(float(segment.start) * 1000))
        end_ms = max(start_ms, round(float(segment.end) * 1000))
        segments.append(
            {
                "text": text,
                "startMs": start_ms,
                "durationMs": max(0, end_ms - start_ms),
            }
        )

    payload = {
        "input": str(input_path),
        "model": args.model,
        "language": getattr(info, "language", None),
        "durationSeconds": getattr(info, "duration", None),
        "segments": segments,
    }

    output_path.write_text(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
