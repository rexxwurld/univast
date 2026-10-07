# Campus platform architecture (Phase 2 backend foundation)

## Decisions
1. **Extend, don't replace.** Legacy `University / Campus / Location / NavigationNode / NavigationEdge` and the `/api/v1/universities|campuses|locations|navigation|navigation-edges|routes` routers are unchanged in behaviour. New models reference the same `Campus` and the same graph nodes.
2. **Hierarchy:** University → Campus → Building → Floor → Room, plus Entrance and Landmark per campus. `campusId` is denormalized onto Floor/Room/Entrance (and `buildingId` onto Room) so campus-wide reads and offline packs need no joins; controllers enforce consistency (`controllers/campusAdminController.js`).
3. **Nothing is hard-coded.** No university, campus, room or radius appears in application logic. All of it is data. The only seed is the explicit `DEV_FIXTURE`.
4. **Provenance on every record** (`utils/provenance.js`): `dataSource` (`manual | legacy | import | DEV_FIXTURE`), `verificationStatus` (`unverified | verified | needs_verification`), `verificationNotes`. Importers must use `needs_verification` for anything uncertain. Clients receive `dataSource` and can show a "demo data" notice.
5. **Search** (`utils/campusText.js`, `utils/search.js`, `services/campusSearchService.js`): every name/alias/abbreviation/room number is reduced to a *canonical key* (lowercase, accent-free, stop-words dropped, spelling variants unified, `lecture theatre 1`/`LT 1`/`L.T. 1` → `lt1`). Keys are stored in an indexed `searchKeys` array and rebuilt on `save()`. Ranking: exact > prefix > all-tokens > token-prefix > substring > typo (never on digits, so LT1 ≠ LT2) > building-context. Whole-query category words (`hostels`, `lecture halls`) return that category. New naming patterns = add a rule to `ABBREVIATION_RULES` (or a synonym in `utils/campusCategories.js`) and run `npm run reindex:search`. MongoDB text search is not used.
6. **Geofence is per campus** (`Campus.geofence`: polygon *or* radius, plus `nearBufferMeters`). Result is `inside | near | outside | unknown`. With nothing configured the answer is `unknown` — never a guess, never a global default. GPS accuracy is echoed and `ambiguous` is set when accuracy ≥ distance-to-boundary.
7. **Routing layer** (`services/campusRoutingService.js`) sits on the unchanged, tested `utils/graph.js` Dijkstra: coordinates → geofence → nearest *outdoor* node (stairs/elevator/indoor nodes excluded; per-campus `routing.maxSnapMeters`) → Dijkstra to each routable entrance, shortest wins → building → room/floor → instructions (`services/instructionService.js`, pure). Outdoor routes end at the building entrance; the room contributes floor info only. `NavigationNode.buildingId/floorId` exist (unused) so indoor routing can be added without a migration.
   - `200 status:"ok"` route · `200 status:"away_from_campus"` (no route, no fake position) · `200 status:"start_too_far_from_paths"` · `422` destination not routable (no entrance / entrance not linked to the graph / no path) · `404` unknown ids · `400` bad input.
   - Edge `distance` is in **meters**.
8. **Campus packs** (`CampusPack`, `services/campusPackService.js`): explicit publish creates an immutable, versioned snapshot (campus, university, buildings, floors, rooms, entrances, landmarks, legacy locations, nav nodes/edges, categories). The checksum covers content only (timestamps stripped, keys sorted) so republishing unchanged data creates **no** new version. `GET …/pack/version` and `GET …/pack?sinceVersion=N` support cheap update checks. Snapshots live in MongoDB (fine at campus scale, 16 MB document cap); move to object storage if a campus outgrows that.
9. **Auth/roles:** still one system. Roles: `user, business, admin, moderator, campus_coordinator`. Campus-data writes pass `requireAuth` -> `requireRole(admin, campus_coordinator)` -> `requireCampusAccess` (`middleware/campusAccess.js`) -> campus lookup, on every write route. **`admin` is global. `campus_coordinator` is scoped:** `User.campusIds` lists the campuses they may edit; the default is empty = no access (deny by default). The check uses the id in the URL without a database lookup, so a coordinator gets the same 403 for a campus they don't manage whether or not it exists. `requireAuth` re-reads role and `campusIds` from the database on every request, so revocation is immediate. Only an admin can change assignments (`PUT /api/v1/admin/users/:id/campuses`, coordinators only; registration cannot set them), and demoting a user clears their `campusIds` so a later re-promotion cannot resurrect old access. `moderator` has no campus-data write; moderators review community contributions. Legacy campus-nav writes remain admin-only.
10. **Uploads** (`middleware/secureUpload.js`, `utils/fileSniff.js`, `services/quarantineStorage.js`, `UploadedFile`): separate from the Cloudinary image endpoint. Disk storage outside any served directory (`UPLOAD_QUARANTINE_DIR`, required in production), random extension-less names, magic-byte sniffing that must agree with extension and declared MIME, per-type size limits, sha256 for duplicate detection, status `quarantined` until a moderator acts, all-or-nothing batches, authenticated download as `attachment` with `nosniff` and a sandbox CSP. Not yet virus-scanned (add ClamAV or a provider before enabling public uploads).

