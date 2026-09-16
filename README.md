# UNIVAST reconstructed project

This is a reconstruction of the UNIVAST work established in the conversation.
It is not a byte-for-byte copy of the project on your PC.

- **Backend**: Node.js, Express, MongoDB/Mongoose — complete (see `backend/`).
- **Mobile**: .NET MAUI with Mapsui — landing page + full navigation flow
  (pick start/destination, get shortest walking route, view it on the map).

## Backend

```bash
cd backend
npm install
cp .env.example .env   # set MONGODB_URI
npm run dev
```

## Mobile app — important setup note

This reconstruction never had real native platform scaffolding (no
`Platforms/Android/MainActivity.cs`, no real `AndroidManifest.xml`, no iOS
`AppDelegate.cs`/`Info.plist`, etc. — `dotnet new maui` normally generates all
of that, and it wasn't part of what got reconstructed here). To actually build
and run this on a device/emulator:

1. **Scaffold a real MAUI project** (this generates the missing native
   folders): either `dotnet new maui -n UNIVAST.Mobile` on the command line,
   or File → New Project → **.NET MAUI App** in Visual Studio, named
   `UNIVAST.Mobile`.
2. **Copy these files over the scaffolded ones**: `UNIVAST.Mobile.csproj`,
   `App.xaml(.cs)`, `AppShell.xaml(.cs)`, `MainPage.xaml(.cs)`,
   `MauiProgram.cs`, and the `Models/`, `Services/`, `Pages/` folders.
3. **Merge the platform permissions** — the real scaffolding will have
   created `Platforms/Android/AndroidManifest.xml` and
   `Platforms/iOS/Info.plist` (and MacCatalyst's copy). Merge in the two
   lines/keys from:
   - `Platforms/Android/AndroidManifest.permissions.xml`
   - `Platforms/iOS/Info.plist.permissions.xml`
   - `Platforms/MacCatalyst/Info.plist.permissions.xml`

   These grant location access, needed for the "📍 My location" button.
4. **Point the app at your backend and campus**:
   - `Services/ApiConfig.cs` → `BaseUrl` already handles the Android
     emulator's `10.0.2.2` vs `localhost` split. For a physical device, use
     your machine's LAN IP or a deployed backend URL instead.
   - `Services/ApiConfig.cs` → `DefaultCampusId` is empty on purpose. Create
     your first campus and some navigation nodes/edges via the backend API
     (see `backend/README` / the API endpoints below), then paste that
     campus's `_id` in.
5. `dotnet build` / run from Visual Studio.

**Why I can't verify the mobile app compiles from here:** this sandbox has no
`.NET SDK` and no network access to restore NuGet packages (Mapsui.Maui,
MAUI workloads, etc.), so none of the C#/XAML below has been compiled — only
carefully written and cross-checked against current Mapsui/MAUI docs. The
backend (Node.js) *has* been syntax-checked and its core logic (routing
Dijkstra, Haversine, validation) unit-tested directly, since that environment
was available. Open the mobile project in Visual Studio/Rider first — it'll
surface anything that needs a small fix far faster than I can guess at it
blind. The piece most likely to need a tweak is the Mapsui drawing code in
`Pages/RoutePage.xaml.cs` (`DrawRoute` method) if your resolved Mapsui.Maui
version differs from the `4.1.8` pinned in the `.csproj` — it's isolated into
one method with a comment explaining exactly why.

### What the navigation flow does

- `Pages/RoutePage.xaml(.cs)`: loads the campus's navigation nodes into two
  pickers (Start / Destination), optionally sets Start from your current
  GPS location via `POST /api/routes/nearest-node`, then calls
  `POST /api/routes/route` and draws the returned path (markers + a line)
  on the Mapsui map, auto-zoomed to fit.
- `MainPage`'s new "🧭 Navigate" button pushes `RoutePage` via Shell routing.

## Do not

- Delete existing database data just to make the application work.
- Invent real UNICAL coordinates — use the ones the backend already has, or
  clearly-fake placeholder ones for testing.
