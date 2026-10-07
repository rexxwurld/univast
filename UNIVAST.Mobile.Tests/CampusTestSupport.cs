using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

public sealed class FakeCampusApi : ICampusApi
{
    public Func<List<CampusSummaryDto>> Campuses { get; set; } = () => new();
    public Func<string, List<CampusBuildingDto>> Buildings { get; set; } = _ => new();
    public Func<string, List<CampusLandmarkDto>> Landmarks { get; set; } = _ => new();
    public Func<string, string, CampusSearchResponseDto> Search { get; set; } = (_, _) => new() { Results = new() };
    public Func<string, CampusSearchResponseDto> GlobalSearch { get; set; } = _ => new() { Results = new() };
    /// <summary>When set, replaces Search and lets a test hold a response back (to prove stale answers are ignored).</summary>
    public Func<string, string, CancellationToken, Task<CampusSearchResponseDto>>? SearchAsyncOverride { get; set; }
    public Func<string, CancellationToken, Task<CampusSearchResponseDto>>? GlobalSearchAsyncOverride { get; set; }
    public Func<string, double, double, CampusLocateResultDto> Locate { get; set; } = (_, _, _) => new() { Status = "unknown" };
    public Func<string, CampusBuildingDetailDto> BuildingDetail { get; set; } = id => new() { Id = id };
    public Func<string, CampusRoomDetailDto> RoomDetail { get; set; } = id => new() { Id = id };
    public Func<CampusRouteFrom, CampusRouteTo, CampusRouteResponseDto> Route { get; set; } = (_, _) => new() { Status = "ok" };
    public List<CampusRouteOptions?> RouteOptions { get; } = new();
    /// <summary>When set, replaces Route and lets a test hold a reroute response back.</summary>
    public Func<CampusRouteFrom, CampusRouteTo, Task<CampusRouteResponseDto>>? RouteAsyncOverride { get; set; }

    public int CampusCalls, BuildingCalls, LandmarkCalls, SearchCalls, LocateCalls, RouteCalls;
    public List<string> SearchQueries { get; } = new();
    public List<(CampusRouteFrom From, CampusRouteTo To)> RouteRequests { get; } = new();

    public Task<List<CampusSummaryDto>> GetCampusesAsync(CancellationToken ct = default) { CampusCalls++; return Task.FromResult(Campuses()); }
    public Task<List<CampusBuildingDto>> GetBuildingsAsync(string campusId, CancellationToken ct = default) { BuildingCalls++; return Task.FromResult(Buildings(campusId)); }
    public Task<List<CampusLandmarkDto>> GetLandmarksAsync(string campusId, CancellationToken ct = default) { LandmarkCalls++; return Task.FromResult(Landmarks(campusId)); }
    public Task<CampusSearchResponseDto> SearchAsync(string campusId, string query, int limit = 20, CancellationToken ct = default)
    {
        SearchCalls++; SearchQueries.Add(query);
        if (SearchAsyncOverride is not null) return SearchAsyncOverride(campusId, query, ct);
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(Search(campusId, query));
    }
    public bool LastGlobalSearchIncludedGeo { get; private set; }
    public Task<CampusSearchResponseDto> GlobalSearchAsync(string query, int limit = 20, CancellationToken ct = default, bool includeGeo = false, double? nearLatitude = null, double? nearLongitude = null)
    {
        LastGlobalSearchIncludedGeo = includeGeo;
        if (GlobalSearchAsyncOverride is not null) return GlobalSearchAsyncOverride(query, ct);
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(GlobalSearch(query));
    }
    public Func<string, CampusPackVersionDto> PackVersion { get; set; } = _ => new() { CurrentVersion = 1 };
    public Func<string, int?, CampusPackDto> Pack { get; set; } = (_, _) => new() { Version = 1 };
    public Task<CampusPackVersionDto> GetPackVersionAsync(string campusId, CancellationToken ct = default) => Task.FromResult(PackVersion(campusId));
    public Task<CampusPackDto> GetPackAsync(string campusId, int? sinceVersion = null, CancellationToken ct = default) => Task.FromResult(Pack(campusId, sinceVersion));
    public Task<CampusLocateResultDto> LocateAsync(string campusId, double latitude, double longitude, double? accuracyMeters, CancellationToken ct = default)
    { LocateCalls++; return Task.FromResult(Locate(campusId, latitude, longitude)); }
    public Task<CampusBuildingDetailDto> GetBuildingAsync(string campusId, string buildingId, CancellationToken ct = default) => Task.FromResult(BuildingDetail(buildingId));
    public Task<CampusRoomDetailDto> GetRoomAsync(string campusId, string roomId, CancellationToken ct = default) => Task.FromResult(RoomDetail(roomId));
    public Task<CampusRouteResponseDto> RouteAsync(string campusId, CampusRouteFrom start, CampusRouteTo destination, CampusRouteOptions? options = null, CancellationToken ct = default)
    {
        RouteCalls++; RouteRequests.Add((start, destination)); RouteOptions.Add(options);
        if (RouteAsyncOverride is not null) return RouteAsyncOverride(start, destination);
        return Task.FromResult(Route(start, destination));
    }
}

