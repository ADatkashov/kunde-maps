"""Build a local FTS5 search index from OSM-derived GeoJSON FeatureCollection/JSONL.

Usage: python3 services/search/build_index.py input.geojsonl output.sqlite3
Input must have Point geometries and properties with name, name:ru, name:kk,
addr:street, addr:housenumber and optional category tags. Extract from licensed
OSM data using a separate reproducible import pipeline.
"""
import json
import sqlite3
import sys
from pathlib import Path

import textnorm


def features(path):
    """Stream JSONL without loading the entire national extract into memory."""
    with open(path, encoding="utf-8") as stream:
        first_line = stream.readline()
        if not first_line.strip():
            return
        try:
            first_object = json.loads(first_line)
        except json.JSONDecodeError:
            # A pretty-printed FeatureCollection may span multiple lines.
            stream.seek(0)
            obj = json.load(stream)
            if obj.get("type") == "FeatureCollection":
                yield from obj.get("features", [])
                return
            if obj.get("type") == "Feature":
                yield obj
                return
            raise ValueError("Expected GeoJSON FeatureCollection or JSONL Features")
        if first_object.get("type") == "FeatureCollection":
            yield from first_object.get("features", [])
            return
        if first_object.get("type") != "Feature":
            raise ValueError("Expected GeoJSON FeatureCollection or JSONL Features")
        yield first_object
        for line in stream:
            if line.strip():
                yield json.loads(line)


SCHEMA_VERSION = "2"
ALT_TAGS = ("alt_name", "official_name", "old_name", "int_name")


def build(source, destination):
    """Build a schema-v2 index: places + FTS5 over names and a cross-script `skel` column (see textnorm.py)."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(".tmp")
    temp.unlink(missing_ok=True)
    db = sqlite3.connect(temp)
    try:
        db.executescript("""
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE places (
              id INTEGER PRIMARY KEY, name TEXT NOT NULL,
              name_ru TEXT, name_kk TEXT, name_en TEXT, alt TEXT, kind TEXT NOT NULL,
              lat REAL NOT NULL, lon REAL NOT NULL, importance INTEGER NOT NULL DEFAULT 0
            );
            -- remove_diacritics 0: textnorm.skeleton uses distinct letters (ş ç ž ţ) that must not be folded.
            CREATE VIRTUAL TABLE places_fts USING fts5(
              name, name_ru, name_kk, name_en, alt, skel, address, content='',
              tokenize='unicode61 remove_diacritics 0'
            );
        """)
        count = 0
        for feature in features(source):
            if feature.get("type") != "Feature":
                continue
            geometry = feature.get("geometry") or {}
            if geometry.get("type") != "Point":
                continue
            coords = geometry.get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = coords[:2]
            if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
                continue
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                continue
            p = feature.get("properties") or {}
            street = str(p.get("addr:street") or "").strip()
            number = str(p.get("addr:housenumber") or "").strip()
            ru = str(p.get("name:ru") or "")
            kk = str(p.get("name:kk") or "")
            en = str(p.get("name:en") or "")
            name = str(p.get("name") or ru or kk or en or (street + " " + number).strip()).strip()
            if not name:
                continue
            alt = "; ".join(v for v in (str(p.get(tag) or "").strip() for tag in ALT_TAGS) if v)
            kind = str(p.get("amenity") or p.get("shop") or p.get("place") or "address")
            capital = str(p.get("capital") or "") in ("yes", "4", "2", "3")
            importance = textnorm.importance(kind, p.get("population"), capital)
            address = " ".join(part for part in [street, number] if part)
            skel = " ".join(dict.fromkeys(textnorm.skeleton_tokens(" ".join((name, ru, kk, en, alt, address)))))
            cursor = db.execute(
                "INSERT INTO places(name,name_ru,name_kk,name_en,alt,kind,lat,lon,importance) VALUES(?,?,?,?,?,?,?,?,?)",
                (name, ru, kk, en, alt, kind, lat, lon, importance),
            )
            db.execute(
                "INSERT INTO places_fts(rowid,name,name_ru,name_kk,name_en,alt,skel,address) VALUES(?,?,?,?,?,?,?,?)",
                (cursor.lastrowid, name, ru, kk, en, alt, skel, address),
            )
            count += 1
            if count % 10000 == 0:
                db.commit()
        db.execute("INSERT INTO meta(key,value) VALUES('schema_version',?)", (SCHEMA_VERSION,))
        db.execute("INSERT INTO meta(key,value) VALUES('rows',?)", (str(count),))
        db.commit()
        db.execute("PRAGMA integrity_check")
        db.close()
        temp.replace(destination)
        return count
    except BaseException:
        db.close()
        temp.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: build_index.py input.geojsonl output.sqlite3")
    print("Indexed", build(sys.argv[1], sys.argv[2]), "places")
