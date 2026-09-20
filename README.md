# UniVast

UniVast is a map-first location discovery platform: browse and search nearby places (restaurants, hospitals, shops, and more), view rich place profiles, save favorites, leave reviews, and — for businesses — claim and manage listings. It also retains its original feature as a campus indoor/outdoor walking-navigation graph, now reintegrated as one feature within the broader app rather than the whole product.

The project consists of a Node.js/Express/MongoDB backend API and a .NET MAUI mobile application.

**Current state:** the backend (all phases below) is unit/syntax-verified but has not been run against a live server in this environment (no network access during development). The mobile app has been written carefully against real documentation and statically checked (brace balance, XAML validity, every event-handler binding) but **has not yet been compiled** — there is no .NET SDK available in the environment this was built in. Build it and report back before assuming any of it works.

---

## Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Backend Setup](#backend-setup)
- [Environment Variables](#environment-variables)
- [First Admin Account](#first-admin-account)
- [Mobile App Setup](#mobile-app-setup)
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

### Geocode — `/api/v1/geocode`
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/reverse?lat=&lng=` | — | Free OSM Nominatim, no API key. Cached in-memory (24h TTL) |

### Legacy campus-nav engine
`/api/v1/universities`, `/api/v1/campuses`, `/api/v1/locations`, `/api/v1/navigation` (nodes), `/api/v1/navigation-edges`, `/api/v1/routes/route`, `/api/v1/routes/nearest-node` — full CRUD + Dijkstra routing.

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

```bash
cd backend
npm install    # first run downloads a real MongoDB binary for mongodb-memory-server — needs internet once
npm test
```

Tests run against a real, temporary, in-memory MongoDB — never your actual `MONGODB_URI` — via `app.js` directly (no port binding, no real network calls). Covers: registration/login/duplicate-email/wrong-password, place CRUD + ownership + geo search radius filtering, review uniqueness + rating-aggregate sync on create/delete, category admin-only creation, two regression tests for the NoSQL-injection fix, refresh-token rotation/logout, and admin-only writes on the legacy campus-nav routes.

**Caveat:** written carefully but never actually run in this environment (no network access to `npm install` here). `npm test` on your machine is the real first run.

---

## Docker, CI

```bash
docker compose up --build     # API on :5000 + a local MongoDB
```

`.github/workflows/ci.yml` runs the backend tests and an Android build of the MAUI app on every push/PR. It uses `npm install` because `package-lock.json` must be regenerated after the latest dependency changes (`helmet`, `zod`, `multer` 2) — run `npm install` in `backend/`, commit the lock file, then switch the workflow to `npm ci`.

---

## What's Built vs. What's Left

**Backend — done:** schema + geo search, auth with refresh-token rotation, place CRUD + geo aggregation, reviews + business accounts, reports/admin, rate limiting, logging, image uploads, NoSQL-injection fix, reverse geocoding, zod validation, helmet/CORS hardening, admin-only legacy writes, Jest/Supertest suite, full route versioning, Docker + CI.

**Mobile — done, still unverified by a compiler:** discovery map with location fix + nearby markers + search + category filters, place detail with reviews/ratings/directions/call/report, login/register (MVVM view models), write-a-review, claim-a-business, campus-nav reintegration, SQLite offline cache keyed by area + category, automatic token refresh + retry/timeout policy for every API call, GPS paused when the map isn't visible.

**Not built:** camera/gallery picker wired to the upload endpoint, "create place" screen (with reverse-geocode autofill), a log-out button in the UI (`AuthService.LogoutAsync` exists), push notifications (needs a Firebase/APNs project), deep links, marker clustering, MVVM for the map/route/place-detail pages.

**The single most important next step, regardless of anything above:** run `dotnet build` on the mobile app and `npm install && npm test` on the backend. None of the code in this repo has been run by the tools that produced it.
