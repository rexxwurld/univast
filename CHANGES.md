## Maps-style UI, one design system, legacy cleanup (latest)

- **Design system:** one palette (`Colors.xaml`: one accent, neutral surfaces, semantic success/warning/danger) and one set of component styles (`UvStyles.xaml`). `App.xaml` now actually merges the colour and style dictionaries (before, they were never loaded). The purple template palette, the Material blue, the green contribution theme, the amber stars and the orange/teal/red/green map markers are gone; every page and the map use the tokens. App is light-only; icon, splash and Android theme colours match.
- **Map UI:** campus chips on neutral surfaces, place card with source tag / hierarchy / aliases / coordinates, honest directions block (From, To, mode, distance/time) , "Directions in your maps app" handoff for general places, search panel with campus Explore list and UNIVAST tags, route line with a white casing, user location halo, selection pin.
- **Legacy:** removed the old node-picker `RoutePage`, `UnivastApiService`, the hard-coded `DefaultCampusId` and the three DTOs only they used; a place that belongs to a campus now opens that campus on the map. Removed the unused backend `campusContextService` (context lives on the phone). The deprecated node-to-node routing API stays, announced with `Deprecation` headers.
- **Search:** candidate cache + write invalidation, `/search/candidates` admin-only.

## Map-first start-up + unified search (latest)

- Mobile: app opens to the normal map; no campus is selected, required or force-loaded. The campus list loads in the background (search + "near you"). New `CampusContext` (None / Nearby / Viewing / CheckedIn), dismissible nearby-campus suggestion, explicit check-in (needs backend "inside"), "Close campus" / leaving a checked-in campus returns to the map, inline (non-blocking) campus load errors, general map places pinned on the map, honest "directions unavailable" for them.
- Removed states: `LoadingCampuses`, `CampusesFailed`, `NoCampuses`, `NeedsCampusChoice` and their full-screen UI.
- Backend: `/api/v1/search?geo=1` forward geocoding, `/search/candidates` now admin-only, search candidate cache with write invalidation.

# Phase 7-10 implementation update (2026-10-06)

**Implementation status:** the mobile offline-pack, student discovery, and contribution flows are now wired into the application. Backend contribution privacy, evidence ownership, approval history, and duplicate-detection issues were hardened. This code has not been built or tested locally; current CI is the verification gate.

## Offline campus packs
- The mobile app checks the published pack version when a campus opens and refreshes the complete snapshot in app-private SQLite storage.
- Canonical JSON uses recursively sorted object keys and server-compatible UTF-8 output for SHA-256 verification. Corrupt or unsupported-schema packs are not used; the store preserves fixture provenance and upgrades its SQLite schema without discarding existing rows.
- Live campus loads remain preferred. A validated local snapshot backs up building/landmark loading and campus search when requests fail; the map exposes an offline indicator.
- Offline search is intentionally a useful name/alias/abbreviation/room/floor substring fallback, not a replacement for server ranking, typo handling, or full navigation. No claim of offline turn-by-turn routing is made.

## Student campus finder
- Added a mobile campus finder for the existing data-driven discovery endpoint, available from the map menu and scoped to the selected campus.
- The server bounds discovery queries to 100 characters; the response continues to be a projection over active campus data and does not introduce hard-coded student terminology.

## Contributions and moderation
- Added a mobile contribution center with typed submission/list clients, target validation, proposed-change JSON validation, optional quarantined evidence uploads, and the user's moderation status/reward display.
- Evidence IDs are accepted only when the files are owned by the submitter, quarantined, and not already linked; successful submissions link evidence to the contribution.
- Ordinary users can only list their own contributions; campus coordinators are limited to assigned campuses even when a query campus is supplied; admins and moderators retain global review visibility.
- Approval history now preserves the prior status, and nested proposed changes are recursively canonicalized for duplicate detection. Added regression tests in `backend/tests/contributions.test.js` (not run locally).

## Verification boundary
- VS Code diagnostics reported no errors for touched C#/XAML/JavaScript files during editing.
- No test suite, backend syntax command, .NET build, or device launch was run in this round. GitHub Actions remains responsible for executable verification as requested.
- Real device rendering and native input-control contrast remain unverified until CI/deployment and device validation are available.
- Phase 6 global search source was corrected to return canonical query text, match campuses through their university context, and resolve room-result coordinates from the owning building. Its existing regression suite has not yet run on this revision.

# Phase 6 status update (current repo state)

