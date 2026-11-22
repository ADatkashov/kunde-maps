"""Relevance fixtures for RU / KK / EN / transliterated search (ranking, scripts, typos, proximity)."""
import json
import tempfile
import unittest
from pathlib import Path

import textnorm
from build_index import build
from server import search


def feat(lon, lat, **props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


# NOTE: small namesakes are listed BEFORE the big places on purpose, so ids cannot win a tie by accident.
FIXTURE = [
    feat(76.87, 42.97, name="Алматы", **{"name:ru": "Алматы"}, place="village", population="300"),
    feat(51.9, 47.09, name="Алматы"),
    feat(76.9, 43.3, name="Almaty Backpackers", tourism="hostel"),
    feat(76.95, 43.25, name="Алматы-1", amenity="railway_station"),
    feat(77.0, 43.3, name="Алматау", shop="convenience"),
    feat(77.01, 43.31, name="Алматау Плаза", shop="mall"),
    feat(77.02, 43.32, name="Торговый дом Алмата", shop="department_store"),
    feat(77.03, 43.33, name="Алматинка", shop="bakery"),
    feat(51.15, 43.66, name="Астана", amenity="fast_food"),
    feat(71.4, 51.1, name="Астана Бонус", shop="supermarket"),
    feat(69.61, 42.2987, name="Шымкент"),
    feat(71.24, 42.84, name="Тараз-Шымкент"),
    feat(70.0, 50.0, name="Қазақстан", **{"name:ru": "Казахстан"}, place="village"),
    feat(76.94, 43.24, name="проспект Абая", **{"addr:street": "проспект Абая"}),
    feat(76.94, 43.24, name="Абай даңғылы", **{"name:kk": "Абай даңғылы"}),
    feat(76.91, 43.23, name="Центральный парк", leisure="park"),
    feat(71.43, 51.13, name="Центральный парк", leisure="park"),
    feat(76.9457, 43.2364, name="Алматы", **{"name:ru": "Алматы", "name:kk": "Алматы", "name:en": "Almaty"}, place="city",
         population="2000000", alt_name="Алма-Ата", old_name="Верный"),
    feat(77.13, 43.61, name="Алматы облысы", **{"name:ru": "Алматинская область", "name:kk": "Алматы облысы"}, place="state"),
    feat(71.4305, 51.1283, name="Астана", **{"name:ru": "Астана", "name:kk": "Астана", "name:en": "Astana"}, place="city",
         population="1300000", capital="yes", old_name="Нұр-Сұлтан; Акмолинск"),
    feat(69.5883, 42.3147, name="Шымкент", **{"name:ru": "Шымкент"}, place="city", population="1100000"),
    feat(66.9, 48.0, name="Қазақстан", **{"name:ru": "Казахстан", "name:kk": "Қазақстан", "name:en": "Kazakhstan"}, place="country"),
    feat(73.1, 49.8, name="Қарағанды", **{"name:ru": "Караганда", "name:kk": "Қарағанды"}, place="city", population="500000"),
]
# (query, predicate on the top result, label)
EXPECT = [
    ("Алматы", lambda r: r["kind"] == "city" and r["name"] == "Алматы"),
    ("Almaty", lambda r: r["kind"] == "city" and r["name"] == "Алматы"),
    ("Almati", lambda r: r["kind"] == "city" and r["name"] == "Алматы"),
    ("ALMATY", lambda r: r["kind"] == "city"),
    ("Алмата", lambda r: r["kind"] == "city" and r["name"] == "Алматы"),  # typo: last letter
    ("Алма-Ата", lambda r: r["kind"] == "city" and r["name"] == "Алматы"),
    ("Верный", lambda r: r["kind"] == "city" and r["name"] == "Алматы"),
    ("Астана", lambda r: r["kind"] == "city" and r["name"] == "Астана"),
    ("Astana", lambda r: r["kind"] == "city" and r["name"] == "Астана"),
    ("Нұр-Сұлтан", lambda r: r["kind"] == "city" and r["name"] == "Астана"),
    ("Nur-Sultan", lambda r: r["kind"] == "city" and r["name"] == "Астана"),
    ("Шымкент", lambda r: r["kind"] == "city"),
    ("Shymkent", lambda r: r["kind"] == "city" and r["name"] == "Шымкент"),
    ("Shimkent", lambda r: r["kind"] == "city"),
    ("Қазақстан", lambda r: r["kind"] == "country"),
    ("Qazaqstan", lambda r: r["kind"] == "country"),
    ("Kazakhstan", lambda r: r["kind"] == "country"),
    ("Казахстан", lambda r: r["kind"] == "country"),
    ("Karaganda", lambda r: r["kind"] == "city"),
    ("Qaraghandy", lambda r: r["kind"] == "city"),
]


class RelevanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        source = Path(cls.tmp.name) / "p.geojsonl"
        source.write_text("\n".join(json.dumps(f, ensure_ascii=False) for f in FIXTURE), encoding="utf-8")
        cls.db = Path(cls.tmp.name) / "i.sqlite3"
        build(source, cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_top_result_for_every_expectation_and_mrr(self):
        failures, reciprocal = [], []
        for query, ok in EXPECT:
            results = search(self.db, query)
            rank = next((i + 1 for i, r in enumerate(results) if ok(r)), None)
            reciprocal.append(1 / rank if rank else 0)
            if rank != 1:
                failures.append((query, rank, results[:2]))
        self.assertEqual(failures, [], "top-1 misses")
        self.assertEqual(sum(reciprocal) / len(reciprocal), 1.0)

    def test_last_letter_typos_find_the_city_first(self):
        for query, expected in (("Алмата", "Алматы"), ("Астано", "Астана"), ("Шымкен", "Шымкент"), ("Astan", "Астана")):
            top = search(self.db, query)[0]
            self.assertEqual((top["name"], top["kind"]), (expected, "city"), query)

    def test_edit_distance_helper(self):
        from server import _edit_distance_at_most_one as near
        self.assertTrue(near("almati", "almata") and near("almat", "almati") and near("a", "ab") and near("ab", "ab"))
        self.assertFalse(near("almati", "alm") or near("abc", "xyz") or near("abcd", "abdc"))

    def test_exact_match_beats_longer_names_and_prefix_still_works(self):
        results = search(self.db, "Алматы")
        names = [r["name"] for r in results]
        self.assertEqual(names[0], "Алматы")
        self.assertIn("Алматы облысы", names)
        self.assertLess(names.index("Алматы"), names.index("Алматы облысы"))
        self.assertTrue(any(r["name"] == "Алматы-1" for r in search(self.db, "Алматы-1")))
        self.assertTrue(search(self.db, "Алм"))  # prefix

    def test_english_name_is_returned_and_displayable(self):
        city = search(self.db, "Almaty")[0]
        self.assertEqual(city["name_en"], "Almaty")

    def test_street_name_forms_match_across_cases_and_scripts(self):
        names = {r["name"] for r in search(self.db, "Abai")}
        self.assertTrue({"проспект Абая", "Абай даңғылы"} <= names)

    def test_proximity_breaks_ties_only_when_a_map_center_is_given(self):
        near_astana = search(self.db, "Центральный парк", center=(51.13, 71.43))[0]
        near_almaty = search(self.db, "Центральный парк", center=(43.23, 76.91))[0]
        self.assertAlmostEqual(near_astana["lat"], 51.13)
        self.assertAlmostEqual(near_almaty["lat"], 43.23)

    def test_proximity_never_beats_exact_importance_for_a_city(self):
        # Map centred on Astana: "Алматы" must still return the big city first, not a nearby small namesake.
        top = search(self.db, "Алматы", center=(51.13, 71.43))[0]
        self.assertEqual((top["kind"], top["name"]), ("city", "Алматы"))

    def test_garbage_and_injection_like_queries_return_lists(self):
        for q in ('" OR *', "'; DROP TABLE places;--", "NEAR(a b)", "a" * 100, "ъь", "!!!", "\x00\x01"):
            self.assertIsInstance(search(self.db, q), list)

    def test_limit_is_respected(self):
        self.assertLessEqual(len(search(self.db, "Алматы", limit=2)), 2)


class TextnormTest(unittest.TestCase):
    def test_equivalent_spellings(self):
        for group in (["Алматы", "Almaty", "Almati", "ALMATY"], ["Қазақстан", "Qazaqstan", "Kazakhstan", "Казахстан"],
                      ["Шымкент", "Shymkent", "Shimkent"], ["Астана", "Astana"], ["Алма-Ата", "Alma-Ata", "Alma Ata"]):
            self.assertEqual(len({textnorm.skeleton(x) for x in group}), 1, group)

    def test_distinct_letters_stay_distinct(self):
        self.assertNotEqual(textnorm.skeleton("Шу"), textnorm.skeleton("Су"))
        self.assertNotEqual(textnorm.skeleton("Чу"), textnorm.skeleton("Шу"))
        self.assertNotEqual(textnorm.skeleton("Цой"), textnorm.skeleton("Зой"))

    def test_kazakh_letters_and_combining_marks(self):
        self.assertEqual(textnorm.skeleton("ӘҒҚҢӨҰҮҺІ"), textnorm.skeleton("agknouuhi"))
        self.assertEqual(textnorm.skeleton("Алматы́"), textnorm.skeleton("Алматы"))

    def test_empty_and_symbol_only_inputs(self):
        for value in ("", None, "---", "  ", "ъь"):
            self.assertEqual(textnorm.skeleton(value), "")

    def test_importance_uses_only_real_attributes(self):
        self.assertGreater(textnorm.importance("city", 2000000), textnorm.importance("city", 1000))
        self.assertGreater(textnorm.importance("city"), textnorm.importance("village"))
        self.assertGreater(textnorm.importance("village"), textnorm.importance("address"))
        self.assertGreater(textnorm.importance("city", 100, capital=True), textnorm.importance("city", 100))
        self.assertEqual(textnorm.importance("city", "not-a-number"), textnorm.importance("city"))


if __name__ == "__main__":
    unittest.main()