## Data-migration strategy
`scripts/migrate.js` (dry-run by default, `--apply` to write) runs ordered, idempotent, additive migrations from `scripts/migrations/` and records them in `MigrationRecord`. `001-campus-foundation` labels pre-existing rows `dataSource: "legacy"`, fills `University.abbreviation` from `ShortName`, initialises `Campus.pack`, builds `Location.searchKeys` and creates indexes. It never invents a geofence and never deletes or recreates a document, so ids and references survive.

## Replacing the DEV_FIXTURE with the real campus
`npm run remove:dev-fixture` deletes only `dataSource: "DEV_FIXTURE"` rows (and their packs) and refuses if hand-made data was added under the fixture campus (override with `force`). To keep ids instead, edit the fixture campus in place through the admin API and relabel — do not change the model structure for larger data. Importers must: create records with `dataSource: "import"`, set `needs_verification` on anything not read unambiguously, and leave `navigationNodeId` null on entrances not yet tied to a walkable path (the router then refuses to route there instead of guessing).

## API summary — `/api/v1/campus-data`
Public: `GET /campuses` · `GET /:campusId/search?q=&limit=` · `POST /:campusId/locate` · `GET /:campusId/buildings[/:buildingId]` · `GET /:campusId/rooms/:roomId` · `GET /:campusId/landmarks` · `POST /:campusId/route` · `GET /:campusId/pack/version` · `GET /:campusId/pack?sinceVersion=`
Editors (`admin` anywhere; `campus_coordinator` only on assigned campuses): `POST|PATCH|DELETE /:campusId/{buildings|floors|rooms|entrances|landmarks}[/:id]` · `PUT /:campusId/geofence` · `PATCH /:campusId/settings` · `POST /:campusId/pack/publish`
Uploads (auth): `POST /api/v1/submission-files` · `GET /api/v1/submission-files` · `GET /api/v1/submission-files/:id/download`

## Community contributions (Phase 7)

Authenticated users can submit and view their own changes through `/api/v1/contributions`; evidence must be uploaded first through the quarantined submission-file route. The server verifies every evidence id belongs to the submitter, is still quarantined, and has not already been linked. Review decisions update linked evidence status as well as contribution history.

- `POST /api/v1/contributions` submits a change to a campus-owned Building, Floor, Room, Entrance, or Landmark. Only an allowlist of fields is applied after approval; identity, campus ownership, provenance and search keys are not client-controlled.
- `GET /api/v1/contributions/mine` is owner-only. `GET /api/v1/contributions` is owner-scoped for ordinary users, campus-scoped for coordinators, and globally visible only to moderators/admins. Optional coordinator campus filters cannot widen assigned scope.
- `PATCH /:id/review` allows admin, moderator, and assigned campus coordinators. Actions are `APPROVED`, `REJECTED`, and `CHANGES_REQUESTED`; the latter blocks further review until the owner resubmits.
- `PATCH /:id/resubmit` is submitter-only, retains the original target, replaces the proposed change, preserves the review trail, and returns the contribution to `SUBMITTED`.
- Rewards are awarded only after approval and are limited to one reward per submitter/target model/target record.

The mobile client provides campus discovery, prefilled correction entry, optional evidence upload, submission status and resubmission. CI tests cover ownership, campus scope, evidence association, nested duplicate digests and lifecycle transitions; they remain unverified until the current GitHub Actions run completes.

