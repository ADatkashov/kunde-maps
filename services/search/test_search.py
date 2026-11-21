import json
import tempfile
import unittest
from pathlib import Path

from build_index import build
from server import search


class SearchIndexTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
