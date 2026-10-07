using UNIVAST.Mobile.Models;
using System.Text.Json;

namespace UNIVAST.Mobile.Services;

public sealed class CampusPackManager
{
    private readonly ICampusApi _api;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public CampusPackManager(ICampusApi api) => _api = api;

    public async Task<CampusPackInstallResult> EnsureInstalledAsync(string campusId, CancellationToken ct = default)
    {
        var local = CampusPackStore.Load(campusId);
        var version = await _api.GetPackVersionAsync(campusId, ct);
        if (local is not null &&
            local.Version == version.CurrentVersion &&
            string.Equals(local.Checksum, version.Checksum, StringComparison.OrdinalIgnoreCase))
        {
            return new CampusPackInstallResult
            {
                CampusId = campusId,
                Version = local.Version,
                Checksum = local.Checksum ?? string.Empty,
                Installed = true,
                UpToDate = true,
            };
        }

        if (local is not null && local.Version > version.CurrentVersion)
        {
            return new CampusPackInstallResult
            {
                CampusId = campusId,
                Version = local.Version,
                Checksum = local.Checksum ?? string.Empty,
                Installed = true,
                UpToDate = false,
            };
        }

        // Always request the complete published pack. The server's sinceVersion
        // marker is valid only for an already-current version and has no snapshot
        // to persist, so it cannot be used by the local store.
        var pack = await _api.GetPackAsync(campusId, null, ct);
        return await CampusPackStore.InstallAsync(campusId, pack, ct);
    }

    public bool TryLoad(string campusId, out CampusPackDto? pack)
    {
        pack = CampusPackStore.Load(campusId);
        return pack is not null;
    }

    public List<CampusSummaryDto> GetInstalledCampuses()
    {
        var campuses = new List<CampusSummaryDto>();
        foreach (var campusId in CampusPackStore.GetInstalledCampusIds())
        {
            if (!TryLoad(campusId, out var pack) || pack is null || !pack.Snapshot.TryGetProperty("campus", out var campus))
                continue;

            var university = pack.Snapshot.TryGetProperty("university", out var universityElement) && universityElement.ValueKind == JsonValueKind.Object
                ? new CampusUniversityDto
                {
                    Id = GetString(universityElement, "_id"),
                    Name = GetString(universityElement, "name"),
                    Abbreviation = GetString(universityElement, "abbreviation"),
                }
                : null;
            var geofenceConfigured = campus.TryGetProperty("geofence", out var geofence) && geofence.ValueKind == JsonValueKind.Object &&
                ((geofence.TryGetProperty("boundary", out var boundary) && boundary.ValueKind == JsonValueKind.Object) ||
                 (geofence.TryGetProperty("radiusMeters", out var radius) && radius.TryGetDouble(out var radiusMeters) && radiusMeters > 0));

            campuses.Add(new CampusSummaryDto
            {
                Id = GetString(campus, "_id", campusId),
                Name = GetString(campus, "name"),
                Description = GetString(campus, "description"),
                Latitude = GetDouble(campus, "latitude"),
                Longitude = GetDouble(campus, "longitude"),
                University = university,
                GeofenceConfigured = geofenceConfigured,
                MapMetadata = ReadProperty<CampusMapMetadataDto>(campus, "mapMetadata"),
                PackVersion = pack.Version,
                DataSource = GetString(campus, "dataSource"),
            });
        }
        return campuses.Where(campus => campus.IsValid).ToList();
    }

    public bool TryLoadCampusData(string campusId, out List<CampusBuildingDto> buildings, out List<CampusLandmarkDto> landmarks)
    {
        buildings = new();
        landmarks = new();
        if (!TryLoad(campusId, out var pack) || pack is null || pack.Snapshot.ValueKind != JsonValueKind.Object)
            return false;

        buildings = ReadList<CampusBuildingDto>(pack.Snapshot, "buildings");
        landmarks = ReadList<CampusLandmarkDto>(pack.Snapshot, "landmarks");
        return true;
    }

