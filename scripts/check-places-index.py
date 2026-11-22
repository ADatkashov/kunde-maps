#!/usr/bin/env python3
"""Sanity gate for a freshly built schema-v3 index: every category must be populated and Almaty must have real places.
Usage: python3 scripts/check-places-index.py path/to/index.sqlite3     (prints the category counts; exit 1 on failure)"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "services" / "search"))
import places  # noqa: E402

# Deliberately conservative floors for Kazakhstan-wide OSM data; they catch an empty/broken extract, not small drift.
MINIMUM = {"restaurant": 200, "cafe": 200, "shop": 1000, "pharmacy": 200, "hospital": 200, "school": 500, "fuel": 200,
           "parking": 200, "bank": 100, "hotel": 50, "beauty": 50, "sport": 50, "culture": 50, "park": 50, "auto": 50,
           "transport": 20, "services": 100}


def main(path):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    version = db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
    counts = json.loads(db.execute("SELECT value FROM meta WHERE key='category_counts'").fetchone()[0])
    total = db.execute("SELECT count(*) FROM places WHERE category != ''").fetchone()[0]
    problems = [] if version == "3" else [f"schema_version={version}, expected 3"]
    print(f"schema v{version}: {total} categorized places")
    for category, floor in MINIMUM.items():
        count = counts.get(category, 0)
        print(f"  {category:11s} {count:7d}" + ("" if count >= floor else f"   < {floor}  FAIL"))
        if count < floor:
            problems.append(f"{category}: {count} < {floor}")
    with_contact = {field: db.execute(f"SELECT count(*) FROM places WHERE category != '' AND {field} != ''").fetchone()[0]
                    for field in ("address", "phone", "website", "hours")}
    print("  with real contact data:", with_contact)
    almaty, _ = places.in_viewport(db, (76.80, 43.15, 77.10, 43.40), [], 300)
    print(f"  Almaty viewport: {len(almaty)} places, categories: {sorted({p['category'] for p in almaty})}")
    if len(almaty) < 100:
        problems.append(f"Almaty viewport has only {len(almaty)} places")
    near, _ = places.nearby(db, 43.2389, 76.8897, 1000, ["pharmacy"], 20)
    print(f"  pharmacies within 1 km of Almaty centre: {len(near)}")
    for problem in problems:
        print("PROBLEM:", problem)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
