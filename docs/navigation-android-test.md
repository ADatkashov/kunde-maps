# Android phone test for navigation (manual, about 40 minutes)

Until this is done and written up, the status is **"DEV navigation verified with simulated GPS"** only - not "real-world navigation validated".
Test on a quiet route, with a second person driving or while walking/cycling. **Never operate the phone while driving.**

## Before
- Android phone, Chrome (note the version), location ON ("high accuracy"), battery > 60 %, screen timeout default.
- Open https://kunde-maps-web-dev.onrender.com (first request may take up to a minute: Render Free cold start).
- Choose a real destination 3-6 km away in Almaty (or any city) with at least 4 turns. Note the phone model, Android and Chrome versions.

## Checklist (mark pass / fail / note)
1. **GPS permission**: search the destination -> Route -> **Start**. Chrome asks for location only now (not on page load). Deny once: the app must say that location is blocked and offer Close. Then allow in site settings and start again.
2. **Start**: banner shows "Finding your position..." then the first maneuver; the map centres on the arrow; the screen stays on.
3. **Marker movement**: the arrow follows you smoothly; with the phone held still the arrow does not wander off the road.
4. **Maneuvers**: the next-maneuver icon, text, street and distance match the real road; distance counts down; the instruction switches right after each turn; the "then" hint appears when two turns are close.
5. **Progress**: ETA, remaining time and distance decrease; the progress bar grows; the OSM attribution stays visible.
6. **Camera**: pan the map with a finger -> following stops and "Recenter" appears and the map is *not* pulled back; tap Recenter -> follows again. Pinch-zoom is kept.
7. **Rerouting**: deliberately take a different street. Within a few seconds "Rerouting..." appears, the new route replaces the old one, the destination is unchanged. Try turning back onto the original route: no reroute loop.
8. **GPS loss**: drive into a car park / tunnel / underpass (or turn location off for 15 s): "GPS signal lost" appears, nothing is invented; after the signal returns the state recovers.
9. **Background**: press the power button / switch apps for 20-60 s, then come back. Expected on Android Chrome: navigation was paused ("paused"), the app asks for a fresh fix and resumes; it does **not** guide with the screen locked (known limit). Record what actually happened (was audio/position delivered while locked?).
10. **Arrival**: reach the destination: "You have arrived", GPS stops (location icon disappears from the status bar within a few seconds), **Done** returns to the map. Drive past the destination on a parallel street in another run: it must not announce arrival.
11. **End early**: during navigation tap End once (nothing happens but "End now?"), tap again -> navigation ends, location icon disappears.
12. **Languages / theme**: repeat a short navigation in RU, KK and EN, and in dark theme (system dark mode); texts fit without overlap on your screen.
13. **Battery and heat** (20 min of navigation with the screen on): battery % drop and whether the phone becomes warm/hot. Write the numbers.
14. **Privacy**: the address bar must never contain your own position; after finishing, reload: no trace of the route.

## Report back
Phone/Android/Chrome versions, which items failed and what you saw, screenshots of the banner in any wrong state, battery drop per 20 min, approximate GPS drift at standstill. Open issues become tasks in `docs/development/next-task.md`.
