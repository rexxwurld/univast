# UniVast

UniVast is a general-purpose, map-first location app with a campus intelligence layer on top.

**It opens straight into a normal interactive map** (your location, search, places, selecting a place for details). You never have to pick a campus or be on one. On top of the normal map, UNIVAST admins and campus coordinators maintain **school and campus data** that ordinary maps don't have: universities, campuses, buildings, floors, rooms, lecture theatres, entrances, landmarks, with official names, common names, student slang and abbreviations ("LT1" finds "Lecture Theatre 1" wherever you are).

```
GENERAL MAP  →  GENERAL PLACES / LOCATIONS  →  UNIVAST CAMPUS LAYER
                                                  University → Campus → Building → Floor → Room / Facility
```

Four campus states are kept separate on the phone (and never stored as one global server-side state):

| State | Meaning |
|---|---|
| Normal map | No campus involved. |
| Nearby campus | The device is near a known campus; a dismissible suggestion card. Nothing opens by itself. |
| Viewing a campus | A campus is open, possibly remotely (search for it, browse it, look at LT1 from another city). |
| Checked in | The user tapped *Check in* while the backend confirms the device is inside the campus. Leaving the campus returns to the normal map. |

Active navigation is a fifth, independent state (a route being followed).

One search covers everything: `GET /api/v1/search` ranks UNIVAST data (universities, campuses, buildings, rooms, landmarks, businesses/places, aliases) first. On a *submitted* search (`geo=1`) it also appends general map places (cities, streets, businesses anywhere) from a geocoder, marked `kind: "geo"`. The response says whether the geocoder worked, and the app says so when it didn't.

**Routing is honest.** Walking directions exist for campuses that have a navigation graph. There is no general (driving / transit / cycling) routing provider, so directions to a general map place say they are unavailable; nothing is estimated or invented.

The project is a Node.js/Express/MongoDB backend API and a .NET MAUI mobile app (Mapsui map).

