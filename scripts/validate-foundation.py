#!/usr/bin/env python3
"""Dependency-free static validation for the first KUNDE Maps vertical slice."""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
STYLE = ROOT / "apps/web/style.json"
CONFIG = ROOT / "apps/web/config.example.json"

def validate():
    style = json.loads(STYLE.read_text(encoding="utf-8"))
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    assert style["version"] == 8, "MapLibre style must be version 8"
    assert style["sources"]["kunde"]["type"] == "vector"
    source = style["sources"]["kunde"]
    assert source["url"].startswith("pmtiles://http://localhost:8080/tiles/"), "Expected self-hosted PMTiles URL"
    assert "OpenStreetMap" in source["attribution"], "OSM attribution required"
    assert config["styleUrl"] == "http://localhost:8080/style.json"
    ids = [layer["id"] for layer in style["layers"]]
    assert len(ids) == len(set(ids)), "Duplicate style layer ID"
    # Roads are split by class (road-motorway, road-primary, ... plus casings), so require any road layer.
    assert "background" in ids and any(i.startswith("road") for i in ids), "Essential map layers missing"
    for layer in style["layers"]:
        if "source" in layer:
            assert layer["source"] in style["sources"], f"Unknown source in {layer['id']}"
            assert layer.get("source-layer"), f"Missing vector source-layer in {layer['id']}"
    html = (ROOT / "apps/web/index.html").read_text(encoding="utf-8")
    js = (ROOT / "apps/web/map.js").read_text(encoding="utf-8")
    assert "pmtiles" in html.lower() and "maplibre" in html.lower()
    assert "maplibregl.addProtocol('pmtiles'" in js
    assert "new maplibregl.Map" in js
    compose = (ROOT / "infrastructure/maps/docker-compose.yml").read_text(encoding="utf-8")
    assert "127.0.0.1:8080:80" in compose, "Local preview must bind loopback"
    assert (ROOT / "scripts/build-kazakhstan-tiles.sh").exists()
    print("Static foundation validation: OK (does not verify tile generation or rendering)")

if __name__ == "__main__":
    try:
        validate()
    except (AssertionError, ValueError, KeyError, OSError) as exc:
        print(f"Foundation validation FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
