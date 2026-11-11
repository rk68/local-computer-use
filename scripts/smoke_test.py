#!/usr/bin/env python3
"""Send text and optional image input to the local Holo4 server. No dependencies."""

import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8080"
# Local inference must not pass through an HTTP proxy.
HTTP = build_opener(ProxyHandler({}))


def request(path, payload=None, timeout=600):
    data = None if payload is None else json.dumps(payload).encode()
    req = Request(BASE + path, data=data, headers={"Content-Type": "application/json"})
    try:
        with HTTP.open(req, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode(errors='replace')}") from exc


def image_part(path):
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    else:
        raise ValueError("Use a PNG or JPEG screenshot.")
    encoded = base64.b64encode(data).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}


def complete(content, max_tokens):
    started = time.monotonic()
    result = request("/v1/chat/completions", {
        "model": "holo4",
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
        "max_tokens": max_tokens,
        "stream": False,
    })
    choice = result["choices"][0]
    answer = choice["message"].get("content")
    if not isinstance(answer, str) or not answer.strip():
        raise RuntimeError("The server returned no answer. Inspect the log or increase --max-tokens.")
    print(answer, flush=True)
    if choice.get("finish_reason") == "length":
        raise RuntimeError("The response reached the token limit. Retry with more --max-tokens.")
    return {"elapsed_seconds": round(time.monotonic() - started, 2), "response": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--image", type=Path, help="Path to a PNG or JPEG screenshot")
    group.add_argument("--capture", action="store_true", help="Capture the main Mac display for local inference")
    parser.add_argument("--prompt", default="Describe this screenshot. Name three visible UI elements and their approximate positions.")
    parser.add_argument("--max-tokens", type=int, default=1024)
    args = parser.parse_args()
    if args.max_tokens < 1:
        parser.error("--max-tokens must be positive")

    print("Checking server health...", flush=True)
    health = request("/health", timeout=10)
    if health.get("status") != "ok":
        raise RuntimeError(f"Server is not ready: {health}")
    models = request("/v1/models", timeout=10)
    if "holo4" not in {item["id"] for item in models["data"]}:
        raise RuntimeError("The server does not list holo4. Run scripts/serve.sh.")

    report = {"timestamp": datetime.now(timezone.utc).isoformat(), "base_url": BASE, "models": models}
    print("\nText inference:", flush=True)
    report["text"] = complete("In two sentences, explain what tools you would need to control a desktop computer.", args.max_tokens)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    artifacts = ROOT / "artifacts"
    artifacts.mkdir(exist_ok=True)
    image = args.image
    if args.capture:
        image = artifacts / f"screenshot-{stamp}.png"
        subprocess.run(["/usr/sbin/screencapture", "-x", "-m", str(image)], check=True)
    if image:
        report["image_path"] = str(image.resolve())
        print(f"\nVision inference: {image}", flush=True)
        report["vision"] = complete([image_part(image), {"type": "text", "text": args.prompt}], args.max_tokens)
        report["visual_accuracy"] = "pending human inspection"
        print("\nImage request succeeded. Compare the answer with the screenshot.")
    else:
        print("\nText request succeeded. Vision remains untested. Use --image or --capture.")
    output = artifacts / f"smoke-{stamp}.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Evidence: {output}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, URLError, OSError, ValueError, KeyError, IndexError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
