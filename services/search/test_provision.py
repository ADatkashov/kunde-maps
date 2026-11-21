"""Verify Search API startup rejects missing and corrupt index configuration."""
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from build_index import build
import provision_index


class ProvisionIndexTest(unittest.TestCase):
    def test_rejects_missing_configuration(self):
        with patch.object(provision_index, "URL", ""), patch.object(provision_index, "SHA256", ""):
            with self.assertRaises(SystemExit):
                provision_index.provision()

    def test_validates_checksum_and_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "places.geojsonl"
            record = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [76.9, 43.2]},
                      "properties": {"name": "Алматы"}}
            source.write_text("\n".join(json.dumps(record, ensure_ascii=False) for _ in range(1001)), encoding="utf-8")
            original = root / "original.sqlite3"
            build(source, original)
            expected = hashlib.sha256(original.read_bytes()).hexdigest()
            target = root / "index.sqlite3"
            with patch.object(provision_index, "URL", original.as_uri().replace("file:", "https:")), \
                 patch.object(provision_index, "SHA256", expected), \
                 patch.object(provision_index, "DEST", target), \
                 patch.object(provision_index, "urlopen", return_value=original.open("rb")):
                provision_index.provision()
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), expected)


if __name__ == "__main__":
    unittest.main()
