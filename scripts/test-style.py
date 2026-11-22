#!/usr/bin/env python3
"""Tests for the generated MapLibre styles: consistency with the real tile schema, light/dark parity, fonts, contrast.
Run: python3 scripts/test-style.py   (the official spec validation runs separately via scripts/validate-style.mjs)"""
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("build_style", ROOT / "scripts/build-style.py")
build_style = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_style)

SCHEMA = json.loads((ROOT / "scripts/fixtures/tile-layers.json").read_text(encoding="utf-8"))["layers"]
STYLES = {t: json.loads((ROOT / f"apps/web/{n}").read_text(encoding="utf-8")) for t, n in (("light", "style.json"), ("dark", "style-dark.json"))}
ALLOWED_FONTS = {"Open Sans Regular", "Open Sans Semibold", "Open Sans Bold", "Open Sans Italic"}


def fields_in(expr):
    """All ["get", "<field>"] references inside an expression tree."""
    found = set()
    if isinstance(expr, list):
        if len(expr) == 2 and expr[0] == "get" and isinstance(expr[1], str):
            found.add(expr[1])
        if len(expr) == 2 and expr[0] == "has" and isinstance(expr[1], str):
            found.add(expr[1])
        for item in expr:
            found |= fields_in(item)
    elif isinstance(expr, dict):
        for value in expr.values():
            found |= fields_in(value)
    return found


def luminance(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


class StyleTest(unittest.TestCase):
    def test_committed_files_match_the_generator(self):
        for theme, style in STYLES.items():
            self.assertEqual(json.loads(build_style.render(theme)), style, f"{theme}: run scripts/build-style.py")

    def test_layers_reference_real_tile_layers_and_fields(self):
        for theme, style in STYLES.items():
            for layer in style["layers"]:
                if layer["type"] == "background":
                    continue
                self.assertIn(layer["source-layer"], SCHEMA, f"{theme}/{layer['id']}: unknown source-layer")
                allowed = set(SCHEMA[layer["source-layer"]]["fields"])
                referenced = fields_in({k: v for k, v in layer.items() if k != "metadata"})
                self.assertLessEqual(referenced, allowed | {"name"}, f"{theme}/{layer['id']}: unknown fields {referenced - allowed}")
                # also the localized templates stored in metadata
                for code, expr in (layer.get("metadata", {}).get("kunde:text") or {}).items():
                    self.assertLessEqual(fields_in(expr), allowed | {"name"}, f"{layer['id']}[{code}]")

    def test_zoom_ranges_are_within_what_exists_or_overzoom(self):
        for layer in STYLES["light"]["layers"]:
            self.assertLess(layer.get("minzoom", 0), layer.get("maxzoom", 24), layer["id"])

    def test_light_and_dark_share_structure_and_differ_only_in_paint(self):
        light, dark = STYLES["light"]["layers"], STYLES["dark"]["layers"]
        self.assertEqual([(l["id"], l["type"]) for l in light], [(l["id"], l["type"]) for l in dark])
        for a, b in zip(light, dark):
            self.assertEqual(a.get("filter"), b.get("filter"), a["id"])
            self.assertEqual(a.get("layout"), b.get("layout"), a["id"])
            self.assertEqual(a.get("minzoom"), b.get("minzoom"), a["id"])
        self.assertEqual(STYLES["light"]["sources"], STYLES["dark"]["sources"])

    def test_unique_ids_and_ids_the_web_app_relies_on(self):
        ids = [l["id"] for l in STYLES["light"]["layers"]]
        self.assertEqual(len(ids), len(set(ids)))
        for required in ("background", "place-labels", "street-labels", "water", "buildings"):
            self.assertIn(required, ids)

    def test_every_label_layer_has_all_three_language_templates(self):
        labels = [l for l in STYLES["light"]["layers"] if "kunde:text" in l.get("metadata", {})]
        self.assertGreaterEqual(len(labels), 10)
        for layer in labels:
            t = layer["metadata"]["kunde:text"]
            self.assertEqual(set(t), {"ru", "kk", "en"}, layer["id"])
            self.assertEqual(layer["layout"]["text-field"], t["ru"], "default text-field is the RU template")
            self.assertIn("name:kk", json.dumps(t["kk"]))
            self.assertIn("name:en", json.dumps(t["en"]))

    def test_only_fonts_available_with_cyrillic_and_kazakh_are_used(self):
        for theme, style in STYLES.items():
            for layer in style["layers"]:
                fonts = layer.get("layout", {}).get("text-font")
                if fonts:
                    self.assertLessEqual(set(fonts), ALLOWED_FONTS, f"{theme}/{layer['id']}")

    def test_source_and_attribution_requirements(self):
        for style in STYLES.values():
            source = style["sources"]["kunde"]
            self.assertTrue(source["url"].startswith("pmtiles://http://localhost:8080/tiles/"), "the web app rewrites this known dev URL")
            self.assertIn("OpenStreetMap contributors", source["attribution"])
            self.assertIn("openmaptiles.org", source["attribution"])
            self.assertTrue(style["glyphs"].startswith("https://"))

    def test_label_text_contrast_against_land_is_readable(self):
        # Labels carry halos, but their own colour must still read against the base land colour.
        for theme, palette in build_style.PALETTES.items():
            for key, minimum in (("text", 7.0), ("text_muted", 4.0), ("text_road", 4.0), ("text_water", 3.0)):
                ratio = contrast(palette[key], palette["background"])
                self.assertGreaterEqual(ratio, minimum, f"{theme}.{key} {ratio:.2f}:1 on background")

    def test_road_hierarchy_widths_increase_with_importance(self):
        light = {l["id"]: l for l in STYLES["light"]["layers"]}
        def width_at(layer_id, z):
            stops = light[layer_id]["paint"]["line-width"][3:]
            pairs = list(zip(stops[::2], stops[1::2]))
            return next(w for zz, w in reversed(pairs) if zz <= z)
        order = ["road-service", "road-minor", "road-tertiary", "road-secondary", "road-primary", "road-trunk", "road-motorway"]
        widths = [width_at(r, 14) for r in order]
        self.assertEqual(widths, sorted(widths), dict(zip(order, widths)))
        for r in order:  # every road class has a wider casing underneath
            self.assertIn(r + "-casing", light)

    def test_poi_dots_never_use_zoom_in_filters(self):
        for layer in STYLES["light"]["layers"]:
            self.assertNotIn('"zoom"', json.dumps(layer.get("filter", [])), layer["id"])


if __name__ == "__main__":
    unittest.main()