public sealed class FakePlaceSearch : IPlaceSearchApi
{
    public Func<string, IReadOnlyList<CampusSearchResultDto>> Results { get; set; } = _ => Array.Empty<CampusSearchResultDto>();
    public List<(double Lat, double Lng, string Query)> Calls { get; } = new();

    public Task<IReadOnlyList<CampusSearchResultDto>> SearchAsync(double latitude, double longitude, string query, CancellationToken ct = default)
    {
        Calls.Add((latitude, longitude, query));
        return Task.FromResult(Results(query));
    }
}

public sealed class FakeLocationProvider : ILocationProvider
{
    public LocationResult Result { get; set; } = LocationResult.Without(LocationAvailability.PermissionDenied);
    public List<bool> PermissionRequests { get; } = new();
    public int Starts, Stops, SettingsOpened;
    public bool StartSucceeds { get; set; } = true;

    private EventHandler<LocationFix>? _changed;
    /// <summary>How many handlers are subscribed right now — proves subscriptions are released.</summary>
    public int Subscribers => _changed?.GetInvocationList().Length ?? 0;
    public List<LocationUpdateProfile> StartProfiles { get; } = new();

    public event EventHandler<LocationFix>? LocationChanged
    {
        add => _changed += value;
        remove => _changed -= value;
    }

    public Task<LocationResult> GetCurrentAsync(bool requestPermission, CancellationToken ct = default)
    {
        PermissionRequests.Add(requestPermission);
        return Task.FromResult(Result);
    }
    public Task<bool> StartListeningAsync(LocationUpdateProfile profile = LocationUpdateProfile.Browse) { Starts++; StartProfiles.Add(profile); return Task.FromResult(StartSucceeds); }
    public void StopListening() => Stops++;
    public void OpenSettings() => SettingsOpened++;
    public void Raise(LocationFix fix) => _changed?.Invoke(this, fix);

    public static LocationResult At(double lat, double lng, double accuracy = 10) =>
        LocationResult.WithFix(new LocationFix(lat, lng, accuracy, DateTimeOffset.UtcNow));
}

/// <summary>Neutral builders — the names/ids here are test data, not production data.</summary>
public static class Sample
{
    public static CampusSummaryDto Campus(string id = "c1", bool geofence = true) =>
        new() { Id = id, Name = $"Campus {id}", Latitude = 1, Longitude = 2, GeofenceConfigured = geofence, University = new() { Id = "u", Name = "Test University" } };

    public static CampusBuildingDto Building(string id = "b1", string name = "Block One") => new()
    {
        Id = id, Name = name, Type = "faculty", Latitude = 1.001, Longitude = 2.001, Aliases = new() { "B1" },
        Entrances = new() { new() { Id = $"{id}-e1", BuildingId = id, Name = "Main Entrance", Latitude = 1.0011, Longitude = 2.0012, NavigationNodeId = "n1" } },
    };

    public static CampusLandmarkDto Landmark(string id = "l1", string name = "Gate", bool routable = true) =>
        new() { Id = id, Name = name, Type = "gate", Latitude = 1.0, Longitude = 2.0, NavigationNodeId = routable ? $"n-{id}" : null };

    public static CampusSearchResultDto RoomHit(string id = "r1", string name = "Hall 1") => new()
    {
        Kind = "room", Id = id, Name = name, Category = "lecture_hall", Score = 100, Latitude = 1.001, Longitude = 2.001,
        Building = new() { Id = "b1", Name = "Block One" }, Floor = new() { Id = "f1", FloorNumber = 0, Name = "Ground Floor" },
    };
}

