"""Categories, contact-data sanitizing, schema-v3 build and the Places HTTP API."""
import json
import sqlite3
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import categories
import places
import protection
import server
from build_index import build, osm_code


def feat(lon, lat, **props):
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


class CategoryTest(unittest.TestCase):
    def test_primary_category_from_real_tags(self):
        cases = [
            ({"amenity": "restaurant"}, ("restaurant", "restaurant")), ({"amenity": "cafe"}, ("cafe", "cafe")),
            ({"shop": "bakery"}, ("cafe", "bakery")), ({"shop": "supermarket"}, ("shop", "supermarket")),
            ({"amenity": "pharmacy"}, ("pharmacy", "pharmacy")), ({"shop": "chemist"}, ("pharmacy", "chemist")),
            ({"amenity": "hospital"}, ("hospital", "hospital")), ({"healthcare": "laboratory"}, ("hospital", "laboratory")),
            ({"amenity": "school"}, ("school", "school")), ({"amenity": "university"}, ("school", "university")),
            ({"amenity": "fuel"}, ("fuel", "fuel")), ({"amenity": "parking"}, ("parking", "parking")),
            ({"amenity": "atm"}, ("bank", "atm")), ({"tourism": "hotel"}, ("hotel", "hotel")),
            ({"shop": "hairdresser"}, ("beauty", "hairdresser")), ({"leisure": "fitness_centre"}, ("sport", "fitness_centre")),
            ({"tourism": "museum"}, ("culture", "museum")), ({"leisure": "park"}, ("park", "park")),
            ({"shop": "car_repair"}, ("auto", "car_repair")), ({"railway": "station"}, ("transport", "station")),
            ({"amenity": "post_office"}, ("services", "post_office")),
        ]
        for tags, expected in cases:
            self.assertEqual(categories.categorize(tags), expected, tags)

    def test_untagged_excluded_and_negated_values_have_no_category(self):
        for tags in ({}, {"building": "yes"}, {"amenity": "bench"}, {"amenity": "parking_space"}, {"shop": "no"}, {"highway": "bus_stop"}):
            self.assertEqual(categories.categorize(tags), ("", ""), tags)

    def test_multi_valued_tags_use_the_first_value(self):
        self.assertEqual(categories.categorize({"amenity": "cafe;restaurant"}), ("cafe", "cafe"))

    def test_every_category_is_reachable_and_ordered_ids_are_unique(self):
        self.assertEqual(sorted(categories.PRIORITY), sorted(categories.CATEGORY_IDS))
        self.assertEqual(len(set(categories.CATEGORY_IDS)), len(categories.CATEGORY_IDS))

    def test_website_sanitizer_blocks_dangerous_and_malformed_urls(self):
        ok = categories.clean_website
        self.assertEqual(ok("https://example.kz/menu"), "https://example.kz/menu")
        self.assertEqual(ok("www.example.kz"), "https://www.example.kz")
        self.assertEqual(ok("http://a.example.kz; https://b.example.kz"), "http://a.example.kz")
        for bad in ("javascript:alert(1)", "data:text/html,x", "ftp://example.kz", "https://user:pw@example.kz", "http://localhost",
                    "https://exa mple.kz", "not a url", "", None, "https://" + "a" * 400 + ".kz", "//example.kz", "https:///x"):
            self.assertEqual(ok(bad), "", bad)

    def test_phone_sanitizer_keeps_plausible_numbers_only(self):
        self.assertEqual(categories.clean_phone("+7 727 123-45-67; +7 (701) 555 00 11"), "+7 727 123-45-67; +7 (701) 555 00 11")
        self.assertEqual(categories.clean_phone("call me"), "")
        self.assertEqual(categories.clean_phone("<script>1234567</script>"), "")
        self.assertEqual(categories.clean_phone("12"), "")
        self.assertEqual(categories.clean_phone("+7 727 111 11 11, 8 7172 22 22 22, +7 700 000 00 00, +7 701 000 00 00").count(";"), 2)

    def test_hours_and_address_use_only_present_data(self):
        self.assertEqual(categories.clean_hours("Mo-Su 09:00-18:00\x00\n"), "Mo-Su 09:00-18:00")
        self.assertEqual(len(categories.clean_hours("x" * 1000)), 250)
        self.assertEqual(categories.address_from({"addr:street": "Абая", "addr:housenumber": "12", "addr:city": "Алматы"}), "Абая 12, Алматы")
        self.assertEqual(categories.address_from({"addr:street": "Абая"}), "Абая")
        self.assertEqual(categories.address_from({"name": "X"}), "")

    def test_osm_code(self):
        self.assertEqual(osm_code("node/123"), "n123")
        self.assertEqual(osm_code("way/9"), "w9")
        self.assertEqual(osm_code("relation/5"), "r5")
        for bad in ("", None, "node/", "node/abc", "foo/1", "123"):
            self.assertEqual(osm_code(bad), "", bad)


