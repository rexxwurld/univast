# UNIVAST product-alignment audit (rounds 1–2)

Written from reading the code. Nothing here was built or run with .NET; backend files were only syntax-checked (`node --check`) and the new pure merge logic was exercised with plain Node. GitHub Actions is the real verification.

## What already matches the vision (reuse, don't rebuild)
- Backend: universities, campuses, buildings, floors, rooms, landmarks, entrances, aliases (`Alias` + `searchKeys`), provenance, coordinator scoping, contributions/moderation, packs, campus routing, discovery.
- One global search service already exists (`services/globalSearchService.js`, `GET /api/v1/search`) covering universities, campuses, buildings, rooms, landmarks and places with alias matching ("LT1" works).
- Mobile: map, live location, campus search, destination sheet, route preview/guidance, offline packs, contribution center, student finder.

## Where the app still assumes "campus-only" (not yet fixed)
1. `CampusMapViewModel` start-up is a campus state machine (`LoadingCampuses → NeedsCampusChoice → LoadingCampus → Ready`). With zero campuses the user gets `NoCampuses`, not a map. Users are forced to pick a campus. **This is the main conflict and is the next step.**
2. `MainPage` map is built around campus layers (buildings/landmarks/entrances); `FitCampus` is the default camera. Plain OSM raster tiles, no place POIs.
3. Presence banner / campus chip assume a selected campus.
4. General routing: only the campus walking graph exists. There is **no** driving/transit/cycling provider anywhere. Nothing may be faked; this needs a provider decision.
5. Legacy `RoutePage` (`ApiConfig.DefaultCampusId`) and `NearbyPlacesPage` are separate older flows that overlap with the main map.

## Duplication / quality findings
- Two search implementations: `campusSearchService` (one campus, has floors/buildings) and `globalSearchService` (everything, lacks floor context). Both use `utils/search.js`; they should stay separate in scope but share ranking (they do).
- `globalSearchService` loads every searchable record from 7 collections on every query. Fine for a pilot, will not scale. Needs an index or short-lived cache with write invalidation.
- `GET /api/v1/search/candidates` was public and returned raw DB documents. **Fixed this round** (admin-only, projection only).
- Backend had only reverse geocoding: no way to find a city, street or business. **Added this round.**
- `KIND_PRIORITY` ignored university/campus/place for tie-breaks. **Fixed.**
- Legacy campus collections (`Location`, unversioned routers) still coexist with the Phase 2+ models.

## Changed this round (unified search, step 2)
Backend: `utils/geocode.js` (forward geocoding, 1 req/s serialization, cache, swappable provider), `utils/searchMerge.js`, `services/globalSearchService.js`, `routes/v1/search.js`, `utils/search.js`, `.env.example`, tests (`phase6GlobalSearch`, `unit/searchMerge`).
Mobile: `CampusDtos.cs`, `ICampusApi`/`CampusApiService`, `CampusPresentation.cs`, `CampusMapViewModel.cs`, `MainPage.xaml.cs`, tests (`GeneralMapSearchTests`, fake updated). Also the `Menu_Tapped` ambiguity fix.

Behaviour: UNIVAST results always rank first; general map places (`kind:"geo"`) are appended only on a submitted search (`geo=1`), never per keystroke (Nominatim policy). The response says whether the geocoder worked (`geo.status`) and the app tells the user when it didn't. Directions to a general place say plainly they're unavailable.

## Not done yet
- Map-first home (no forced campus) — next.
- General routing provider — needs your choice (e.g. self-hosted OSRM/Valhalla/GraphHopper).
- Map styling/POI polish, README rewrite, removing legacy duplicates, search scalability.
- Backend Mongo-backed tests and all .NET builds/tests: not run.

## Round 2: map-first start-up (implemented, not compiled)
- `CampusMapViewModel`: start-up no longer selects/loads a campus. `HomeState` is now Ready / LoadingCampus / CampusFailed; removed LoadingCampuses, CampusesFailed, NoCampuses, NeedsCampusChoice. New `CampusContext` (None / Nearby / Viewing / CheckedIn), `NearbyCandidates` suggestion (only real backend inside/near answers; a lone far-away campus is not suggested), explicit `CheckInAsync` (needs backend "inside"), `ExitCampus`, auto-exit when a checked-in user leaves, `Notice`, `PickerChoices`.
- Search from the plain map: room/university/campus results open their campus remotely; geo results are pinned; a campus missing from the directory never falls back to a different campus.
- `MainPage.xaml`: campus chip/presence/check-in/close only while a campus is open; dismissible "near you" card; inline loading/error; removed "No campuses" and full-screen error cards; picker reworded (view any campus from anywhere).
- Live location start is idempotent (`_liveStarted`).
- Backend: global-search candidate cache (TTL + write invalidation), `campusContextService` documented as a non-routed reference model (no server-side per-user state).

## Still open
- A compiler run (CI) for the mobile app and the mobile tests; Jest run for the backend (needs node_modules + mongodb-memory-server).
- Map styling/POI polish beyond current layout; Mapsui still shows plain OSM raster tiles.
- General routing provider; offline search outside downloaded packs.
- Legacy duplicates not removed yet: `RoutePage`/`DefaultCampusId`, `NearbyPlacesPage` overlap, legacy `Location`-based campus endpoints.
- Search still scans an in-memory candidate list (cached); an indexed query is needed at scale.
- Check-in is tracked for the open campus only (opening another campus clears it).

## Round 3: maps-style UI, design system, legacy cleanup (implemented, not compiled)
Legacy decisions (each checked for callers first):
| Item | Finding | Decision |
|---|---|---|
| `RoutePage` + `ApiConfig.DefaultCampusId` | Hard-coded dev campus id; reachable from the menu and from a campus-linked place; node-picker duplicate of campus routing | **Removed.** Menu entry removed; the place's "View on campus map" now sends `ViewCampusOnMapMessage` and the map opens that campus |
| `UnivastApiService` + `NavigationNodeDto`, `NearestNodeResponse`, `RouteResponse` | Only used by `RoutePage` | **Removed** (incl. DI/HTTP registration) |
| `NearbyPlacesPage` | Category browsing, favourites and offline area cache for businesses; not covered by map search | **Kept**, restyled; reachable from the menu |
| Backend `/api/v1/routes/*` | Legacy API; two tests guard it; no client left | **Kept, deprecated** (headers + docs) pending an announced removal |
| Backend `campusContextService` + its test | Not used by any route; duplicated mobile logic | **Removed** |
| `campusSearchService` vs `globalSearchService` | Per-campus search (floors, buildings) vs everything | **Kept both**, shared ranking in `utils/search.js`; folding the campus one into `/search?campusId=` is a future API change |
| `Location` model/endpoints | Still feed legacy campus search results and migrations | **Kept** |

Search scalability: only the cache was added; a pre-filter needs a denormalised, indexed `searchKeys` (see README).
