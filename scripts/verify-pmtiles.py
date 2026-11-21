#!/usr/bin/env python3
"""Minimal PMTiles v3 archive header sanity check (not full tile validation)."""
import pathlib
import sys

def verify(path):
    p = pathlib.Path(path)
    with p.open("rb") as stream:
        header = stream.read(127)
    if len(header) != 127:
        raise ValueError("PMTiles header is truncated")
    if header[:7] != b"PMTiles" or header[7] != 3:
        raise ValueError("Expected PMTiles v3 magic and version")
    if p.stat().st_size <= 127:
        raise ValueError("PMTiles archive has no payload")
    print(f"PMTiles v3 header OK: {p} ({p.stat().st_size} bytes)")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: verify-pmtiles.py <archive.pmtiles>")
    try:
        verify(sys.argv[1])
    except (OSError, ValueError) as exc:
        sys.exit(f"PMTiles validation failed: {exc}")
