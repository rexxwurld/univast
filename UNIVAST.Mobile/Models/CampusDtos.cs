using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

// Strongly typed shapes of the Phase 2 campus API (/api/v1/campus-data). They mirror
// backend/controllers/campusDataController.js and campusSearchService.js — the backend is the source
// of truth. Everything is optional-tolerant: a missing or null field must never crash the app.

public class CampusUniversityDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("abbreviation")] public string? Abbreviation { get; set; }
}

public class CampusMapMetadataDto
{
    [JsonPropertyName("defaultZoom")] public double? DefaultZoom { get; set; }
    [JsonPropertyName("minZoom")] public double? MinZoom { get; set; }
    [JsonPropertyName("maxZoom")] public double? MaxZoom { get; set; }
    [JsonPropertyName("notes")] public string? Notes { get; set; }
}

/// <summary>One row of GET /campus-data/campuses.</summary>
public class CampusSummaryDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }
    [JsonPropertyName("university")] public CampusUniversityDto? University { get; set; }

    /// <summary>True when the campus has a boundary polygon or radius, i.e. /locate can give a real answer.</summary>
    [JsonPropertyName("geofenceConfigured")] public bool GeofenceConfigured { get; set; }

    [JsonPropertyName("mapMetadata")] public CampusMapMetadataDto? MapMetadata { get; set; }
    [JsonPropertyName("packVersion")] public int PackVersion { get; set; }

    /// <summary>"DEV_FIXTURE" for synthetic development data.</summary>
    [JsonPropertyName("dataSource")] public string? DataSource { get; set; }

    [JsonIgnore] public bool IsValid => !string.IsNullOrWhiteSpace(Id) && !string.IsNullOrWhiteSpace(Name);
}

public class CampusEntranceDto
{
    [JsonPropertyName("_id")] public string Id { get; set; } = "";
    [JsonPropertyName("buildingId")] public string BuildingId { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }
    [JsonPropertyName("navigationNodeId")] public string? NavigationNodeId { get; set; }
}

/// <summary>One row of GET /campus-data/:id/buildings (entrances included).</summary>
public class CampusBuildingDto
{
    [JsonPropertyName("_id")] public string Id { get; set; } = "";
    [JsonPropertyName("campusId")] public string CampusId { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("abbreviation")] public string? Abbreviation { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }
    [JsonPropertyName("aliases")] public List<string>? Aliases { get; set; }
    [JsonPropertyName("dataSource")] public string? DataSource { get; set; }
    [JsonPropertyName("entrances")] public List<CampusEntranceDto>? Entrances { get; set; }
}

public class CampusFloorDto
{
    [JsonPropertyName("_id")] public string Id { get; set; } = "";
    [JsonPropertyName("floorNumber")] public int FloorNumber { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
}

public class CampusRoomDto
{
    [JsonPropertyName("_id")] public string Id { get; set; } = "";
    [JsonPropertyName("buildingId")] public string? BuildingId { get; set; }
    [JsonPropertyName("floorId")] public string? FloorId { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("roomNumber")] public string? RoomNumber { get; set; }
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("aliases")] public List<string>? Aliases { get; set; }
    [JsonPropertyName("dataSource")] public string? DataSource { get; set; }
}

/// <summary>GET /campus-data/:id/buildings/:buildingId — building plus floors and rooms.</summary>
public class CampusBuildingDetailDto : CampusBuildingDto
{
    [JsonPropertyName("floors")] public List<CampusFloorDto>? Floors { get; set; }
    [JsonPropertyName("rooms")] public List<CampusRoomDto>? Rooms { get; set; }
}

/// <summary>GET /campus-data/:id/rooms/:roomId — the room with its floor, building and entrances.</summary>
public class CampusRoomDetailDto : CampusRoomDto
{
    [JsonPropertyName("floor")] public CampusFloorDto? Floor { get; set; }
    [JsonPropertyName("building")] public CampusBuildingDto? Building { get; set; }
    [JsonPropertyName("entrances")] public List<CampusEntranceDto>? Entrances { get; set; }
}

public class CampusLandmarkDto
{
    [JsonPropertyName("_id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }
    [JsonPropertyName("aliases")] public List<string>? Aliases { get; set; }
    [JsonPropertyName("navigationNodeId")] public string? NavigationNodeId { get; set; }
    [JsonPropertyName("dataSource")] public string? DataSource { get; set; }
}

public class CampusSearchRefDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("floorNumber")] public int? FloorNumber { get; set; }
}

