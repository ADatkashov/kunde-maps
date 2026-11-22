"""Stream OSM PBF nodes and ways into GeoJSONL for the KUNDE Maps search index.

Requires pyosmium: pip install osmium
Usage: python services/search/extract_osm.py kazakhstan-latest.osm.pbf points.geojsonl
Way representative points are approximate and are NOT entrance coordinates.
"""
import json
import sys

import categories


def relevant(tags):
    if len(tags) == 0:  # the vast majority of OSM nodes carry no tags at all
        return False
    if (tags.get("name") or tags.get("name:ru") or tags.get("name:kk") or tags.get("name:en")
            or (tags.get("addr:street") and tags.get("addr:housenumber"))):
        return True
    # Unnamed parking lots, ATMs and fuel stations are real, useful places (see categories.NAMELESS_OK).
    category, _ = categories.categorize(tags)
    return category in categories.NAMELESS_OK


def extract(source, destination):
    try:
        import osmium
    except ImportError as exc:
        raise SystemExit("Install pyosmium with: pip install osmium") from exc

    fields = ("name", "name:ru", "name:kk", "name:en", "alt_name", "official_name", "old_name", "int_name",
              "addr:street", "addr:housenumber", "amenity", "shop", "place", "highway", "tourism", "leisure",
              "population", "capital", "addr:city", "phone", "contact:phone", "mobile", "website", "contact:website", "url",
              "opening_hours", "brand", "operator", "cuisine", "wheelchair", "healthcare", "office", "railway",
              "public_transport", "craft", "aeroway")
    count = 0
    with open(destination, "w", encoding="utf-8") as output:
        class Handler(osmium.SimpleHandler):
            def emit(self, obj, coords, kind):
                nonlocal count
                tags = {field: obj.tags.get(field) for field in fields if obj.tags.get(field)}
                if not relevant(tags) or not coords:
                    return
                lon = sum(p[0] for p in coords) / len(coords)
                lat = sum(p[1] for p in coords) / len(coords)
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    return
                tags["osm_id"] = f"{kind}/{obj.id}"
                if kind == "way":
                    tags["coordinate_accuracy"] = "approximate"
                feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                           "properties": tags}
                output.write(json.dumps(feature, ensure_ascii=False) + "\n")
                count += 1

            def node(self, node):
                if relevant(node.tags) and node.location.valid():
                    self.emit(node, [(node.location.lon, node.location.lat)], "node")

            def way(self, way):
                if not relevant(way.tags):
                    return
                coords = [(node.lon, node.lat) for node in way.nodes if node.location.valid()]
                if coords:
                    # Sampling prevents excessive cost on long road geometries.
                    self.emit(way, coords[::max(1, len(coords) // 200)], "way")

        Handler().apply_file(str(source), locations=True)
    return count


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: extract_osm.py source.osm.pbf output.geojsonl")
    print("Extracted", extract(sys.argv[1], sys.argv[2]), "named/address features")
