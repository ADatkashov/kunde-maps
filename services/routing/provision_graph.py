"""Provision a verified Valhalla tile extract (valhalla-tiles.tar) before the routing API starts.

Same trust model as the search index provisioner (it reuses its helpers): HTTPS (or loopback) URL, SHA256 sidecar on the same host or a pinned
digest, bounded retries, custom User-Agent (Cloudflare blocks the default Python one), atomic replace, reuse of an already verified local copy.

Environment:
  MAPS_ROUTING_GRAPH_URL         HTTPS URL of valhalla-tiles.tar (required)
  MAPS_ROUTING_GRAPH_SHA256      pinned digest (optional; otherwise the .sha256 sidecar next to the URL)
  MAPS_ROUTING_GRAPH             destination path (default /data/valhalla-tiles.tar)
  MAPS_ROUTING_MIN_BYTES         minimum accepted size (default 50 MB; the Kazakhstan graph is ~290 MB)
"""
import os
import sys
import tarfile
from pathlib import Path

import provision_index as base


def validate_tar(path, min_bytes):
    size = Path(path).stat().st_size
    if size < min_bytes:
        raise ValueError(f"graph unexpectedly small: {size} bytes < {min_bytes}")
    if not tarfile.is_tarfile(path):
        raise ValueError("not a tar archive")
    return size


def provision(env=None):
    env = os.environ if env is None else env
    url = env.get("MAPS_ROUTING_GRAPH_URL", "")
    pinned = env.get("MAPS_ROUTING_GRAPH_SHA256", "").strip().lower()
    dest = Path(env.get("MAPS_ROUTING_GRAPH", "/data/valhalla-tiles.tar"))
    min_bytes = int(env.get("MAPS_ROUTING_MIN_BYTES", str(50 * 1024 * 1024)))
    if not url:
        raise SystemExit("MAPS_ROUTING_GRAPH_URL is required")
    base.check_url(url, "Graph URL")
    if not url.endswith(".tar"):
        raise SystemExit("Graph URL must end with .tar")
    if pinned:
        try:
            base.parse_sha256(pinned)
        except ValueError:
            raise SystemExit("MAPS_ROUTING_GRAPH_SHA256 must be a 64-character hex digest") from None
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(dest.name + ".download")
    try:
        try:
            if pinned:
                expected = pinned
            else:
                sidecar = url[: -len(".tar")] + ".sha256"
                if base.check_url(url, "Graph URL").netloc != base.check_url(sidecar, "Checksum URL").netloc:
                    raise SystemExit("Checksum must be on the same host as the graph")
                expected = base.fetch_checksum(sidecar)
            if dest.is_file() and base.sha256_of(dest) == expected:
                try:
                    size = validate_tar(dest, min_bytes)
                    print(f"Reusing verified local graph ({size} bytes, sha256 {expected[:12]}...)", flush=True)
                    return dest
                except ValueError as exc:
                    print(f"Local copy rejected: {exc}", flush=True)
            size = base.download(url, temp, expected)
            try:
                validate_tar(temp, min_bytes)
            except ValueError as exc:
                raise base.SourceError(f"{base.describe(url)}: {exc}") from exc
            os.replace(temp, dest)
            print(f"Verified routing graph ready from {base.describe(url)}: {size} bytes", flush=True)
            return dest
        except base.SourceError as exc:
            raise SystemExit(f"Routing graph unavailable: {exc}") from None
    finally:
        temp.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        provision()
    except SystemExit as exc:
        if exc.code not in (0, None):
            print(f"FATAL: {exc.code}", file=sys.stderr, flush=True)
        raise