/// <summary>One hit of GET /campus-data/:id/search or GET /api/v1/search. Ranking and alias logic stay on the backend.</summary>
public class CampusSearchResultDto
{
    /// <summary>"room" | "building" | "landmark" | "location" (legacy campus place) | "university" | "campus" | "place" | "geo" (general map place from the geocoder).</summary>
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("score")] public double Score { get; set; }
    [JsonPropertyName("matchedOn")] public string? MatchedOn { get; set; }
    [JsonPropertyName("dataSource")] public string? DataSource { get; set; }
    [JsonPropertyName("latitude")] public double? Latitude { get; set; }
    [JsonPropertyName("longitude")] public double? Longitude { get; set; }
    [JsonPropertyName("building")] public CampusSearchRefDto? Building { get; set; }
    [JsonPropertyName("floor")] public CampusSearchRefDto? Floor { get; set; }
    [JsonPropertyName("universityId")] public string? UniversityId { get; set; }
    [JsonPropertyName("universityName")] public string? UniversityName { get; set; }
    [JsonPropertyName("campusId")] public string? CampusId { get; set; }
    [JsonPropertyName("campusName")] public string? CampusName { get; set; }
    [JsonPropertyName("buildingId")] public string? BuildingId { get; set; }
    [JsonPropertyName("buildingName")] public string? BuildingName { get; set; }
    [JsonPropertyName("roomNumber")] public string? RoomNumber { get; set; }
    [JsonPropertyName("aliases")] public List<string>? Aliases { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("address")] public string? Address { get; set; }
    [JsonPropertyName("sourceCampusId")] public string? SourceCampusId { get; set; }
    [JsonPropertyName("categoryId")] public string? CategoryId { get; set; }
}

public class CampusSearchResponseDto
{
    [JsonPropertyName("query")] public string? Query { get; set; }
    [JsonPropertyName("results")] public List<CampusSearchResultDto>? Results { get; set; }
    [JsonPropertyName("ambiguous")] public bool Ambiguous { get; set; }
    [JsonPropertyName("category")] public string? Category { get; set; }
    /// <summary>Only on GET /api/v1/search: whether general-map (geocoder) results were asked for and how that went.</summary>
    [JsonPropertyName("geo")] public CampusSearchGeoDto? Geo { get; set; }
}

/// <summary>"status": "skipped" (not asked) | "ok" | "disabled" | "unavailable". Lets the app say honestly when map places are missing.</summary>
public class CampusSearchGeoDto
{
    public const string Ok = "ok";
    [JsonPropertyName("requested")] public bool Requested { get; set; }
    [JsonPropertyName("status")] public string? Status { get; set; }
}

/// <summary>POST /campus-data/:id/locate — Phase 2 geofence semantics (inside | near | outside | unknown).</summary>
public class CampusLocateResultDto
{
    public const string Inside = "inside";
    public const string Near = "near";
    public const string Outside = "outside";
    public const string Unknown = "unknown";

    [JsonPropertyName("status")] public string Status { get; set; } = Unknown;
    [JsonPropertyName("method")] public string? Method { get; set; }
    [JsonPropertyName("distanceToBoundaryMeters")] public double? DistanceToBoundaryMeters { get; set; }
    [JsonPropertyName("ambiguous")] public bool Ambiguous { get; set; }
    [JsonPropertyName("accuracyMeters")] public double? AccuracyMeters { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

// ---- POST /campus-data/:id/route ---------------------------------------------------------------------------
// Mirrors backend/services/campusRoutingService.js. Every field added in Phase 5 is optional so an older
// backend (Phase 2/3 shape: status, distanceMeters, destination, instructions) still parses.

public class CampusLatLngDto
{
    [JsonPropertyName("latitude")] public double Latitude { get; set; }
    [JsonPropertyName("longitude")] public double Longitude { get; set; }

    [JsonIgnore]
    public bool IsValid => double.IsFinite(Latitude) && double.IsFinite(Longitude) && Latitude is >= -90 and <= 90 && Longitude is >= -180 and <= 180;
}

public class CampusRouteInstructionDto
{
    [JsonPropertyName("type")] public string? Type { get; set; }
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("distanceMeters")] public double? DistanceMeters { get; set; }
}

/// <summary>One maneuver. DistanceMeters is the walk from the PREVIOUS step to this one.</summary>
public class CampusRouteStepDto
{
    [JsonPropertyName("type")] public string? Type { get; set; }

    /// <summary>depart | continue | slight_left | slight_right | turn_left | turn_right | sharp_left | sharp_right | u_turn |
    /// enter_building | exit_building | take_stairs | take_ramp | take_elevator | arrive</summary>
    [JsonPropertyName("maneuver")] public string? Maneuver { get; set; }

    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("distanceMeters")] public double? DistanceMeters { get; set; }
    [JsonPropertyName("durationSeconds")] public double? DurationSeconds { get; set; }
    [JsonPropertyName("at")] public CampusLatLngDto? At { get; set; }