FIXTURE = [
    feat(76.9457, 43.2364, name="Алматы", place="city", osm_id="node/1"),
    feat(76.9500, 43.2400, name="Кофейня Альфа", amenity="cafe", osm_id="node/10", **{"addr:street": "Абая", "addr:housenumber": "1"},
         phone="+7 727 111-22-33", website="https://alpha.example.kz", opening_hours="Mo-Su 09:00-21:00", brand="Альфа"),
    feat(76.9510, 43.2410, name="Кофейня Бета", amenity="cafe", osm_id="node/11"),
    feat(76.9520, 43.2420, name="Ресторан Гамма", amenity="restaurant", osm_id="way/12", website="javascript:alert(1)", phone="not a phone"),
    feat(76.9800, 43.2500, name="Аптека 24", amenity="pharmacy", osm_id="node/13", opening_hours="24/7"),
    feat(76.9460, 43.2370, amenity="parking", osm_id="node/14"),                 # nameless parking is kept
    feat(76.9461, 43.2371, osm_id="node/15"),                                      # no name, no category -> dropped
    feat(76.9462, 43.2372, amenity="bench", name="Скамейка", osm_id="node/16"),    # named but not a category
    feat(77.5000, 43.5000, name="Далёкий магазин", shop="convenience", osm_id="node/17"),
    feat(76.9470, 43.2380, name="АЗС Дельта", amenity="fuel", osm_id="node/18", brand="Delta"),
]


class PlacesApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        source = root / "p.geojsonl"
        source.write_text("\n".join(json.dumps(f, ensure_ascii=False) for f in FIXTURE), encoding="utf-8")
        cls.db = root / "i.sqlite3"
        build(source, cls.db)
        cls.saved = (server.DB_PATH, server.LIMITER, server.GATE)
        server.DB_PATH = cls.db
        server.LIMITER = protection.TokenBuckets(per_minute=6000, burst=1000)
        server.GATE = protection.ConcurrencyGate(8)
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.http.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close()
        server.DB_PATH, server.LIMITER, server.GATE = cls.saved
        cls.tmp.cleanup()

    def get(self, path, headers=None):
        try:
            with urlopen(Request(self.base + path, headers=headers or {})) as r:
                return r.status, json.load(r)
        except HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    BOX = "bbox=76.90,43.20,77.00,43.30"

    def test_schema_and_stored_attributes(self):
        db = sqlite3.connect(self.db)
        self.assertEqual(db.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0], "3")
        counts = json.loads(db.execute("SELECT value FROM meta WHERE key='category_counts'").fetchone()[0])
        self.assertEqual(counts, {"cafe": 2, "restaurant": 1, "pharmacy": 1, "parking": 1, "shop": 1, "fuel": 1})
        # city + 7 categorized + the named bench (searchable by name, but not a place category); the tagless node is dropped
        self.assertEqual(db.execute("SELECT count(*) FROM places").fetchone()[0], 9)
        self.assertEqual(db.execute("SELECT count(*) FROM places_rtree").fetchone()[0], 7)
        row = db.execute("SELECT phone, website, hours, address FROM places WHERE osm_id='w12'").fetchone()
        self.assertEqual(row, ("", "", "", ""), "dangerous/invalid contact data is dropped, not repaired")

    def test_viewport_returns_only_places_inside_and_with_real_fields(self):
        status, body = self.get("/v1/places?" + self.BOX)
        self.assertEqual(status, 200)
        names = {p["name"] for p in body["places"]}
        self.assertNotIn("Далёкий магазин", names)
        self.assertNotIn("Алматы", names, "settlements are not POIs")
        self.assertEqual(body["attribution"], "© OpenStreetMap contributors (ODbL)")
        alpha = next(p for p in body["places"] if p["name"] == "Кофейня Альфа")
        self.assertEqual((alpha["id"], alpha["category"], alpha["subtype"], alpha["phone"], alpha["hours"], alpha["brand"]),
                         ("n10", "cafe", "cafe", "+7 727 111-22-33", "Mo-Su 09:00-21:00", "Альфа"))
        self.assertEqual(alpha["address"], "Абая 1")
        beta = next(p for p in body["places"] if p["name"] == "Кофейня Бета")
        self.assertEqual((beta["phone"], beta["website"], beta["hours"], beta["address"]), (None, None, None, None))
        self.assertTrue(any(p["name"] is None and p["category"] == "parking" for p in body["places"]))

    def test_category_filter_and_ranking_by_completeness(self):
        status, body = self.get("/v1/places?" + self.BOX + "&category=cafe")
        self.assertEqual([p["name"] for p in body["places"]], ["Кофейня Альфа", "Кофейня Бета"], "complete record first")
        status, body = self.get("/v1/places?" + self.BOX + "&category=cafe,pharmacy")
        self.assertEqual({p["category"] for p in body["places"]}, {"cafe", "pharmacy"})
        self.assertEqual(self.get("/v1/places?" + self.BOX + "&limit=2")[1]["count"], 2)

    def test_nearby_sorted_by_distance_with_distance_and_radius(self):
        status, body = self.get("/v1/places?lat=43.2364&lon=76.9457&radius=500&category=cafe,restaurant,fuel")
        self.assertEqual(status, 200)
        distances = [p["distance_m"] for p in body["places"]]
        self.assertTrue(all(d <= 500 for d in distances))
        self.assertEqual(distances, sorted(distances) if len(set(distances)) == len(distances) else distances)
        self.assertEqual(body["places"][0]["name"], "АЗС Дельта", "closest first")
        far = self.get("/v1/places?lat=43.2364&lon=76.9457&radius=50&category=pharmacy")[1]
        self.assertEqual(far["places"], [])

    def test_nearby_rule_quality_is_worth_40m_per_point_but_never_beats_much_closer_places(self):
        # Standing at the restaurant: it is 0 m away. "Альфа" (7 quality points = -280 m) is 275 m away; "Бета" is 137 m away
        # with only 2 points. Expected order: Гамма (0 m), Альфа (275-280), Бета (137-80 = 57).
        status, body = self.get("/v1/places?lat=43.2420&lon=76.9520&radius=300&category=cafe,restaurant")
        self.assertEqual([p["name"] for p in body["places"]], ["Ресторан Гамма", "Кофейня Альфа", "Кофейня Бета"])
        self.assertEqual(body["places"][0]["distance_m"], 0)
        self.assertGreater(body["places"][1]["distance_m"], body["places"][2]["distance_m"])

    def test_details_by_stable_osm_id(self):
        status, body = self.get("/v1/places/n10")
        self.assertEqual((status, body["place"]["name"], body["place"]["website"]), (200, "Кофейня Альфа", "https://alpha.example.kz"))
        self.assertEqual(self.get("/v1/places/w12")[1]["place"]["category"], "restaurant")
        self.assertEqual(self.get("/v1/places/n999999")[0], 404)
        self.assertEqual(self.get("/v1/places/n1")[0], 404, "settlements are not places")
        for bad in ("abc", "n", "n1a", "x1", "n1' OR 1=1", "n" + "9" * 20, "../n10"):
            self.assertEqual(self.get("/v1/places/" + bad.replace(" ", "%20").replace("'", "%27"))[0], 400, bad)

    def test_text_search_results_carry_place_id_and_category_for_v3(self):
        status, body = self.get("/v1/search?q=%D0%9A%D0%BE%D1%84%D0%B5%D0%B9%D0%BD%D1%8F%20%D0%90%D0%BB%D1%8C%D1%84%D0%B0")
        top = body["results"][0]
        self.assertEqual((top["name"], top["place_id"], top["category"]), ("Кофейня Альфа", "n10", "cafe"))
        city = self.get("/v1/search?q=%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B")[1]["results"][0]
        self.assertEqual((city["name"], city["place_id"], city["category"]), ("Алматы", "n1", None))

    def test_categories_endpoint(self):
        status, body = self.get("/v1/categories")
        ids = [c["id"] for c in body["categories"]]
        self.assertEqual(ids, categories.CATEGORY_IDS)
        self.assertEqual(next(c for c in body["categories"] if c["id"] == "cafe")["count"], 2)

    def test_parameter_validation(self):
        cases = {
            "/v1/places": "bbox_or_lat_lon_required",
            "/v1/places?bbox=1,2,3": "bbox_must_be_minLon,minLat,maxLon,maxLat",
            "/v1/places?bbox=a,b,c,d": "bbox_must_be_a_number",
            "/v1/places?bbox=77,43,76,44": "bbox_min_must_be_less_than_max",
            "/v1/places?bbox=70,40,80,50": "area_too_large",
            "/v1/places?bbox=76,43,77,44&category=nope": "unknown_category",
            "/v1/places?bbox=76,43,77,44&category=" + ",".join(["cafe"] * 40): "too_many_categories",
            "/v1/places?bbox=76,43,77,44&limit=0": f"limit_must_be_1_to_{places.MAX_LIMIT}",
            "/v1/places?bbox=76,43,77,44&limit=9999": f"limit_must_be_1_to_{places.MAX_LIMIT}",
            "/v1/places?lat=95&lon=1": "lat_out_of_range",
            "/v1/places?lat=1&lon=nan": "lon_out_of_range",
            "/v1/places?lat=43&lon=76&radius=999999": "radius_out_of_range",
            "/v1/places?bbox=76,43,77,44&category=cafe%27%3B%20DROP%20TABLE%20places": "unknown_category",
        }
        for path, error in cases.items():
            status, body = self.get(path)
            self.assertEqual((status, body.get("error")), (400, error), path)

    def test_places_share_the_rate_limiter(self):
        saved = server.LIMITER
        server.LIMITER = protection.TokenBuckets(per_minute=60, burst=2)
        try:
            codes = [self.get("/v1/places?" + self.BOX)[0] for _ in range(3)]
            self.assertEqual(codes, [200, 200, 429])
        finally:
            server.LIMITER = saved

    def test_old_v2_index_reports_places_unavailable_but_search_still_works(self):
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / "p.geojsonl"
            source.write_text(json.dumps(feat(76.9, 43.2, name="Алматы", place="city")), encoding="utf-8")
            old = Path(d) / "old.sqlite3"
            build(source, old)
            conn = sqlite3.connect(old)
            conn.execute("UPDATE meta SET value='2' WHERE key='schema_version'")
            conn.commit(); conn.close()
            previous = server.DB_PATH
            server.DB_PATH = old
            try:
                self.assertEqual(self.get("/v1/places?" + self.BOX)[1], {"error": "places_unavailable"})
                self.assertEqual(self.get("/v1/search?q=%D0%90%D0%BB%D0%BC")[0], 200)
            finally:
                server.DB_PATH = previous

    def test_metrics_label_places_route_without_query_text(self):
        server.METRICS = protection.Metrics()
        self.get("/v1/places?" + self.BOX + "&category=cafe")
        for _ in range(200):  # metrics are recorded just after the response is sent
            if 'route="places"' in server.METRICS.render():
                break
            threading.Event().wait(0.01)
        text = server.METRICS.render()
        self.assertIn('route="places"', text)
        self.assertNotIn("cafe", text)


if __name__ == "__main__":
    unittest.main()
