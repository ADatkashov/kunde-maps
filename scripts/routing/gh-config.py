#!/usr/bin/env python3
"""Patch GraphHopper's config-example.yml (same release) for our experiment: our PBF, graph dir, car+foot+bike profiles, loopback."""
import re, sys
path, pbf, graph = sys.argv[1:4]
text = open(path, encoding="utf-8").read()
text = re.sub(r"(?m)^(\s*datareader\.file:).*$", rf"\1 {pbf}", text)
text = re.sub(r"(?m)^(\s*graph\.location:).*$", rf"\1 {graph}", text)
profiles = "  profiles:\n" + "".join(f"    - name: {n}\n      custom_model_files: [{n}.json]\n" for n in ("car", "foot", "bike"))
# replace the whole profiles block (until the next top-level-in-graphhopper key at two-space indent)
new, n = re.subn(r"(?ms)^  profiles:\n.*?(?=^  \S|\Z)", profiles + "\n", text, count=1)
if n != 1:
    sys.exit("profiles block not found in config-example.yml")
# speed-up (CH) preparation for every profile, as a production setup would use (RAM/time are part of the measurement)
ch = "  profiles_ch:\n" + "".join(f"    - profile: {n}\n" for n in ("car", "foot", "bike"))
new, n_ch = re.subn(r"(?ms)^  profiles_ch:\n.*?(?=^  \S|\Z)", ch + "\n", new, count=1)
if n_ch != 1:
    new = new.replace("\n  profiles:\n", "\n" + ch + "  profiles:\n", 1)
# the example ignores footways/paths, which GraphHopper refuses to combine with the foot profile
new = re.sub(r"(?m)^(\s*)import\.osm\.ignored_highways:.*$", r'\1import.osm.ignored_highways: ""', new)
# routing needs encoded values the foot/bike models use; keep whatever the example declares and add missing ones
if "graph.encoded_values" in new:
    def add(m):
        have = [v.strip() for v in m.group(2).split(",") if v.strip()]
        for v in ("foot_access", "foot_average_speed", "foot_priority", "bike_access", "bike_average_speed", "bike_priority", "road_class",
                  "road_environment", "roundabout", "max_speed", "surface", "smoothness", "bike_network", "foot_network", "hike_rating",
                  "mtb_rating", "country", "road_access", "car_access", "car_average_speed"):
            if v not in have: have.append(v)
        return m.group(1) + ", ".join(have)
    new = re.sub(r"(?m)^(\s*graph\.encoded_values:\s*)(.*)$", add, new, count=1)
open(path, "w", encoding="utf-8").write(new)
print("patched", path)
