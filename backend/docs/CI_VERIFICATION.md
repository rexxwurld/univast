# Phase 2 CI verification

## Status: verified by a green CI run

| | |
|---|---|
| Workflow | `CI` (`.github/workflows/ci.yml`), run "Merge Phase 2 campus foundation #10" |
| Trigger / branch | push to `main` |
| Commit | `4250e2f` |
| Result | **Success** (total duration 49s) |
| Jobs | `backend` passed, `mobile-tests` passed |

**What this confirms.** In that run the backend job executed `npm install` and the Jest suite (real Mongoose + mongodb-memory-server + Supertest) and finished green, and the mobile job executed the xUnit project and finished green. A green job means every test in the repository at that commit passed, including the existing suites and the Phase 2 integration suites listed below. Phase 2 is therefore treated as verified by CI.

**What this record does not contain.** Per-suite and per-test counts were not captured here (only the job result was reviewed), no manual testing was performed, and no real campus data, staging database or production environment was exercised. Rows below say "covered by" a test file; they rest on the job being green, not on separately inspecting each test's output. If exact counts are needed, read them from the `backend` job log of run #10.

### Concern -> test that covers it (all part of the green run)

| Concern | Covered by |
|---|---|
| `Campus.geofence` / `Building.footprint` GeoJSON schema | `campusFoundation`, `campusAdmin`, `devFixture` |
| Unique index initialization | `campusFoundation` (duplicate floor), `campusAdmin` (duplicate building name) |
| Multer 2.x: wrong field, too many files, size, disguised files | `submissionFiles` |
| Snapping distance, `start_too_far_from_paths`, per-campus `maxSnapMeters` | `campusRouting` |
| Shortest-entrance selection | `campusRouting` |
| Away-from-campus, unknown ids (404), unroutable (422) | `campusRouting` |
| LT1 / "Lecture Theatre 1" resolve to the same room; building and entrance association | `campusFoundation`, `campusRouting` |
| Migration idempotency, id preservation, no invented geofence, legacy marking, search keys | `migrations` (in-memory database) |
| `remove:dev-fixture` cannot delete unrelated data | `devFixture` |
| Authorization matrix (anonymous, user, business, moderator, coordinator, admin) on every campus write | `campusAdmin`, `campusScope` |
| Coordinator campus scoping and admin assignment endpoint | `campusScope`, `roles` |

## CI warnings and notices (not failures)

These appeared on run #10 and are intentionally not addressed in Phase 3:

- Node.js 20 is deprecated; `actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4` and `actions/setup-dotnet@v4` are being forced onto Node 24.
- The `ubuntu-latest` label migrates to Ubuntu 26 beginning 19 October 2026.

## Known limitations / production requirements (documented, not blocking)

See "Production requirements and known limitations" in `CAMPUS_ARCHITECTURE.md`: no virus scanning of uploads; `UPLOAD_QUARANTINE_DIR` must be configured in production; legacy graph node/edge writes remain admin-only; the DEV_FIXTURE is synthetic and no real campus data has been supplied.

## Phase 3 (mobile campus map homepage)

Not yet verified. The mobile xUnit project gained campus DTO, logic, API-client and view-model tests; they count as verified only after the `mobile-tests` job (and the APK build in `android-apk.yml`) pass on the commit that contains them.