public static class MapViewModelTestExtensions
{
    /// <summary>Start the map (map-first start-up) and then explicitly open the first campus in the directory.</summary>
    public static async Task OpenFirstCampusAsync(this UNIVAST.Mobile.ViewModels.CampusMapViewModel vm)
    {
        await vm.InitializeAsync();
        if (vm.CampusChoices.Count > 0) await vm.ChooseCampusAsync(vm.CampusChoices[0]);
    }
}

/// <summary>A clock tests can move by hand (rerouting intervals, ETA).</summary>
public sealed class FakeClock : TimeProvider
{
    public DateTimeOffset Now { get; set; } = new(2026, 10, 5, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => Now;
    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    public void Advance(TimeSpan by) => Now += by;
}

/// <summary>
/// A small, self-consistent route used by the navigation tests. Geometry runs east for ~100 m, then north for ~100 m:
///   P0 (lat 0, lng 0) ──east──▶ P1 (lat 0, lng 0.0009) ──north──▶ P2 (lat 0.0009, lng 0.0009)
/// Backend settings: 2 m/s walking, reroute after 30 m off the line, at most every 15 s, arrival within 15 m.
/// </summary>
public static class RouteSample
{
    public const double P1Lng = 0.0009;
    public const double P2Lat = 0.0009;

    public static CampusRouteResponseDto Ok(Action<CampusRouteResponseDto>? tweak = null)
    {
        var route = new CampusRouteResponseDto
        {
            Status = "ok",
            DistanceMeters = 200,
            DurationSeconds = 100,
            Geometry = new() { Type = "LineString", Coordinates = new() { new() { 0, 0 }, new() { P1Lng, 0 }, new() { P1Lng, P2Lat } } },
            Steps = new()
            {
                new() { Type = "depart", Maneuver = "depart", Text = "Walk from Gate toward Junction.", DistanceMeters = 0, At = new() { Latitude = 0, Longitude = 0 }, GeometryIndex = 0, DistanceFromStartMeters = 0 },
                new() { Type = "turn", Maneuver = "turn_left", Text = "After about 100 m, turn left at Junction.", DistanceMeters = 100, DurationSeconds = 50, At = new() { Latitude = 0, Longitude = P1Lng }, GeometryIndex = 1, DistanceFromStartMeters = 100, Landmark = "Junction" },
                new() { Type = "enter", Maneuver = "enter_building", Text = "Enter Block One through Main Entrance.", DistanceMeters = 100, At = new() { Latitude = P2Lat, Longitude = P1Lng }, GeometryIndex = 2, DistanceFromStartMeters = 200 },
                new() { Type = "destination_floor", Maneuver = "arrive", Text = "Hall 1 is on the Ground Floor. Indoor directions are not available yet.", At = new() { Latitude = P2Lat, Longitude = P1Lng }, GeometryIndex = 2, DistanceFromStartMeters = 200 },
            },
            Instructions = new() { new() { Type = "depart", Text = "Walk from Gate toward Junction." } },
            Destination = new()
            {
                Kind = "room", Name = "Hall 1",
                Building = new() { Id = "b1", Name = "Block One" }, Floor = new() { Id = "f1", FloorNumber = 0, Name = "Ground Floor" },
                Position = new() { Latitude = P2Lat, Longitude = P1Lng },
                Indoor = new() { Routed = false, Description = "Hall 1 is on the Ground Floor." },
            },
            Metadata = new()
            {
                WalkingSpeedMetersPerSecond = 2, RerouteDeviationMeters = 30, RerouteMinIntervalSeconds = 15, ArrivalRadiusMeters = 15,
                GraphVersion = "abc123", IndoorRouting = "not_available",
            },
        };
        tweak?.Invoke(route);
        return route;
    }

    /// <summary>A fix on the route line, `along` metres from the start on the first (eastbound) leg.</summary>
    public static LocationFix OnFirstLeg(double along, double accuracy = 5) => new(0, along / 111320.0 * 1.0, accuracy, DateTimeOffset.UtcNow);

    /// <summary>A fix on the second (northbound) leg, `along` metres past the corner.</summary>
    public static LocationFix OnSecondLeg(double along, double accuracy = 5) => new(along / 111320.0, P1Lng, accuracy, DateTimeOffset.UtcNow);

    /// <summary>A fix `offsetMeters` south of the first leg at the given distance along it (off the route).</summary>
    public static LocationFix OffRoute(double along, double offsetMeters, double accuracy = 5) =>
        new(-offsetMeters / 111320.0, along / 111320.0, accuracy, DateTimeOffset.UtcNow);
}