**Verification status:** the backend and mobile code has been written and reviewed by reading it; the .NET build and the Mongo-backed Jest tests run in GitHub Actions. Check the latest workflow run for the real state. Nothing in this README is a claim that a build passed.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Backend Setup](#backend-setup)
- [Environment Variables](#environment-variables)
- [First Admin Account](#first-admin-account)
- [Mobile App Setup](#mobile-app-setup)
- [Install on your phone (GitHub Actions)](#install-on-your-phone-github-actions)
- [API Reference](#api-reference)
- [Data Model](#data-model)
- [Security](#security)
- [What's Built vs. What's Left](#whats-built-vs-whats-left)

---

## Architecture

```
                    ┌─────────────────────────┐
                    │      UniVast Mobile     │
                    │      .NET MAUI + C#     │
                    │         Mapsui          │
                    └────────────┬────────────┘
                                 │ HTTPS / REST API
                                 ▼
                    ┌─────────────────────────┐
                    │       UniVast API       │
                    │   Node.js + Express     │
                    │       Mongoose          │
                    └────────────┬────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │        MongoDB          │
                    │  Users, Places, Reviews │
                    │  Businesses, Reports    │
                    │  Categories, + legacy   │
                    │  campus-nav collections │
                    └─────────────────────────┘
```

### The map experience (mobile)

```
Map  →  Search / Explore  →  Result  →  Place card  →  Directions / Navigation
```

- **Map:** full-screen Mapsui map (OpenStreetMap raster tiles; no custom tile styling is claimed). Floating search bar, a menu button, a "my location" button, and a "fit campus" button that exists only while a campus is open.
- **Search:** tapping the bar opens a results panel over the map (not a new screen). With nothing typed it offers real campuses from the directory. Typing searches UNIVAST data; submitting (keyboard Search key) also asks for general map places. Rows from UNIVAST campus data carry a small **UNIVAST** tag; map places sit under their own **MAP PLACES** heading.
- **Place card:** a bottom sheet (the map stays visible above it) with the place name, a source tag (**UNIVAST campus** / **UNIVAST place** / **Map place**), type, the University › Campus › Building › Floor trail for campus places, aliases (common/student names), description and facts. Map places show their coordinates and never a campus trail.
- **Directions:** shown only where a real route exists (campus walking graph). The preview names *From*, *To*, the mode (**Walking**) and the distance/time the backend returned; active navigation shows the next instruction, remaining time/distance and ETA. For a general map place UNIVAST says directions are unavailable and offers **Directions in your maps app**, which hands the point to the phone's own maps app. UNIVAST shows no route, distance, ETA, traffic or transit of its own for those places.
- **Campus context** is a phone-side concept: normal map, nearby campus (dismissible card), viewing a campus, checked in. Campus controls (campus chip, check-in, close) appear only while a campus is open; "Close campus" always returns to the plain map.

### Design system (mobile)

One restrained palette, defined once in `UNIVAST.Mobile/Resources/Styles/Colors.xaml`:

| Role | Token | Use |
|---|---|---|
| Accent | `UvBlue` (+ `UvBlueSoft`) | Primary actions, selection, your location, the active route |
| Surfaces | `UvSurface`, `UvBackground`, `UvHairline` | Cards, sheets, search bar, pages, dividers |
| Text | `UvText`, `UvMuted`, `UvOnAccent` | Primary, secondary/captions, text on the accent |
| Semantic only | `UvSuccess`, `UvWarning`, `UvDanger` | Confirmed/on campus, caution/demo/offline, errors and destructive actions |

Shared component styles (`Float`, `Sheet`, `Card`, `PrimaryButton`, `SecondaryButton`, `TonalButton`, `TextButton`, `DangerButton`, `ScreenTitle`, `PlaceName`, `Title`, `Body`, `Caption`, …) live in `Resources/Styles/UvStyles.xaml`. Map markers take their colours from the same tokens (`Services/MapPalette.cs`): UNIVAST data is neutral ink (shape tells building from landmark); the accent is reserved for you, the selection and the route. No screen defines its own colours. The app is **light-only** for now (`UserAppTheme = Light`); adding a dark theme means adding a second palette, not touching screens.

Request flow: **Routes → Middleware (auth/validation) → Controllers → Models → MongoDB**, with a centralized error handler normalizing every error into `{ message, errors? }`.

---

## Prerequisites

- Node.js LTS + npm
- MongoDB (local or Atlas)
- A free [Cloudinary](https://cloudinary.com) account (only needed for image uploads)
- For mobile: .NET SDK + MAUI workload, Android SDK, and either an emulator or a physical device

---

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in the values — see below
npm run dev             # or: npm start
```

The API listens on `http://localhost:5000` by default (`0.0.0.0`, so a phone on the same network can reach it via your machine's LAN IP).

`app.js` defines the Express app itself (no side effects); `server.js` is the thin entry point that loads env vars, connects to MongoDB, and starts listening. This split exists so the test suite can import `app.js` directly without binding a real port or touching a real database.

---

## Environment Variables

All of these go in `backend/.env` (never commit this file — `.env.example` has placeholders only):

| Variable | Required | Notes |
|---|---|---|
| `PORT` | No (defaults 5000) | |
| `MONGODB_URI` | **Yes** | Server refuses to start without it |
| `JWT_SECRET` | **Yes** | Server refuses to start without it. Generate one: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | No (defaults `15m`) | Access-token lifetime. Short on purpose — the app renews it with the refresh token |
| `REFRESH_TOKEN_DAYS` | No (defaults `30`) | Refresh-token lifetime |
| `CORS_ORIGINS` | No | Comma-separated browser origins allowed by CORS (only for a web dashboard; the mobile app isn't affected). Unset in production = no browser origins |
| `TRUST_PROXY` | No | Number of reverse-proxy hops in front of the API (usually `1` on Render/Railway/Nginx) so rate limiting sees real client IPs |
| `CLOUDINARY_CLOUD_NAME` | Only for uploads | Server starts fine without it; only `/api/v1/uploads/image` fails until set |
| `CLOUDINARY_API_KEY` | Only for uploads | |
| `CLOUDINARY_API_SECRET` | Only for uploads | |

---

## First Admin Account

There is no self-service admin signup, by design — the first admin has to be set directly in the database:

```bash
mongosh "<your MONGODB_URI>" --eval 'db.users.updateOne({email:"you@example.com"},{$set:{role:"admin"}})'
```

Once that account exists, it can promote anyone else via `PATCH /api/v1/admin/users/:id/role`.

---

## Mobile App Setup

```bash
dotnet new maui -n UNIVAST.Mobile      # scaffold fresh, verify it runs blank first
# then copy in Models/, Services/, Pages/ and overwrite MauiProgram.cs, AppShell.xaml(.cs),
# MainPage.xaml(.cs), App.xaml(.cs), and the .csproj from this project
```

`UNIVAST.Mobile/Services/ApiConfig.cs` picks the backend URL automatically:
- **Debug, Android emulator** → `http://10.0.2.2:5000`; **iOS simulator** → `http://localhost:5000`
- **Debug, physical device** (or Windows / Mac Catalyst) → your PC's LAN IP: edit `DevMachineLanHost` (phone and PC on the same Wi-Fi). Plain HTTP is allowed in **Debug builds only** (`MainApplication.cs`).
- **Release** → set the HTTPS URL in the `#else` branch (currently a placeholder). Release builds refuse plain HTTP.

Build and deploy:
```bash
cd UNIVAST.Mobile
dotnet build -t:Run -f net10.0-android
```

---

## Install on your phone (GitHub Actions)

`.github/workflows/android-apk.yml` builds a signed **APK** you can install directly, no Play Store or PC needed.

**Quickest path**
1. Push this repo to GitHub.
2. *Actions* tab > **Android APK** > **Run workflow** > tick **release** > Run. (Or push a tag: `git tag v1.0.0 && git push --tags`.)
3. When it finishes, open the repo's **Releases** page **on your phone**, download `UNIVAST-<version>.apk`, tap it, and allow "Install unknown apps" for your browser when Android asks.

Every push to `main` and every PR also builds an APK, available as the **UNIVAST-apk** artifact on the run (artifacts need a GitHub login to download; Releases don't).

**Use your own signing key (recommended, do this once)**
Without it the workflow signs with a throwaway key, so each build has a different signature and Android refuses to update the previous install (you'd have to uninstall first).
```bash
./scripts/make-android-keystore.sh      # creates univast-release.keystore, prints what to add to GitHub
```
Add these in *Settings > Secrets and variables > Actions > Secrets*: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Back the `.keystore` file up somewhere safe; never commit it (it's git-ignored).

**Point the app at a different backend**
The app talks to `https://univast-q4tg.onrender.com` (see `Services/ApiConfig.cs`). To change it without editing code, add a repository **variable** (not secret) `API_BASE_URL` = `https://your-api.example.com`. Release builds only allow HTTPS.

Notes: the APK is `arm64` only (every phone from roughly 2017 on). The version code is the workflow run number, so each new build installs over the last as long as the signing key is the same.

---

## API Reference

Base URL: `http://localhost:5000`. Endpoints under `/api/v1/` are the current discovery platform; endpoints without a version prefix are the original campus-nav engine (kept as-is so the existing mobile flow isn't broken — these will move under `/api/v1/` in a future coordinated pass).

### Auth — `/api/v1/auth`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | — | Rate-limited (10/15min) |
| POST | `/login` | — | Rate-limited (10/15min); generic error on bad email or password |
| POST | `/refresh` | — | `{ refreshToken }` → new `{ token, refreshToken, user }`. Refresh tokens are single-use (rotation) |
| POST | `/logout` | — | `{ refreshToken }` — revokes this device's session |
| POST | `/logout-all` | Required | Revokes every session for the caller |
| GET | `/me` | Required | |

`register`/`login` return `{ token, refreshToken, user }`. `token` is a 15-minute access JWT; `refreshToken` is an opaque random string (only its SHA-256 hash is stored server-side).

### Places — `/api/v1/places`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | — | Paginated, `?category=&q=` |
| GET | `/nearby` | — | `?lat=&lng=&radius=&category=&q=` — `$geoNear` aggregation, returns `distanceMeters` per place |
| GET | `/:id` | — | |
| POST | `/` | Required | |
| PATCH | `/:id` | Owner or admin | |
| DELETE | `/:id` | Owner or admin | Soft delete (`isActive: false`) |
| POST | `/:id/claim` | business/admin role | Body: `{ businessId }` — place must be unclaimed |

### Categories — `/api/v1/categories`
| Method | Path | Auth |
|---|---|---|
| GET | `/` | — |
| GET | `/:id` | — |
| POST | `/` | Required |

### Reviews — `/api/v1/reviews`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/?place=<id>` | — | Paginated |
| POST | `/` | Required | One review per user per place (unique index) |
| PATCH | `/:id` | Author or admin | `isHidden` is admin-only |
| DELETE | `/:id` | Author or admin | |

Every review write recomputes the parent Place's `ratingAvg`/`ratingCount` from scratch.

### Businesses — `/api/v1/businesses`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/` | Required | Promotes the caller's role to `business` |
| GET | `/mine` | Required | |
| PATCH | `/:id` | Owner or admin | `verificationStatus` is admin-only |

### Reports — `/api/v1/reports`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/` | Required | `{ targetType: "Place"\|"Review"\|"Business", targetId, reason }` |
| GET | `/?status=` | admin | |
| PATCH | `/:id` | admin | Resolve/dismiss |

### Admin — `/api/v1/admin` (all routes admin-only)
| Method | Path | Notes |
|---|---|---|
| GET | `/users?role=` | Paginated |
| PATCH | `/users/:id/role` | |
| GET | `/stats` | Counts: users, places, reviews, businesses, pending reports |

### Uploads — `/api/v1/uploads`
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/image` | Required | Multipart field `image`, max 5MB, jpeg/png/webp → Cloudinary, returns `{ url, publicId }` |

### Search — `/api/v1/search`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/?q=&limit=&geo=1&lat=&lng=` | — | The one search. UNIVAST results first (aliases, campus places, businesses); with `geo=1` also general map places (`kind:"geo"`). `lat`/`lng` only bias geocoder results. `geo` must be sent only for a submitted search, never per keystroke. Response includes `geo: { requested, status }` (`skipped` / `ok` / `disabled` / `unavailable`) |
| GET | `/candidates` | Admin | Diagnostics: the searchable projection (no raw documents) |

### Geocode — `/api/v1/geocode`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/reverse?lat=&lng=` | — | Free OSM Nominatim, no API key. Cached in-memory (24h TTL) |

Forward geocoding (used by `/search?geo=1`) goes through `GEOCODER_SEARCH_URL` (default: public Nominatim; max 1 request/second, no auto-complete). For real traffic, self-host Nominatim or use a compatible service, and set `GEOCODER_CONTACT`.

### Legacy campus-nav engine
`/api/v1/universities`, `/api/v1/campuses`, `/api/v1/locations`, `/api/v1/navigation` (nodes), `/api/v1/navigation-edges` — CRUD for the original campus/graph data. The navigation nodes and edges are still the walking graph the canonical campus routing uses, so this CRUD stays.

**Deprecated:** `/api/v1/routes/route` and `/api/v1/routes/nearest-node` (node-to-node Dijkstra). The mobile app no longer calls them (campus routing is `POST /api/v1/campus-data/:id/route`). They are kept unchanged for external callers, answer with `Deprecation: true` and a `Link … rel="successor-version"` header, and can be deleted (`routes/navigation.js`, `controllers/routeController.js`, `services/routingService.js`) once nobody uses them.

- **Reads are public. Every write (POST/PUT/PATCH/DELETE) requires an admin account.** The two routing endpoints are `POST` but only read, so they stay public.
- The old unversioned paths (`/api/universities`, …) were removed; only `/api/v1/*` exists.

---

## Data Model

**Platform-era (Phase 1+):** `User`, `Category`, `Place` (GeoJSON `location` + `2dsphere` index), `Review`, `Business`, `Report`.

**Legacy campus-nav (pre-Phase-1, untouched):** `University` → `Campus` → `Location`/`NavigationNode` → `NavigationEdge`.

**The bridge:** `scripts/migrateCampusesToPlaces.js` creates one `Place` per existing `Campus` (category "Educational Institution"), linked via `Place.sourceCampusId` — non-destructive, original collections are never modified. A `Place` with `sourceCampusId` set shows a "Navigate inside campus" option in the mobile app that opens the original graph-routing flow scoped to that campus.

Run it any time: `node scripts/migrateCampusesToPlaces.js` (dry run) / `--apply` (writes).

---

## Security

Implemented:
- JWT auth (15-minute access tokens) + rotating, hashed, revocable refresh tokens; bcrypt password hashing; role-based authorization (`user`/`business`/`admin`)
- Ownership checks on every mutating Place/Review/Business endpoint; admin-only writes on the legacy campus-nav routes
- Rate limiting (general + stricter on login/register + separate limit on refresh)
- Request-body validation with `zod` (unknown fields stripped) on auth, places and reviews
- `helmet` security headers, CORS allowlist (`CORS_ORIGINS`), 100 KB JSON body limit
- NoSQL injection protection (`express-mongo-sanitize`); user search text is regex-escaped before use in `/places/nearby`
- Centralized error handling that never leaks stack traces in production
- Request logging (morgan); soft deletes

Not yet done — worth knowing about before a real launch:
- HTTPS termination (put the API behind a reverse proxy / hosting platform that handles TLS; set `TRUST_PROXY`)
- Structured logging/monitoring beyond morgan (e.g. Sentry)
- Email verification and password reset
- Express 5 (not upgraded: `express-mongo-sanitize` 2.x is not compatible with it)

---

## Testing

**Backend** (Jest + Supertest, real in-memory MongoDB, never your actual `MONGODB_URI`):
```bash
cd backend
npm install    # first `npm test` downloads a MongoDB binary for mongodb-memory-server, so it needs internet once
npm test
```
Covers: registration/login/refresh-token rotation/logout, place CRUD + ownership + geo radius, reviews (uniqueness + rating aggregate), categories (admin-only), businesses + claiming a place, reports (file/list/resolve), admin API (users, roles, stats), the routing engine over HTTP (shortest path, unreachable, nearest node, admin graph CRUD), reverse geocoding (mocked Nominatim + cache), image upload guards, NoSQL-injection regressions, legacy campus-nav write protection, plus pure unit tests for Dijkstra/graph, Haversine distance and pagination (`tests/unit/`).

**Mobile** (xUnit; plain .NET, no MAUI workload or device needed):
```bash
dotnet test UNIVAST.Mobile.Tests
```
Covers the token refresh-and-retry handler (401 > refresh > replay body, session expiry, transient failures, no loops), API error unwrapping, DTO parsing, and `DiscoveryApiService` (request bodies, culture-safe URLs, create-place, reverse geocode, image upload). Page/UI code isn't unit tested; it's exercised by running the app.

CI (`.github/workflows/ci.yml`) runs both suites on every push/PR.

---

## Docker, CI

```bash
docker compose up --build     # API on :5000 + a local MongoDB
```

`.github/workflows/ci.yml` runs the backend and mobile unit tests on every push/PR; `.github/workflows/android-apk.yml` builds the installable APK (see [Install on your phone](#install-on-your-phone-github-actions)). It uses `npm install` because `package-lock.json` must be regenerated after the latest dependency changes (`helmet`, `zod`, `multer` 2) — run `npm install` in `backend/`, commit the lock file, then switch the workflow to `npm ci`.

---

## What's Built vs. What's Left

**Backend — done:** schema + geo search, auth with refresh-token rotation, place CRUD + geo aggregation, reviews + business accounts, reports/admin, rate limiting, logging, image uploads, NoSQL-injection fix, reverse geocoding, zod validation, helmet/CORS hardening, admin-only legacy writes, Jest/Supertest suite (API + unit), full route versioning, Docker + CI.

**Mobile — done, still unverified by a compiler:** discovery map with location fix + nearby markers + search + category filters, place detail with reviews/ratings/directions/call/report, login/register (MVVM view models), write-a-review, claim-a-business, campus-nav reintegration, SQLite offline cache keyed by area + category, automatic token refresh + retry/timeout policy for every API call, GPS paused when the map isn't visible, **Add place** screen (current location, reverse-geocoded address, category, optional photo upload), account button with **Log in / Create account / Log out**, xUnit test project.

**Search scaling:** `/api/v1/search` ranks an in-memory candidate list rebuilt from seven collections plus aliases, cached for 30 s (`GLOBAL_SEARCH_CACHE_SECONDS`) and cleared on writes made through the API. That is fine for pilot-size data. It could not be replaced by an indexed query without changing results: ranking includes prefix and typo-tolerant matching that a plain index cannot reproduce. The next step is a pre-filter that narrows candidates (a text/prefix index on a denormalised `searchKeys` field per entity, or Atlas Search) before this same ranking runs.

**Not built:** a general routing provider (driving / transit / cycling), offline search outside downloaded campus packs, editing/deleting your own places from the app (API exists), push notifications (needs a Firebase/APNs project), deep links, marker clustering, MVVM for the map/route/place-detail pages.

**The single most important next step:** push to GitHub and look at the two workflow runs. They are the first real compile of the app and first real run of the test suites; fix whatever they report. None of this code has been run by the tools that produced it.
