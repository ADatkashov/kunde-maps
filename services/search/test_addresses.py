"""House-number search: street-type words are optional, proximity decides between equal addresses, locality is context."""
import tempfile
import unittest
from pathlib import Path

import addresses
import textnorm
from build_index import build
from server import search
import json
import sqlite3


def feat(lon, lat, **props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


FIXTURE = [
    feat(67.26, 43.92, name="Абая 150", **{"addr:street": "Абая", "addr:housenumber": "150"}),          # far away, spelled exactly
    feat(85.62, 49.16, name="Абая 150", **{"addr:street": "Абая", "addr:housenumber": "150"}),
    feat(76.90, 43.22, name="улица Абая 150", **{"addr:street": "улица Абая", "addr:housenumber": "150"}),  # near the user
    feat(76.95, 43.27, name="проспект Абая 10", **{"addr:street": "проспект Абая", "addr:housenumber": "10"}),
    feat(76.9457, 43.2364, name="Алматы", **{"name:ru": "Алматы", "name:kk": "Алматы", "name:en": "Almaty"}, place="city", population="2000000"),
    feat(76.77, 43.21, name="Абая", place="village"),                                                      # a small village inside the city sprawl
    feat(67.2, 43.9, name="Жанакорган", place="town"),
    feat(60.0, 55.0, name="Пустошь 7", **{"addr:street": "Пустошь", "addr:housenumber": "7"}),            # no settlement within limits
]
ALMATY = (43.238, 76.945)


class AddressTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory()
        source = Path(cls.dir.name) / "p.geojsonl"
        source.write_text("\n".join(json.dumps(f, ensure_ascii=False) for f in FIXTURE), encoding="utf-8")
        cls.db = Path(cls.dir.name) / "i.sqlite3"
        build(source, cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.dir.cleanup()

    def test_street_words_are_optional(self):
        self.assertIn(textnorm.skeleton_token("улица"), addresses.STREET_WORDS)
        self.assertEqual(addresses.core("prospekt abaya 10"), "abaya 10")
        self.assertEqual(addresses.core("prospekt"), "prospekt")  # nothing else left: keep it
        for query in ("проспект Абая 10", "Абая 10", "abaya 10", "Абай даңғылы 10"):
            names = [r["name"] for r in search(self.db, query, 3, "ru", ALMATY)]
            self.assertEqual(names[:1], ["проспект Абая 10"], query)

    def test_nearby_address_beats_a_far_exact_spelling(self):
        near = search(self.db, "Абая 150", 4, "ru", ALMATY)
        self.assertEqual((near[0]["name"], round(near[0]["lon"], 2)), ("улица Абая 150", 76.90))
        self.assertEqual(round(search(self.db, "Абая 150", 4, "ru", None)[0]["lon"], 1), 67.3)  # no position: exact spelling first

    def test_locality_is_the_nearest_settlement_with_city_preference(self):
        top = search(self.db, "Абая 150", 4, "ru", ALMATY)[0]
        self.assertEqual(top["locality"], "Алматы")  # not the tiny village "Абая" next to the address
        self.assertEqual(search(self.db, "Абая 150", 4, "en", ALMATY)[0]["locality"], "Almaty")
        far = [r for r in search(self.db, "Абая 150", 4, "ru", None) if round(r["lon"], 1) == 67.3][0]
        self.assertEqual(far["locality"], "Жанакорган")
        lonely = search(self.db, "Пустошь 7", 1, "ru", None)[0]
        self.assertNotIn("locality", lonely)  # nothing within the limits: no guess
        city = search(self.db, "Алматы", 1, "ru", None)[0]
        self.assertNotIn("locality", city)  # only address rows get a locality


if __name__ == "__main__":
    unittest.main()
