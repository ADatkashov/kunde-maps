# KUNDE Maps — product vision

KUNDE Maps is an independent Kazakhstan-first map platform (Almaty first, then nationwide, then Central Asia). It is part of the
KUNDE ecosystem but must work as a standalone product and as an API/SDK for KUNDE apps and B2B customers.

Core journey: **open the map -> find a place -> read about it -> get a route -> arrive.**

Principles
- Real data only: OpenStreetMap-derived (ODbL), provenance and attribution kept. No invented places, ratings, traffic or ETA.
- No Google/Yandex/2GIS tiles, imagery, POIs or routing without explicit rights.
- RU / KK / EN, including transliterated search. Almaty-first quality.
- Privacy: user location is used on the device only unless the user opts in; never logged.
- Small, verified increments; every claim backed by an executed test.

Platforms (in order): Web (done: map + search) -> Android/iOS (Flutter) -> KUNDE Super App via SDK/API -> B2B API.
KUNDE integration happens through a documented contract; the main KUNDE repository is not modified by this project.
