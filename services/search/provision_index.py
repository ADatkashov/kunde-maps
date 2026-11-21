"""Download a versioned, verified SQLite index before starting the search API."""
import hashlib
import os
from pathlib import Path
from urllib.request import urlopen

URL = os.environ.get("MAPS_SEARCH_INDEX_URL", "")
SHA256 = os.environ.get("MAPS_SEARCH_INDEX_SHA256", "").lower()
SHA256_URL = os.environ.get("MAPS_SEARCH_INDEX_SHA256_URL", "")
DEST = Path(os.environ.get("MAPS_SEARCH_DB", "/data/kazakhstan-search.sqlite3"))
MAX_BYTES = 1024 * 1024 * 1024


def provision():
    expected = SHA256
    if SHA256_URL:
        from urllib.parse import urlsplit
        index_url = urlsplit(URL)
        checksum_url = urlsplit(SHA256_URL)
        if (index_url.scheme != "https" or checksum_url.scheme != "https"
                or index_url.netloc != checksum_url.netloc
                or not checksum_url.path.endswith(".sha256")):
            raise SystemExit("Checksum must be HTTPS on the same index host")
        with urlopen(SHA256_URL, timeout=30) as response:
            expected = response.read(256).decode("ascii").split()[0].lower()
    if not URL.startswith("https://") or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise SystemExit("Valid HTTPS index URL and SHA256 are required")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    temp = DEST.with_suffix(".download")
    digest = hashlib.sha256()
    size = 0
    try:
        with urlopen(URL, timeout=90) as response, temp.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError("Index exceeds configured 1 GiB limit")
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected:
            raise ValueError("Index SHA256 mismatch")
        import sqlite3
        with sqlite3.connect(f"file:{temp}?mode=ro", uri=True) as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("SQLite integrity check failed")
            if db.execute("SELECT count(*) FROM places").fetchone()[0] < 1000:
                raise ValueError("Index unexpectedly small")
        temp.replace(DEST)
        print(f"Verified index ready: {size} bytes", flush=True)
    finally:
        temp.unlink(missing_ok=True)


if __name__ == "__main__":
    provision()
