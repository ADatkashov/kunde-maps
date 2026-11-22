# Phase 6 native Android device validation

**Status: open.** This record covers the signed KUNDE Maps Android Release
APK v0.6.0 (build 1), configured for DEV. The results below come from the
user's test on a physical Android device. Device model and Android version
were not reported. [Tested APK artifact](https://github.com/ADatkashov/kunde-maps/actions/runs/45039349274/artifacts/14760848755)

| Scenario | Result |
| --- | --- |
| Install and launch the signed APK | PASS |
| Render the Almaty map, roads and buildings | PASS |
| Search for addresses and businesses | PASS |
| Open a place card | PASS |
| Obtain the current GPS location | PASS |
| Build an A → B route | NOT TESTED |
| Update maneuvers, remaining distance and ETA during navigation | NOT TESTED |
| Play voice guidance | NOT TESTED |
| Continue navigation while the screen is locked | NOT TESTED |
| Stop navigation GPS updates and clear the notification after ending the trip | NOT TESTED |

## Remaining physical Android checks

Use the same signed APK outdoors with a network connection. Allow precise
location while using the app and allow notifications if Android prompts.
Enable voice guidance and set audible media volume. Choose a short walking
route with at least one turn. Set A to your current position and select
a nearby public destination for B. Use a route with enough distance after
the turn to check the locked screen before arrival.

1. Build A → B. Check that the route follows the mapped paths or roads and
   shows the destination, distance and estimated time.
2. Start navigation and walk toward the first turn. Check that the GPS marker
   moves, the next maneuver advances after the turn, and remaining distance
   and ETA refresh with progress.
3. Listen for an audible instruction that matches the displayed maneuver.
4. Before arrival, lock the screen and keep walking for about one minute.
   Check that the navigation notification remains active and that route
   progress has advanced when you unlock the phone.
5. While still en route, tap **End navigation**. Check that the notification
   clears and that the app stops following GPS and issuing instructions.
   Where Android exposes active location use for the app, verify it ends.

Record the device model, Android version, app build and result for each step.
Leave any step you did not exercise as **NOT TESTED**. The
[mobile runbook](../apps/mobile/README.md#emulator-and-simulator-checks)
also documents emulator checks. Physical iPhone validation is tracked
separately and remains open.

## Phase 6.1 follow-up

The owner subsequently reported that routing did not work on the same
0.6.0 build. The exact points, error message and device logs were
unavailable. The Flutter client used the same HTTPS GET contract as the
web planner. The server decodes the Valhalla polyline and returns GeoJSON.
The client sends `lat,lon` per endpoint and renders `[lon,lat]` geometry.

The client could lose endpoint taps on interactive map features, reject
a usable route when an optional alternative was malformed, and report
distinct route errors as generic failures. The route line now uses
explicit native GeoJSON style layers. The planner keeps its build/start
action visible. Logs contain fixed failure categories and omit locations.

For a public DEV check, request
`GET /v1/route?from=43.238194,76.944980&to=43.255500,76.955326&mode=car&lang=ru&alternatives=1`
on `https://kunde-maps-routing-dev.onrender.com`. The Flutter client received
2,817 m, 219 seconds, five geometry positions and two alternatives for
this request. The Android emulator rendered the selected route in the
production MapLibre style using the live API. The report of the original
device failure still needs a retest with the new signed build.