    /// <summary>Index into the route geometry where this maneuver happens.</summary>
    [JsonPropertyName("geometryIndex")] public int? GeometryIndex { get; set; }

    /// <summary>Route distance walked when this maneuver is reached.</summary>
    [JsonPropertyName("distanceFromStartMeters")] public double? DistanceFromStartMeters { get; set; }

    [JsonPropertyName("landmark")] public string? Landmark { get; set; }
    [JsonPropertyName("building")] public string? Building { get; set; }
    [JsonPropertyName("entrance")] public string? Entrance { get; set; }
    [JsonPropertyName("floor")] public string? Floor { get; set; }
}

public class CampusRouteGeometryDto
{
    [JsonPropertyName("type")] public string? Type { get; set; }

    /// <summary>[longitude, latitude] pairs (GeoJSON order). Follows graph edges only.</summary>
    [JsonPropertyName("coordinates")] public List<List<double>>? Coordinates { get; set; }
}

public class CampusRouteIndoorDto
{
    [JsonPropertyName("routed")] public bool Routed { get; set; }
    [JsonPropertyName("floor")] public CampusSearchRefDto? Floor { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
}

public class CampusRouteDestinationDto
{
    [JsonPropertyName("kind")] public string? Kind { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("building")] public CampusSearchRefDto? Building { get; set; }
    [JsonPropertyName("floor")] public CampusSearchRefDto? Floor { get; set; }
    [JsonPropertyName("position")] public CampusLatLngDto? Position { get; set; }
    [JsonPropertyName("indoor")] public CampusRouteIndoorDto? Indoor { get; set; }
}

public class CampusRouteOriginDto
{
    /// <summary>device | map | node | landmark | entrance</summary>
    [JsonPropertyName("kind")] public string? Kind { get; set; }
    [JsonPropertyName("latitude")] public double? Latitude { get; set; }
    [JsonPropertyName("longitude")] public double? Longitude { get; set; }
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("snapDistanceMeters")] public double? SnapDistanceMeters { get; set; }
}

/// <summary>Navigation behaviour configured per campus on the backend — the app has no magic numbers of its own.</summary>
public class CampusRouteMetadataDto
{
    [JsonPropertyName("walkingSpeedMetersPerSecond")] public double? WalkingSpeedMetersPerSecond { get; set; }
    [JsonPropertyName("rerouteDeviationMeters")] public double? RerouteDeviationMeters { get; set; }
    [JsonPropertyName("rerouteMinIntervalSeconds")] public double? RerouteMinIntervalSeconds { get; set; }
    [JsonPropertyName("arrivalRadiusMeters")] public double? ArrivalRadiusMeters { get; set; }
    [JsonPropertyName("graphVersion")] public string? GraphVersion { get; set; }
    [JsonPropertyName("accessibleOnly")] public bool AccessibleOnly { get; set; }
    [JsonPropertyName("indoorRouting")] public string? IndoorRouting { get; set; }
}

public class CampusRouteResponseDto
{
    public const string Ok = "ok";
    public const string AwayFromCampus = "away_from_campus";
    public const string StartTooFarFromPaths = "start_too_far_from_paths";

    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("distanceMeters")] public double? DistanceMeters { get; set; }
    [JsonPropertyName("durationSeconds")] public double? DurationSeconds { get; set; }
    [JsonPropertyName("origin")] public CampusRouteOriginDto? Origin { get; set; }
    [JsonPropertyName("destination")] public CampusRouteDestinationDto? Destination { get; set; }
    [JsonPropertyName("geometry")] public CampusRouteGeometryDto? Geometry { get; set; }
    [JsonPropertyName("steps")] public List<CampusRouteStepDto>? Steps { get; set; }
    [JsonPropertyName("instructions")] public List<CampusRouteInstructionDto>? Instructions { get; set; }
    [JsonPropertyName("warnings")] public List<string>? Warnings { get; set; }
    [JsonPropertyName("metadata")] public CampusRouteMetadataDto? Metadata { get; set; }
}

/// <summary>Where a route starts: a real device fix, a point the user picked on the map, or a campus landmark/entrance. One kind only.</summary>
public sealed class CampusRouteFrom
{
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public double? AccuracyMeters { get; init; }
    /// <summary>"device" (default) or "map" — only used with coordinates.</summary>
    public string? Source { get; init; }
    public string? LandmarkId { get; init; }
    public string? EntranceId { get; init; }
}

/// <summary>Exactly one of the ids is set.</summary>
public sealed class CampusRouteTo
{
    public string? RoomId { get; init; }
    public string? BuildingId { get; init; }
    public string? LandmarkId { get; init; }
    public string? EntranceId { get; init; }
}

public sealed class CampusRouteOptions
{
    public bool AccessibleOnly { get; init; }
}
