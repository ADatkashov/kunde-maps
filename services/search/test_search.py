import json
import tempfile
import unittest
from pathlib import Path

from build_index import build, features
from server import search


class SearchIndexTest(unittest.TestCase):
    def test_streams_jsonl_without_reading_entire_file(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "places.geojsonl"
            record = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [76.9, 43.2]},
                      "properties": {"name": "Алматы"}}
            source.write_text("\n".join(json.dumps(record, ensure_ascii=False)
                                         for _ in range(5000)) + "\n", encoding="utf-8")
            self.assertEqual(sum(1 for _ in features(source)), 5000)

    def test_multilingual_names_and_addresses(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "places.geojsonl"
            records = [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [76.945, 43.238]},
                 "properties": {"name": "Абай", "name:ru": "Абая", "name:kk": "Абай", "place": "suburb"}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [76.9, 43.2]},
                 "properties": {"addr:street": "Абая", "addr:housenumber": "12"}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [999, 43]},
                 "properties": {"name": "invalid"}},
            ]
            source.write_text("\n".join(json.dumps(item, ensure_ascii=False) for item in records), encoding="utf-8")
            target = root / "search.sqlite3"
            self.assertEqual(build(source, target), 2)
            self.assertEqual(len(search(target, "Абай")), 1)
            self.assertEqual(len(search(target, "Абая")), 2)
            self.assertEqual(len(search(target, "Абая 12")), 1)
            self.assertEqual(search(target, '" OR *'), [])

    def test_settlements_outrank_pois_with_same_name(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "places.geojsonl"
            records = [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [51.1, 43.6]},
                 "properties": {"name": "Шымкент", "amenity": "cafe"}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [69.6, 42.3]},
                 "properties": {"name": "Шымкент", "place": "city"}},
            ]
            source.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records), encoding="utf-8")
            target = root / "s.sqlite3"
            build(source, target)
            self.assertEqual(search(target, "Шымкент")[0]["kind"], "city")


if __name__ == "__main__":
    unittest.main()
