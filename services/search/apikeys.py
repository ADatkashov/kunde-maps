"""API keys for server-to-server clients (stdlib only). Keys raise the rate limit and give per-client quota and metrics.

* Only SHA-256 hashes live in configuration (`MAPS_API_KEYS`); the secret is shown once by `generate` and never stored or logged.
* Format: `name:sha256hex:requests_per_minute` entries separated by commas (name = [a-z0-9_-]{1,32}, a public label used in metrics).
* Keys travel in the `X-API-Key` header only (never in URLs, which end up in logs). They are NOT allowed cross-origin
  (browsers would expose them): the public web client uses anonymous per-IP limits.
"""
import hashlib
import hmac
import re
import secrets
import sys

NAME = re.compile(r"^[a-z0-9_-]{1,32}$")
HEX = re.compile(r"^[0-9a-f]{64}$")
PREFIX = "kmk_"


def digest(secret):
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def parse(value):
    """Return {sha256hex: (name, per_minute)}. Raises ValueError with a precise message on any malformed entry."""
    keys, names = {}, set()
    for entry in (value or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) != 3:
            raise ValueError("API key entry must be name:sha256hex:per_minute")
        name, hexdigest, rate = parts
        if not NAME.match(name) or name in names:
            raise ValueError(f"invalid or duplicate key name {name!r}")
        if not HEX.match(hexdigest):
            raise ValueError(f"key {name!r}: hash must be 64 lowercase hex characters (store the SHA-256, not the secret)")
        if not rate.isascii() or not rate.isdigit() or not 1 <= int(rate) <= 1000000:
            raise ValueError(f"key {name!r}: per_minute must be 1..1000000")
        names.add(name)
        keys[hexdigest] = (name, int(rate))
    return keys


class KeyRing:
    def __init__(self, keys):
        self._keys = dict(keys)

    def __bool__(self):
        return bool(self._keys)

    def lookup(self, presented):
        """Return (name, per_minute) for a valid key, else None. Constant-time comparison against every configured hash."""
        if not presented or len(presented) > 200:
            return None
        candidate, found = digest(presented), None
        for known, info in self._keys.items():
            if hmac.compare_digest(candidate, known):
                found = info
        return found

    def limits(self):
        return {name: rate for name, rate in self._keys.values()}


def generate(name, per_minute):
    secret = PREFIX + secrets.token_urlsafe(32)
    entry = f"{name}:{digest(secret)}:{per_minute}"
    parse(entry)  # validate name/rate
    return secret, entry


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "generate":
        sys.exit("usage: apikeys.py generate NAME PER_MINUTE")
    secret, entry = generate(sys.argv[2], sys.argv[3])
    print("API key (shown once, give it to the client; do not commit it):", secret)
    print("Add to MAPS_API_KEYS (comma separated):", entry)
