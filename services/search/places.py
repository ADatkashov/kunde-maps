"""Place queries over the schema-v3 index: map viewport (R-tree), nearby, details by OSM id, categories.

All values come from OpenStreetMap tags stored at index build time; absent attributes are returned as null, never guessed.
"""
import json
import math
import re

import categories

MAX_SPAN_DEG = 1.5          # widest accepted viewport (about the 11th zoom level on a desktop screen)
DEFAULT_LIMIT = 100
MAX_LIMIT = 300
MAX_RADIUS_M = 5000
DEFAULT_RADIUS_M = 1000
CANDIDATES = 1500           # rows pulled from the R-tree before ranking
OSM_CODE = re.compile(r"^[nwr][0-9]{1,12}$")
ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"

COLUMNS = ("p.osm_id, p.name, p.name_ru, p.name_kk, p.name_en, p.category, p.subtype, p.kind, p.lat, p.lon, "
           "p.address, p.phone, p.website, p.hours, p.brand, p.quality")


class ParamError(ValueError):
    """Invalid request parameter; the message is a stable machine-readable error code."""


def parse_categories(value):
    if not value:
        return []
    ids = [part.strip() for part in value.split(",") if part.strip()]
    if len(ids) > len(categories.CATEGORY_IDS):
        raise ParamError("too_many_categories")
    unknown = [c for c in ids if c not in categories.CATEGORIES]
    if unknown:
        raise ParamError("unknown_category")
    return list(dict.fromkeys(ids))


def parse_limit(value):
    if value is None:
        return DEFAULT_LIMIT
    if not value.isascii() or not value.isdigit() or not 1 <= int(value) <= MAX_LIMIT:
        raise ParamError(f"limit_must_be_1_to_{MAX_LIMIT}")
    return int(value)


def parse_float(value, name, low, high):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ParamError(f"{name}_must_be_a_number") from None
    if not math.isfinite(number) or not low <= number <= high:
        raise ParamError(f"{name}_out_of_range")
    return number


def parse_bbox(value):
    parts = (value or "").split(",")
    if len(parts) != 4:
        raise ParamError("bbox_must_be_minLon,minLat,maxLon,maxLat")
    min_lon, min_lat, max_lon, max_lat = (
        parse_float(parts[0], "bbox", -180, 180), parse_float(parts[1], "bbox", -90, 90),
        parse_float(parts[2], "bbox", -180, 180), parse_float(parts[3], "bbox", -90, 90))
    if min_lon >= max_lon or min_lat >= max_lat:
        raise ParamError("bbox_min_must_be_less_than_max")
    if max_lon - min_lon > MAX_SPAN_DEG or max_lat - min_lat > MAX_SPAN_DEG:
        raise ParamError("area_too_large")
    return min_lon, min_lat, max_lon, max_lat


def distance_m(lat1, lon1, lat2, lon2):
    """Great-circle distance (haversine) in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1.0, math.sqrt(a)))


def to_place(row, distance=None):
    place = {
        "id": row["osm_id"] or None,
        "name": row["name"] or None, "name_ru": row["name_ru"] or None, "name_kk": row["name_kk"] or None,
        "name_en": row["name_en"] or None,
        "category": row["category"], "subtype": row["subtype"],
        "lat": row["lat"], "lon": row["lon"],
        "address": row["address"] or None, "phone": row["phone"] or None, "website": row["website"] or None,
        "hours": row["hours"] or None, "brand": row["brand"] or None,
    }
    if distance is not None:
        place["distance_m"] = int(round(distance))
    return place


def _rows(connection, box, cats, limit):
    min_lon, min_lat, max_lon, max_lat = box
    sql = (f"SELECT {COLUMNS} FROM places_rtree r JOIN places p ON p.id = r.id "
           "WHERE r.min_lat >= ? AND r.max_lat <= ? AND r.min_lon >= ? AND r.max_lon <= ?")
    args = [min_lat, max_lat, min_lon, max_lon]
    if cats:
        sql += " AND p.category IN (" + ",".join("?" * len(cats)) + ")"
        args += cats
    sql += " ORDER BY p.quality DESC, p.id LIMIT ?"
    args.append(limit)
    return connection.execute(sql, args).fetchall()


def in_viewport(connection, box, cats, limit, center=None):
    """Places inside the viewport. When there are more than `limit`, prefer complete records near the centre."""
    rows = _rows(connection, box, cats, CANDIDATES)
    min_lon, min_lat, max_lon, max_lat = box
    c_lat, c_lon = center if center else ((min_lat + max_lat) / 2, (min_lon + max_lon) / 2)
    half_diag = max(1.0, distance_m(min_lat, min_lon, max_lat, max_lon) / 2)
    scored = []
    for row in rows:
        closeness = 1 - min(1.0, distance_m(c_lat, c_lon, row["lat"], row["lon"]) / half_diag)
        scored.append((row["quality"] + 2 * closeness, row))
    scored.sort(key=lambda item: -item[0])
    return [to_place(row) for _, row in scored[:limit]], len(rows) >= CANDIDATES


def nearby(connection, lat, lon, radius, cats, limit):
    """Places within `radius` metres sorted by distance; each quality point is worth 40 m, unnamed objects cost 150 m."""
    dlat = radius / 111320.0
    dlon = radius / (111320.0 * max(0.01, math.cos(math.radians(lat))))
    rows = _rows(connection, (lon - dlon, lat - dlat, lon + dlon, lat + dlat), cats, CANDIDATES)
    scored = []
    for row in rows:
        dist = distance_m(lat, lon, row["lat"], row["lon"])
        if dist > radius:
            continue
        rank = dist - 40 * min(row["quality"], 7) + (150 if not row["name"] else 0)
        scored.append((rank, dist, row))
    scored.sort(key=lambda item: (item[0], item[1]))
    return [to_place(row, dist) for _, dist, row in scored[:limit]], len(rows) >= CANDIDATES


def by_id(connection, code):
    if not OSM_CODE.match(code or ""):
        raise ParamError("invalid_place_id")
    row = connection.execute(f"SELECT {COLUMNS} FROM places p WHERE p.osm_id = ? AND p.category != '' LIMIT 1", (code,)).fetchone()
    return to_place(row) if row else None


def category_info(connection):
    try:
        row = connection.execute("SELECT value FROM meta WHERE key='category_counts'").fetchone()
        counts = json.loads(row[0]) if row else {}
    except Exception:
        counts = {}
    return [{"id": cid, "count": counts.get(cid, 0),
             "osm": sorted({f"{key}={value}" for key, values in rules for value in (values or {"*"})})}
            for cid, rules in categories.CATEGORIES.items()]
