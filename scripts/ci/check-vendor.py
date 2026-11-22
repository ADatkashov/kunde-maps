#!/usr/bin/env python3
"""Vendored libraries must match their recorded checksums, ship their licenses, and the page must not load third-party code."""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
WEB = ROOT / "apps" / "web"
VENDOR = WEB / "vendor"


def main():
    problems = []
    recorded = {}
    for line in (VENDOR / "CHECKSUMS.sha256").read_text(encoding="utf-8").splitlines():
        digest, _, name = line.partition("  ")
        recorded[name.strip()] = digest.strip()
    for name in ("maplibre-gl.js", "maplibre-gl.css", "pmtiles.js", "LICENSE-maplibre-gl.txt", "LICENSE-pmtiles.txt"):
        path = VENDOR / name
        if name not in recorded:
            problems.append(f"{name}: no recorded checksum")
        elif not path.is_file():
            problems.append(f"{name}: missing")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != recorded[name]:
            problems.append(f"{name}: checksum mismatch (modified or upgraded without updating CHECKSUMS.sha256)")
    for name in ("LICENSE-maplibre-gl.txt", "LICENSE-pmtiles.txt"):
        text = (VENDOR / name).read_text(encoding="utf-8", errors="replace")
        if "Redistribution and use" not in text and "BSD" not in text:
            problems.append(f"{name}: does not look like a BSD license text")
    html = (WEB / "index.html").read_text(encoding="utf-8")
    for match in re.finditer(r'<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"', html):
        if re.match(r"^(https?:)?//", match.group(1)):
            problems.append(f"index.html loads third-party resource: {match.group(1)}")
    if re.search(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", html):
        problems.append("index.html contains an inline script (the CSP forbids it)")
    if re.search(r"\bstyle=\"", html):
        problems.append("index.html contains an inline style attribute (the CSP forbids it)")
    for problem in problems:
        print("PROBLEM:", problem)
    print("Vendored libraries OK" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