This repository is in a partial Phase 6 state:

- Completed: global search across universities, campuses, buildings, rooms, landmarks and places; campus-aware search selection; campus context state distinction (viewing/nearby/checked-in/navigating); backend non-Mongo unit tests are passing.
- Deferred: the heavy Mongo-backed admin/publish and database integration tests remain outside the current verification scope, as requested.
- Not claimed complete: the full master Phase 6 prompt is not fully implemented or fully verified end-to-end.

The implementation work above is intentionally limited to the non-Mongo Phase 6 pieces that already exist in the repo and the verified campus-context fixes.

---

# Phase 5: campus routing and turn-by-turn navigation

**Written but not executed in the current environment.** No Node dependencies and no .NET SDK were available, so the backend Jest suites, the mobile xUnit tests and the MAUI build have NOT been run. Only these were run: `node --check` on every backend file, the pure backend unit tests (instruction steps, walking-time maths, graph edge filtering) under a small Jest shim, and structural checks (brace balance, XAML well-formedness) on the C#/XAML. Nothing was pushed or committed. See `backend/docs/CAMPUS_ARCHITECTURE.md` ("Routing and navigation") for the full description.

Backend (extends the Phase 2 routing layer; Dijkstra in `utils/graph.js` is unchanged)
- `POST /api/v1/campus-data/:id/route` now returns a structured route: `campus`, `origin`, `distanceMeters`, `durationSeconds`, `geometry` (GeoJSON LineString following graph edges), `steps[]` (maneuver, text, distance, duration, position, geometry index, cumulative distance, landmark/building/entrance/floor), `destination` (with `position` and an `indoor` description), `metadata` (walking speed, reroute deviation/interval, arrival radius, graph version, accessible-only, ignored-edge counts). All Phase 2/3 fields are kept.
- New origins: `{ entranceId }`; coordinates may carry `source: "device" | "map"`. New option `options.accessibleOnly`. Each origin shape is strict (two kinds at once are rejected).
- Edges gain optional `type` (path/road/stairs/ramp/elevator), `isAccessible` (null = unknown), `isRestricted`. Restricted edges are never routed; an edge between two different floors that is not stairs/ramp/elevator is ignored as invalid data. Rooms gain an optional indoor node (`navigationNodeId`): with it the route continues inside (including stairs/ramps/elevators); without it the route ends at the entrance and the room is only described. No indoor corridors are invented.
- Per-campus routing settings: `walkingSpeedMetersPerSecond` (default 1.34 m/s), `rerouteDeviationMeters` (30), `rerouteMinIntervalSeconds` (15), `arrivalRadiusMeters` (15), editable through `PATCH /:id/settings`.
- Graph cache (`services/graphCache.js`): nodes, edges and prebuilt graphs per campus, invalidated by writes through Mongoose, a TTL (`ROUTING_GRAPH_CACHE_SECONDS`, default 60, 0 disables) and a content hash exposed as `metadata.graphVersion`.
- Errors carry a stable `code` (NO_ROUTE, DESTINATION_NOT_ROUTABLE, INDOOR_UNREACHABLE, ORIGIN_NOT_FOUND, ...); `ApiError`/`errorHandler` support it for any endpoint.
- Instruction generator (`services/instructionService.js`) now builds structured steps: small direction changes are merged, U-turns, take stairs/ramp/elevator, enter/exit building, landmark names from nodes and attached Landmark records. Existing step texts are unchanged.

Mobile
- Route preview ("Start navigation" never fires automatically), active guidance (current instruction, distance to it, next instruction, remaining distance/time, ETA), arrival, "End navigation", follow/overview camera, route line and destination marker on the Mapsui map.
- Progress tracking from real fixes only (`RouteProgressTracker`), reroute policy (`RerouteGate`: deviation and interval come from the backend; 3 consecutive off-route fixes; no overlapping requests; honest messages when offline — "Connection unavailable. Continuing with the current route.").
- Location: new `LocationUpdateProfile` (Navigation = best accuracy every 2 s, only while navigating; Browse = medium every 8 s); subscriptions and high-frequency updates are released on end/arrival/page hide and restored on resume.
- Friendly messages for every routing error code; older backends (no geometry/steps) still preview, but cannot be followed.

