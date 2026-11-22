"""Address search helpers: street-type words and the nearest-settlement locality of address results.

Nothing is invented: `locality` is the nearest city/town/village *name stored in the OSM-derived index* within a distance limit,
reported as context for address rows that carry no addr:city of their own. It is a nearest-settlement hint, not an admin boundary.
"""
import math
import threading
from pathlib import Path

import textnorm

_WORDS = ("улица ул проспект пр просп шоссе переулок пер бульвар проезд площадь пл набережная тупик аллея микрорайон мкр "
          "көшесі көше даңғылы даңғыл street st avenue ave road rd boulevard blvd lane").split()
STREET_WORDS = frozenset(w for w in (textnorm.skeleton_token(word) for word in _WORDS) if w)

WEIGHT = {"city": 2.0, "town": 1.4, "village": 1.0}
LIMIT_KM = {"city": 30.0, "town": 20.0, "village": 8.0}
_CELL = 0.5  # degrees (~55 km): a 3x3 neighbourhood always covers the limits above
_cache = {}
_lock = threading.Lock()


def core(skeleton_text):
    """Skeleton string without street-type words ('prospekt abaya 150' -> 'abaya 150'); unchanged if nothing else remains."""
    parts = skeleton_text.split()
    kept = [p for p in parts if p not in STREET_WORDS]
    return " ".join(kept) if kept else skeleton_text


def core_tokens(tokens):
    kept = [t for t in tokens if t not in STREET_WORDS]
    return kept or list(tokens)


def _km(a_lat, a_lon, b_lat, b_lon):
    dx = (a_lon - b_lon) * math.cos(math.radians((a_lat + b_lat) / 2)) * 111.32
    return math.hypot(dx, (a_lat - b_lat) * 110.57)


def _load(connection, key):
    with _lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    grid = {}
    for row in connection.execute("SELECT name, name_ru, name_kk, name_en, kind, lat, lon FROM places "
                                  "WHERE kind IN ('city','town','village') AND name != ''"):
        cell = (math.floor(row["lat"] / _CELL), math.floor(row["lon"] / _CELL))
        grid.setdefault(cell, []).append((row["kind"], row["lat"], row["lon"], row["name"], row["name_ru"], row["name_kk"], row["name_en"]))
    with _lock:
        _cache.clear()  # one index at a time; a new file (new key) replaces the old table
        _cache[key] = grid
    return grid


def locality(connection, db_path, lat, lon, lang):
    """Name (in `lang` when the settlement has it) of the nearest city/town/village within its limit, else None."""
    try:
        stat = Path(db_path).stat()
        grid = _load(connection, (str(db_path), stat.st_mtime_ns, stat.st_size))
    except Exception:
        return None
    ci, cj = math.floor(lat / _CELL), math.floor(lon / _CELL)
    best = None
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for kind, s_lat, s_lon, name, ru, kk, en in grid.get((ci + di, cj + dj), ()):
                distance = _km(lat, lon, s_lat, s_lon)
                if distance > LIMIT_KM[kind]:
                    continue
                rank = distance / WEIGHT[kind]  # a city's catchment is larger than a village's: it wins at comparable distances
                if best is None or rank < best[0]:
                    best = (rank, {"ru": ru, "kk": kk, "en": en}.get(lang) or name)
    return best[1] if best else None
