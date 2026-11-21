"""Provision a verified SQLite search index before the Search API starts.

Sources are tried in order (primary R2 public URL, then optional fallback such as a
GitHub Release asset). Every candidate must pass: SHA256 match, SQLite quick_check and a
minimum row count. The file is replaced atomically, and an already-verified local copy is
reused instead of downloading again.

Environment:
  MAPS_SEARCH_INDEX_URL           primary HTTPS URL of the .sqlite3 file (required)
  MAPS_SEARCH_INDEX_FALLBACK_URL  optional second HTTPS URL for the same file
  MAPS_SEARCH_INDEX_SHA256        pinned expected SHA256 (preferred, strongest)
  MAPS_SEARCH_INDEX_SHA256_URL    otherwise: .sha256 sidecar on the same host as the index
                                  (defaults to the index URL with .sqlite3 -> .sha256)
  MAPS_SEARCH_DB                  destination path
  MAPS_SEARCH_MIN_ROWS            minimum rows in `places` (default 1000)

Why a custom User-Agent: Cloudflare (r2.dev) answers the default `Python-urllib/x.y`
User-Agent with HTTP 403 "error code: 1010" (browser-signature block), while the very same
object is served normally to other clients.
"""
import hashlib
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

USER_AGENT = "kunde-maps-search-provisioner/1.0 (+https://github.com/ADatkashov/kunde-maps)"
MAX_BYTES = 1024 * 1024 * 1024
ATTEMPTS = 3
BACKOFF_SECONDS = 2.0
CONNECT_TIMEOUT = 60
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


class SourceError(Exception):
    """A single source failed; the next source may still work."""


def describe(url):
    """Log-safe description: host and file name only, never query strings or credentials."""
    parts = urlsplit(url)
    return f"{parts.hostname}/{parts.path.rsplit('/', 1)[-1]}"


def check_url(url, what):
    parts = urlsplit(url)
    if parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOOPBACK_HOSTS):
        return parts
    raise SystemExit(f"{what} must be an HTTPS URL")


def sidecar_for(index_url, explicit=""):
    sidecar = explicit or (index_url[: -len(".sqlite3")] + ".sha256" if index_url.endswith(".sqlite3") else "")
    if not sidecar:
        raise SystemExit("Set MAPS_SEARCH_INDEX_SHA256 or MAPS_SEARCH_INDEX_SHA256_URL")
    a, b = check_url(index_url, "Index URL"), check_url(sidecar, "Checksum URL")
    if a.netloc != b.netloc or not b.path.endswith(".sha256"):
        raise SystemExit("Checksum must be a .sha256 file on the same host as the index")
    return sidecar


def parse_sha256(text):
    token = (text.split() or [""])[0].lower()
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("not a SHA256 hex digest")
    return token


def open_url(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    return urllib.request.urlopen(request, timeout=CONNECT_TIMEOUT)


def with_retries(label, action):
    """Run action(); retry transient failures (network, 5xx, 429) with exponential backoff."""
    last = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return action()
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code} {exc.reason}"
            if exc.code < 500 and exc.code != 429:
                break  # 403/404 and similar are not transient
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        if attempt < ATTEMPTS:
            delay = BACKOFF_SECONDS * 2 ** (attempt - 1)
            print(f"{label}: {last}; retry {attempt}/{ATTEMPTS - 1} in {delay:.0f}s", flush=True)
            time.sleep(delay)
    raise SourceError(f"{label}: {last}")


def fetch_checksum(url):
    def action():
        with open_url(url) as response:
            return parse_sha256(response.read(4096).decode("ascii", "replace"))
    return with_retries(f"checksum {describe(url)}", action)


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def validate_sqlite(path, min_rows):
    """Raise ValueError unless the file is an intact SQLite index with enough rows."""
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("SQLite quick_check failed")
            rows = db.execute("SELECT count(*) FROM places").fetchone()[0]
            db.execute("SELECT count(*) FROM places_fts WHERE places_fts MATCH ?", ('"a"*',)).fetchone()
        finally:
            db.close()
    except sqlite3.Error as exc:
        raise ValueError(f"not a valid search index: {exc}") from exc
    if rows < min_rows:
        raise ValueError(f"index unexpectedly small: {rows} rows < {min_rows}")
    return rows


def download(url, temp, expected):
    """Stream url to temp while hashing; raise SourceError on any mismatch."""
    def action():
        digest, size = hashlib.sha256(), 0
        with open_url(url) as response, temp.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError("index exceeds the 1 GiB limit")
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        return digest.hexdigest(), size
    try:
        actual, size = with_retries(f"download {describe(url)}", action)
    except ValueError as exc:
        raise SourceError(f"download {describe(url)}: {exc}") from exc
    if actual != expected:
        raise SourceError(f"download {describe(url)}: SHA256 mismatch (got {actual[:12]}..., want {expected[:12]}...)")
    return size


def provision(env=None):
    env = os.environ if env is None else env
    primary = env.get("MAPS_SEARCH_INDEX_URL", "")
    fallback = env.get("MAPS_SEARCH_INDEX_FALLBACK_URL", "")
    pinned = env.get("MAPS_SEARCH_INDEX_SHA256", "").strip().lower()
    sidecar_url = env.get("MAPS_SEARCH_INDEX_SHA256_URL", "")
    dest = Path(env.get("MAPS_SEARCH_DB", "/data/kazakhstan-search.sqlite3"))
    min_rows = int(env.get("MAPS_SEARCH_MIN_ROWS", "1000"))

    if not primary:
        raise SystemExit("MAPS_SEARCH_INDEX_URL is required")
    sources = [u for u in (primary, fallback) if u]
    for url in sources:
        check_url(url, "Index URL")
    if pinned:
        try:
            parse_sha256(pinned)
        except ValueError:
            raise SystemExit("MAPS_SEARCH_INDEX_SHA256 must be a 64-character hex digest") from None

    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(dest.name + ".download")
    errors = []
    try:
        for index, url in enumerate(sources):
            try:
                expected = pinned or fetch_checksum(sidecar_for(url, sidecar_url if index == 0 else ""))
                if dest.is_file() and sha256_of(dest) == expected:
                    try:
                        rows = validate_sqlite(dest, min_rows)
                        print(f"Reusing verified local index ({rows} rows, sha256 {expected[:12]}...)", flush=True)
                        return dest
                    except ValueError as exc:
                        print(f"Local copy rejected: {exc}", flush=True)
                size = download(url, temp, expected)
                try:
                    rows = validate_sqlite(temp, min_rows)
                except ValueError as exc:
                    raise SourceError(f"{describe(url)}: {exc}") from exc
                os.replace(temp, dest)  # atomic on the same filesystem
                print(f"Verified index ready from {describe(url)}: {size} bytes, {rows} rows", flush=True)
                return dest
            except SourceError as exc:
                errors.append(str(exc))
                print(f"Source failed: {exc}", flush=True)
    finally:
        temp.unlink(missing_ok=True)
    raise SystemExit("Search index unavailable from all sources:\n  " + "\n  ".join(errors))


if __name__ == "__main__":
    try:
        provision()
    except SystemExit as exc:
        if exc.code not in (0, None):
            print(f"FATAL: {exc.code}", file=sys.stderr, flush=True)
        raise