Tests written (not run): `backend/tests/campusRoutingPhase5.test.js`, additions to `backend/tests/unit/instructions.test.js`, `unit/routeMetrics.test.js`, `unit/graphFilter.test.js`, and `UNIVAST.Mobile.Tests/CampusNavigationTests.cs` (+ fakes in `CampusTestSupport.cs`).

Known limitations: progress uses the nearest point on the whole route (a route that doubles back close to itself can mislead it); no voice guidance; no offline navigation (packs are a later phase); indoor guidance exists only where an indoor graph has been mapped; the DEV_FIXTURE has no indoor graph (indoor routing is tested with data created inside the tests); walking time ignores elevation, crowds and stairs speed.

---

# Phase 4: campus search (mobile; builds on the Phase 3 homepage)

**Not compiled or run** (no .NET SDK in the authoring environment, so neither the mobile build nor the xUnit tests were executed). Nothing here has been pushed or committed.

What changed
- Search box: placeholder "Where do you want to go?", large touch targets, keyboard Search key (immediate search), 100-character limit that matches the backend, keyboard closes when a result is chosen or search is cancelled.
- Search flow (`CampusMapViewModel`): query is trimmed and whitespace-collapsed (`SearchQuery.Normalize`) and otherwise sent exactly as typed to `GET /api/v1/campus-data/:id/search`. **All matching, aliases (LT1 / Lecture Theater 1), abbreviations and ranking stay in the backend**; the app has no alias table and does not re-rank. Typing is debounced (350 ms); a newer search cancels the older one, and an older response can never overwrite a newer one or a result from a previously selected campus.
- Short-lived per-campus cache (`SearchCache`, 2 min TTL, 20 entries, failures never cached, cleared on campus switch). Search never downloads the campus database; details load only when a result is selected.
- Results: grouped BUILDINGS / ROOMS / LANDMARKS / PLACES (legacy campus locations) and NEARBY PLACES (existing UNIVAST places/businesses from `GET /api/v1/places/nearby?q=`, searched around the selected campus's centre; their failure never breaks campus results; choosing one opens the existing place detail screen). Each row shows name, type line ("Room · Lecture hall"), a context line for rooms ("Block One · Ground Floor") and a "Demo" tag for `DEV_FIXTURE` data. IDs are never shown. The backend's `ambiguous` flag is surfaced as a hint.
- Destination sheet: University › Campus › Building › Floor trail. If a hit has no coordinates, the room/building detail endpoint resolves the position; if none can be resolved the user is told, and nothing is invented.
- Errors: new friendly messages for 401/403; empty state wording is now "No results found" / "Try a building name, room number, landmark, or abbreviation."
- Navigation hand-off, away-from-campus behaviour and campus switching are unchanged from Phase 3 (covered by new tests).
- Backend: no changes.

Tests added (not run): `CampusSearchTests.cs` (query normalization, cache, result presentation, hierarchy trail, stale-response handling, debounce, caching, failures, places, selection, coordinate resolution, campus switching, away-from-campus search, place adapter). One existing Phase 3 assertion was updated for the new required empty-state wording; none were removed or loosened.

Known limitations: one-character queries search the campus only (not places); the places search radius is the original screen's 3 km around the campus centre; no offline search; no photos.

---

# Phase 3: campus map homepage (mobile)

**Not compiled here** (no .NET SDK in the authoring environment): `mobile-tests` and the APK workflow are the first real build. See the Phase 3 report.

- `MainPage` is now the campus-first Mapsui map (search overlay, markers, destination sheet, "Navigate from here", away-from-campus state). All data comes from `/api/v1/campus-data`; nothing campus-specific is hard-coded.
- The previous places/businesses homepage is preserved unchanged as `NearbyPlacesPage` (menu: "Nearby places & businesses"); login, registration, reviews, reports, add-place and the route planner remain reachable.
- New: `CampusMapViewModel`, `ICampusApi`/`CampusApiService`, `ILocationProvider`/`MauiLocationProvider`, campus DTOs and pure presentation logic. Backend unchanged.
- `backend/docs/CI_VERIFICATION.md` updated from "not verified" to the actual CI result for run #10.

---

# Phase 2: campus data foundation (backend)

**Not compiled or run end-to-end** (no npm/.NET access where it was written). The pure-logic unit tests were run with a small Jest shim and pass; everything touching MongoDB/Express/Mongoose is first-run on CI. See `backend/docs/CAMPUS_ARCHITECTURE.md`.

- New models: Building, Floor, Room, Entrance, Landmark, CampusPack, UploadedFile, MigrationRecord. Extended: University, Campus (geofence, routing, mapMetadata, pack), NavigationNode/Edge, Location (provenance, search keys), User roles (+moderator, +campus_coordinator).
- New API `/api/v1/campus-data/*` (search, locate/geofence, buildings/rooms/landmarks, route + instructions, packs, editor CRUD) and `/api/v1/submission-files` (quarantined PDF/photo/video uploads).
- `DEV_FIXTURE` seed (`npm run seed:dev-fixture`, `npm run remove:dev-fixture`); data migration runner (`npm run migrate`, `migrate:apply`).
- Coordinator scoping: `User.campusIds` + `requireCampusAccess` (deny by default); admin assigns via `PUT /api/v1/admin/users/:id/campuses`; admin remains global.
- Legacy campus routes, Dijkstra graph, places/reviews/businesses and the Cloudinary image upload are unchanged.

---

# Latest round: tests, installable APK, Add-place

**Still nothing here has been compiled or run** (no .NET SDK / npm network access where it was written). The pure-logic backend unit tests (graph, distance, pagination) *were* executed with a small Jest shim and pass; everything else is first-run on GitHub Actions.

## Tests
- Backend: businesses + claim flow, reports, admin, routing engine over HTTP, reverse geocoding (mocked fetch), upload guards, unit tests for graph/distance/pagination.
- Mobile: new `UNIVAST.Mobile.Tests` (xUnit) covering `AuthHeaderHandler` refresh/retry, `ApiResponse`, DTOs, `DiscoveryApiService`. `TokenStore` now implements `ITokenStore` so the handler is testable without SecureStorage.
- `ci.yml` runs both suites (Mongo binary cached).

## Install on a phone
- `android-apk.yml`: signed arm64 APK on every push/PR (artifact), GitHub Release on `v*` tags or manual run. Own key via 4 secrets (`scripts/make-android-keystore.sh`); otherwise a throwaway key. Optional `API_BASE_URL` variable. See README.

## Features
- Add place screen (location, reverse-geocoded address, category, optional photo upload) + "Add place" button; map refreshes after creating.
- Account button on the map: log in / create account / log out.
- Fixed: nearby/geocode URLs used the device culture for decimals (broken on comma-decimal locales).
- Manifest: photo-picker permissions (READ_MEDIA_IMAGES, READ_EXTERNAL_STORAGE <= API 32).

## Not done
Marker clustering, push notifications, edit/delete own place in the app, MVVM for map/route/detail pages, Express 5.

---

# Changes in this round

**Nothing here has been compiled or run** (no .NET SDK / npm network access where it was written). First steps:
`cd backend && npm install && npm test`, then `dotnet build` the mobile project. Commit the regenerated `package-lock.json`.

## Backend
- Legacy campus-nav routes: writes now require an admin (`requireAdminForWrites`); unversioned `/api/*` aliases removed.
- Refresh tokens (rotating, hashed): `/auth/refresh`, `/auth/logout`, `/auth/logout-all`; access token now 15 min.
- zod validation (auth, places, reviews); `helmet`; CORS allowlist; `TRUST_PROXY`; 100 KB JSON limit; multer 1.x -> 2.x.
- Fixed regex injection / ReDoS in `/places/nearby?q=`.
- New tests: refresh tokens, legacy-route auth. Dockerfile, docker-compose.yml, GitHub Actions CI.

## Mobile
- Manifest: removed background/hidden-profile/media location permissions; cleartext HTTP Debug-only; `allowBackup=false`.
- `ApiConfig`: emulator / device / release URLs. `App.CreateWindow` instead of obsolete `MainPage`.
- One `AddUnivastApiClients()` (auth handler with auto refresh + retry, resilience policy) replacing 6 copy-pasted registrations;
  shared `ApiResponse.EnsureSuccessOrThrowAsync` replacing 6 copies; `TokenStore` keeps the refresh token.
- Login/Register converted to MVVM (`CommunityToolkit.Mvvm`).
- Offline cache moved from a single Preferences blob to SQLite keyed by area + category.
- Mapsui 5 fix: `IsMapInfoLayer` / `MapInfo` removed in v5 -> `GetMapInfo(layers)`.
- GPS tracking stops while the map page is hidden; `DisplayAlert` -> `DisplayAlertAsync`.

## Not done
Marker clustering, image picker + upload UI, create-place screen, push notifications, MVVM for map/route/detail pages,
logout button, Express 5.
