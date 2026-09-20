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