## Production requirements and known limitations (documented, not silently ignored)
| Item | Status | Needed before |
|---|---|---|
| Virus/malware scanning of uploads | **Not implemented.** Content sniffing, quarantine and sandboxed downloads reduce risk but do not detect malware. | Enabling public uploads |
| `UPLOAD_QUARANTINE_DIR` | Uploads return 503 in production if unset. Must point to a persistent, non-served, backed-up volume (a container's temp dir is lost on restart). | First production deploy |
| Legacy graph node/edge writes | Still admin-only (`/navigation`, `/navigation-edges`). Coordinators can edit buildings/rooms/entrances/landmarks but cannot yet create path nodes/edges. | Mapping tool (Phase 6) |
| Real campus data | **Not supplied.** Only `DEV_FIXTURE` exists. Replace it per "Replacing the DEV_FIXTURE" above. | Any real user |
| DEV_FIXTURE | Synthetic. Packs built from it set `containsDevFixture: true`. `scripts/devFixture.js seed` refuses in production unless `ALLOW_DEV_FIXTURE=true`. | Real launch |
| Campus-pack storage | Snapshot stored in one MongoDB document (16 MB cap). | A campus approaching that size |
| Geofence polygon | Outer ring only; self-intersection is not checked. | Complex campus boundaries |

## Routing and navigation (Phase 5)

Status: written, **not executed** (see `CHANGES.md`). Only the pure unit tests were run, under a Jest shim.

**Architecture.** One routing stack, extended rather than replaced: `utils/graph.js` (Dijkstra, unchanged) -> `services/graphCache.js` (cached, filtered graphs) -> `services/campusRoutingService.js` (origin and destination resolution, path choice, response assembly) -> `services/instructionService.js` (pure step generation) -> `controllers/campusDataController.route`. The legacy `/routes/route` node-to-node endpoint is untouched.

**Request** `POST /api/v1/campus-data/:campusId/route`
```
{ "from": { latitude, longitude, accuracyMeters?, source?: "device"|"map" } | { nodeId } | { landmarkId } | { entranceId },
  "to":   { roomId } | { buildingId } | { entranceId } | { landmarkId },
  "options": { "accessibleOnly": true }? }
```
Every id must belong to the requested campus (looked up with `campusId`, never trusted); the endpoint is public like the other campus reads.

**Response** (`status: "ok"`): `campus`, `origin {kind, latitude, longitude, name?, nodeId, snapDistanceMeters}`, `distanceMeters`, `durationSeconds`, `geometry` (LineString, `[lng, lat]`, node by node — never a straight line through buildings; starts at the user's real position when the origin is coordinates), `steps[]`, `destination {kind, name, room, floor, building, entrance, position, indoor {routed, floor, description}}`, `warnings`, `metadata`, plus the Phase 2/3 fields (`start`, `geofence`, `nodeIds`, `path`, `instructions`).
Other HTTP-200 statuses: `away_from_campus` and `start_too_far_from_paths` (no route is drawn). Failures are HTTP 400/404/422 with a `code`.

**Snapping.** Device/map coordinates are classified by the campus geofence first (`outside` -> `away_from_campus`, never silently snapped onto campus). Otherwise they snap to the nearest OUTDOOR node (stairs/elevator nodes and nodes with a floor are skipped) within `routing.maxSnapMeters`; beyond that `start_too_far_from_paths`. The snap distance is part of the route distance and geometry.

**Destination resolution.** Building -> best entrance (shortest walking route among entrances linked to the graph). Room -> its building's entrances, unless the room has an indoor node, in which case the route must reach that node. Landmark/entrance -> its graph node. Unlinked entrances/landmarks are refused (`DESTINATION_NOT_ROUTABLE`, `LANDMARK_NOT_ROUTABLE`) instead of being guessed.

**Walking rules.** Restricted edges are never used; `accessibleOnly` also drops stairs and edges with `isAccessible === false` (unknown is allowed — the response reports ignored-edge counts so this is visible); edges between different floors must be stairs/ramp/elevator or are ignored. If no vertical connection exists the room is unreachable: `INDOOR_UNREACHABLE`, not an invented route. Edge `distance` is metres; duration = distance / walking speed (default 1.34 m/s, a documented assumption; per campus override). No live data of any kind.

**Steps.** `maneuver` is one of depart, continue, slight_left, slight_right, turn_left, turn_right, sharp_left, sharp_right, u_turn, enter_building, exit_building, take_stairs, take_ramp, take_elevator, arrive. Turns under 25 degrees are merged into a continuation. Named nodes and Landmark records attached to nodes produce "Continue straight past X" / "turn left at X". Each step has `at`, `geometryIndex` and `distanceFromStartMeters` so the app can follow progress without recomputing.

**Rerouting (mobile).** The app compares each real fix with the route line. A reroute is requested only after 3 consecutive fixes further than `metadata.rerouteDeviationMeters`, with accuracy no worse than that distance, at least `rerouteMinIntervalSeconds` after the previous request, and never while one is in flight. If the request fails the current route continues and the user is told.

**Cache.** Nodes and edges per campus (plus prebuilt graphs for the default and accessible profiles) are cached; writes through Mongoose invalidate immediately, the TTL covers other servers, and `metadata.graphVersion` (content hash) changes whenever the graph does — the hook a later offline-pack phase can use. Destinations and campus settings are never cached.

**Known limitations / Phase 6 notes.** Indoor routing works only where an indoor graph exists (no real or fixture data has one yet). Progress tracking uses the nearest point on the whole route. Walking time ignores terrain and stairs speed. The graph cache is per process. Coordinators still cannot edit graph nodes/edges (legacy writes are admin-only); a mapping tool will need to set edge `type`, `isAccessible`, `isRestricted` and room `navigationNodeId`.
