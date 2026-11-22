#!/usr/bin/env python3
"""Feed recorded Valhalla geometry into a local Android emulator."""

import argparse
import json
import math
import subprocess
import time
from pathlib import Path


def replay(serial, points, speed, interval):
    def inject(lon, lat):
        response = subprocess.run(
            ["adb", "-s", serial, "emu", "geo", "fix", str(lon), str(lat)],
            check=True,
            capture_output=True,
            text=True,
        )
        if not response.stdout.strip().endswith("OK"):
            raise SystemExit("The Android emulator rejected a location fix")
        time.sleep(interval)

    inject(*points[0])
    for (lon1, lat1), (lon2, lat2) in zip(points, points[1:]):
        north = (lat2 - lat1) * 111195
        east = (lon2 - lon1) * 111195 * math.cos(math.radians((lat1 + lat2) / 2))
        count = max(1, math.ceil(math.hypot(north, east) / (speed * interval)))
        for i in range(1, count + 1):
            fraction = i / count
            inject(lon1 + fraction * (lon2 - lon1), lat1 + fraction * (lat2 - lat1))
    # Repeat a stationary fix with movement below the arrival radius.
    inject(points[-1][0] + 0.00004, points[-1][1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("route", type=Path, help="JSON response from the KUNDE Routing API")
    parser.add_argument("--serial", required=True, help="Local adb emulator serial")
    parser.add_argument("--speed", type=float, default=12, help="Maximum meters per second")
    parser.add_argument("--interval", type=float, default=1, help="Seconds between fixes")
    arguments = parser.parse_args()
    if not arguments.serial.startswith("emulator-"):
        parser.error("an Android emulator serial is required")
    if not 0 < arguments.speed < 75 or not 0.5 <= arguments.interval <= 5:
        parser.error("speed must be between 0 and 75 and interval between 0.5 and 5")
    points = json.loads(arguments.route.read_text())["geometry"]["coordinates"]
    if len(points) < 2 or any(
        len(point) != 2 or not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90)
        for point in points
    ):
        parser.error("valid GeoJSON route coordinates are required")
    replay(arguments.serial, points, arguments.speed, arguments.interval)
    print("GPS replay complete")


if __name__ == "__main__":
    main()
