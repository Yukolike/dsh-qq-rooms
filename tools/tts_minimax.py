#!/usr/bin/env python3
"""MiniMax T2A v2 wrapper for dsh-qq-rooms.

The plugin calls this with a UTF-8 text file and an output path:

    python tts_minimax.py --text "{text}" --out "{out}" --voice "{voice}"

The API key is read from MINIMAX_API_KEY or ~/.dsh/minimax-api-key.txt,
never from the plugin settings (so it does not end up in the settings page
or in the command template).
"""

import argparse
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request


def read_key() -> str:
    env = os.environ.get("MINIMAX_API_KEY", "").strip()
    if env:
        return env
    path = pathlib.Path(
        os.environ.get("MINIMAX_KEY_FILE")
        or (pathlib.Path.home() / ".dsh" / "minimax-api-key.txt")
    )
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def fail(message: str, code: int = 1) -> int:
    print(message, file=sys.stderr)
    return code


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", required=True, help="path to UTF-8 text file")
    ap.add_argument("--out", required=True, help="path to output audio file")
    ap.add_argument("--voice", default="Chinese (Mandarin)_Warm_Girl")
    ap.add_argument("--model", default="speech-2.8-hd")
    ap.add_argument("--speed", type=float, default=1.05)
    ap.add_argument("--pitch", type=int, default=1)
    ap.add_argument("--emotion", default="")
    ap.add_argument("--host", default=os.environ.get("MINIMAX_API_HOST", "https://api.minimaxi.com"))
    ap.add_argument("--timeout", type=float, default=45)
    args = ap.parse_args()

    try:
        text = pathlib.Path(args.text).read_text(encoding="utf-8").strip()
    except OSError as error:
        return fail(f"读不了文字文件：{error}")
    if not text:
        return fail("文字是空的")
    # The API caps a request at 10,000 characters; the plugin already clamps,
    # this is just a safety net.
    text = text[:9000]

    voice_setting = {
        "voice_id": args.voice,
        "speed": max(0.5, min(float(args.speed), 2.0)),
        "pitch": max(-12, min(int(args.pitch), 12)),
    }
    if args.emotion:
        voice_setting["emotion"] = args.emotion

    body = {
        "model": args.model,
        "text": text,
        "stream": False,
        "language_boost": "auto",
        "voice_setting": voice_setting,
        "audio_setting": {
            "format": "mp3",
            "sample_rate": 32000,
            "bitrate": 128000,
            "channel": 1,
        },
    }

    key = read_key()
    if not key:
        return fail("没有 MiniMax API key：设 MINIMAX_API_KEY 或写 ~/.dsh/minimax-api-key.txt")

    url = args.host.rstrip("/") + "/v1/t2a_v2"
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "authorization": "Bearer " + key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        return fail(f"MiniMax HTTP {error.code}: {detail}", 2)
    except Exception as error:  # noqa: BLE001 - CLI boundary
        return fail(f"MiniMax 请求失败：{type(error).__name__}: {error}", 2)

    base = payload.get("base_resp") or {}
    if base.get("status_code") != 0:
        return fail(
            f"MiniMax {base.get('status_code')}: {base.get('status_msg') or 'unknown error'}",
            3,
        )

    audio_hex = (payload.get("data") or {}).get("audio") or ""
    if not audio_hex:
        return fail("MiniMax 没返回音频", 4)

    try:
        audio = bytes.fromhex(audio_hex)
    except ValueError:
        return fail("MiniMax 返回的音频不是十六进制", 4)
    if not audio:
        return fail("MiniMax 返回了空音频", 4)

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
