#!/usr/bin/env python3
"""Read-only deployment readiness probe. No credentials, no cloud changes."""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            return response.status, dict(response.headers), response.read(1024 * 1024)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), b""

def check(origin):
    origin = origin.rstrip("/") + "/"
    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("Expected HTTP(S) URL")
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
        raise ValueError("Remote deployment must use HTTPS")
    for path in ("", "config.json", "style.json", "style-dark.json"):
        status, headers, data = get(urllib.parse.urljoin(origin, path))
        if status != 200:
            raise ValueError(f"/{path}: expected 200, got {status}")
        if path.startswith("style") and "no-cache" not in {k.lower(): v for k, v in headers.items()}.get("cache-control", ""):
            raise ValueError(f"/{path}: styles must be served with Cache-Control: no-cache so releases take effect")
        if path == "style-dark.json" and json.loads(data).get("version") != 8:
            raise ValueError("Invalid dark MapLibre style")
        if path == "config.json":
            config = json.loads(data)
        if path == "style.json":
            style = json.loads(data)
    if style.get("version") != 8:
        raise ValueError("Invalid MapLibre style")
    style_url = urllib.parse.urljoin(origin, config["styleUrl"])
    if urllib.parse.urlparse(style_url).netloc != parsed.netloc:
        raise ValueError("Style URL points to an unexpected host")
    tile_urls = [source["url"][len("pmtiles://"):] for source in style.get("sources", {}).values()
                 if source.get("url", "").startswith("pmtiles://")]
    if not tile_urls:
        raise ValueError("No PMTiles vector source configured")
    if config.get("tileUrl"):
        remote = urllib.parse.urlparse(config["tileUrl"])
        if remote.scheme != "https" or not remote.path.endswith(".pmtiles"):
            raise ValueError("Remote tileUrl must be an HTTPS .pmtiles URL")
        tile_urls = [config["tileUrl"] for _ in tile_urls]
    for url in tile_urls:
        if url.startswith("http://localhost:8080/"):
            url = urllib.parse.urljoin(origin, url[len("http://localhost:8080/"):])
        target = urllib.parse.urlparse(url)
        if target.scheme != "https" and not (
            target.scheme == "http" and target.hostname in ("localhost", "127.0.0.1")
        ):
            raise ValueError("Tile URL must use HTTPS except localhost")
        status, headers, data = get(url, {"Range": "bytes=0-15"})
        if status != 206:
            print(f"PREVIEW ONLY: tiles not ready ({status}): {url}")
            return 2
        content_range = headers.get("Content-Range", "")
        if not content_range.startswith("bytes 0-15/") or len(data) != 16:
            raise ValueError("Tile server has broken Range response")
    print("READY: web endpoints and tile range probes passed")
    return 0

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: check-deployment.py https://your-maps-host")
    try:
        sys.exit(check(sys.argv[1]))
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
        sys.exit(f"NOT READY: {exc}")