    public CampusSearchResponseDto? SearchOffline(string campusId, string query)
    {
        if (!TryLoad(campusId, out var pack) || pack is null || pack.Snapshot.ValueKind != JsonValueKind.Object)
            return null;

        var normalized = string.Join(' ', query.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).Trim();
        if (normalized.Length == 0) return null;

        var snapshot = pack.Snapshot;
        var buildings = ReadList<CampusBuildingDto>(snapshot, "buildings");
        var floors = ReadList<CampusFloorDto>(snapshot, "floors")
            .Where(floor => !string.IsNullOrWhiteSpace(floor.Id))
            .GroupBy(floor => floor.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var rooms = ReadList<CampusRoomDto>(snapshot, "rooms");
        var landmarks = ReadList<CampusLandmarkDto>(snapshot, "landmarks");
        var hits = new List<CampusSearchResultDto>();

        foreach (var building in buildings)
        {
            if (Matches(normalized, building.Name, building.Abbreviation, building.Aliases))
            {
                hits.Add(new CampusSearchResultDto
                {
                    Kind = "building", Id = building.Id, Name = building.Name, Category = building.Type,
                    Score = 100, MatchedOn = "offline", DataSource = building.DataSource,
                    Latitude = building.Latitude, Longitude = building.Longitude,
                    Aliases = building.Aliases, Description = building.Description,
                    CampusId = campusId, BuildingId = building.Id, BuildingName = building.Name,
                });
            }
        }

        foreach (var room in rooms)
        {
            var building = buildings.FirstOrDefault(item => item.Id == room.BuildingId);
            var floor = room.FloorId is not null && floors.TryGetValue(room.FloorId, out var foundFloor) ? foundFloor : null;
            if (!Matches(normalized, room.Name, room.RoomNumber, room.Aliases, building?.Name, floor?.Name)) continue;
            hits.Add(new CampusSearchResultDto
            {
                Kind = "room", Id = room.Id, Name = room.Name, Category = room.Type,
                Score = 100, MatchedOn = "offline", DataSource = room.DataSource,
                Aliases = room.Aliases, Description = room.Description, CampusId = campusId,
                BuildingId = building?.Id, BuildingName = building?.Name,
                Building = building is null ? null : new CampusSearchRefDto { Id = building.Id, Name = building.Name },
                Floor = floor is null ? null : new CampusSearchRefDto { Id = floor.Id, Name = floor.Name ?? "", FloorNumber = floor.FloorNumber },
                RoomNumber = room.RoomNumber,
                Latitude = building?.Latitude, Longitude = building?.Longitude,
            });
        }

        foreach (var landmark in landmarks)
        {
            if (!Matches(normalized, landmark.Name, landmark.Type, landmark.Aliases)) continue;
            hits.Add(new CampusSearchResultDto
            {
                Kind = "landmark", Id = landmark.Id, Name = landmark.Name, Category = landmark.Type,
                Score = 100, MatchedOn = "offline", DataSource = landmark.DataSource,
                Latitude = landmark.Latitude, Longitude = landmark.Longitude,
                Aliases = landmark.Aliases, Description = landmark.Description, CampusId = campusId,
            });
        }

        return new CampusSearchResponseDto
        {
            Query = normalized,
            Results = hits.OrderByDescending(hit => hit.Name.Equals(normalized, StringComparison.OrdinalIgnoreCase))
                .ThenBy(hit => hit.Name, StringComparer.OrdinalIgnoreCase).Take(20).ToList(),
        };
    }

    private static List<T> ReadList<T>(JsonElement snapshot, string property) =>
        snapshot.TryGetProperty(property, out var element) && element.ValueKind == JsonValueKind.Array
            ? element.Deserialize<List<T>>(JsonOptions) ?? new List<T>()
            : new List<T>();

    private static T? ReadProperty<T>(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Object
            ? value.Deserialize<T>(JsonOptions)
            : default;

    private static string GetString(JsonElement element, string property, string fallback = "") =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? fallback
            : fallback;

    private static double GetDouble(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.TryGetDouble(out var number) ? number : 0;

    private static bool Matches(string query, params string?[] values) =>
        values.Where(value => !string.IsNullOrWhiteSpace(value))
            .Any(value => value!.Contains(query, StringComparison.OrdinalIgnoreCase));

    private static bool Matches(string query, string? name, string? secondary, IEnumerable<string>? aliases, string? extra1 = null, string? extra2 = null) =>
        Matches(query, new[] { name, secondary, extra1, extra2 }.Concat(aliases ?? Array.Empty<string>()).ToArray());
}
