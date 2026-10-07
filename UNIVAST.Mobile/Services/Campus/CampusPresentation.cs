using System.Globalization;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

public static class CategoryLabels
{
    private static readonly Dictionary<string, string> Special = new(StringComparer.OrdinalIgnoreCase)
    {
        ["atm"] = "ATM",
        ["lecture_hall"] = "Lecture hall",
        ["administration"] = "Administration",
    };

    /// <summary>"lecture_hall" -> "Lecture hall". Unknown/empty -> "Place".</summary>
    public static string Humanize(string? category)
    {
        if (string.IsNullOrWhiteSpace(category)) return "Place";
        if (Special.TryGetValue(category, out var s)) return s;
        var text = category.Replace('_', ' ').Trim();
        return char.ToUpper(text[0], CultureInfo.InvariantCulture) + text[1..];
    }
}

/// <summary>A search hit with its display strings, so the list template needs no converters.</summary>
public sealed record SearchResultItem(CampusSearchResultDto Result, string Title, string Subtitle)
{
    /// <summary>"Room · Lecture hall", "Building · Faculty", "Landmark" ... — what kind of thing this is.</summary>
    public string TypeLine { get; init; } = "";

    /// <summary>For rooms: "Block One · Ground Floor". Empty for everything else.</summary>
    public string ContextLine { get; init; } = "";

    public bool HasContext => ContextLine.Length > 0;

    /// <summary>Synthetic development data (backend dataSource DEV_FIXTURE) — shown as a "Demo" tag.</summary>
    public bool IsDemoData { get; init; }

    /// <summary>UNIVAST-managed campus intelligence (university, campus, building, room, landmark) as opposed to a general map place.</summary>
    public bool IsCampusData { get; init; }
}

public sealed record SearchSection(string Title, string Kind, IReadOnlyList<SearchResultItem> Items);

/// <summary>
/// Groups backend search hits into labelled sections. It does NOT re-rank: the backend's order is kept
/// within each section (and the section holding the best hit comes first).
/// </summary>
public static class SearchResultGrouper
{
    private static readonly (string Kind, string Title)[] KnownKinds =
    {
        ("university", "UNIVERSITIES"),
        ("campus", "CAMPUSES"),
        ("building", "BUILDINGS"),
        ("room", "ROOMS"),
        ("landmark", "LANDMARKS"),
        ("location", "PLACES"),        // legacy campus locations (backend Location records)
        ("place", "NEARBY PLACES"),    // existing UNIVAST places/businesses
        ("geo", "MAP PLACES"),         // general map places (geocoder) — always after UNIVAST's own results
    };

    public static IReadOnlyList<SearchSection> Group(CampusSearchResponseDto? response)
    {
        var results = response?.Results?.Where(r => !string.IsNullOrWhiteSpace(r.Id) && !string.IsNullOrWhiteSpace(r.Name)).ToList()
                      ?? new List<CampusSearchResultDto>();
        if (results.Count == 0) return Array.Empty<SearchSection>();

        var sections = new List<SearchSection>();
        var used = new HashSet<string>();
        foreach (var (kind, title) in KnownKinds)
        {
            var items = results.Where(r => r.Kind == kind).Select(Item).ToList();
            if (items.Count > 0) { sections.Add(new SearchSection(title, kind, items)); used.Add(kind); }
        }
        var other = results.Where(r => !used.Contains(r.Kind)).Select(Item).ToList();
        if (other.Count > 0) sections.Add(new SearchSection("OTHER", "other", other));

        // The section containing the backend's top hit goes first; relative order of the rest is unchanged.
        var top = results[0];
        var first = sections.FindIndex(sec => sec.Items.Any(i => ReferenceEquals(i.Result, top)));
        if (first > 0) { var moved = sections[first]; sections.RemoveAt(first); sections.Insert(0, moved); }
        return sections;
    }

    private static SearchResultItem Item(CampusSearchResultDto r) => new(r, r.Name, Subtitle(r))
    {
        TypeLine = TypeLine(r),
        ContextLine = r.Kind == "room" ? Subtitle(r) : "",
        IsDemoData = r.DataSource == DestinationBuilder.DevFixture,
        IsCampusData = r.Kind is "university" or "campus" or "building" or "room" or "landmark" or "location",
    };

    public static string KindLabel(string? kind) => kind switch
    {
        "university" => "University",
        "campus" => "Campus",
        "room" => "Room",
        "building" => "Building",
        "landmark" => "Landmark",
        "location" => "Place",
        "place" => "Place",
        "geo" => "Map place",
        _ => "Result",
    };

    /// <summary>Kind first, then the category when it adds information ("Room · Lecture hall").</summary>
    public static string TypeLine(CampusSearchResultDto r)
    {
        var kind = KindLabel(r.Kind);
        if (string.IsNullOrWhiteSpace(r.Category)) return kind;
        var category = CategoryLabels.Humanize(r.Category);
        if (category.Equals(kind, StringComparison.OrdinalIgnoreCase) || category.Equals("Other", StringComparison.OrdinalIgnoreCase)) return kind;
        return $"{kind} · {category}";
    }

    /// <summary>Secondary line under a result's name: "Test Science Block · Ground Floor" or the category.</summary>
    public static string Subtitle(CampusSearchResultDto r)
    {
        if (r.Kind == "room")
        {
            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(r.Building?.Name)) parts.Add(r.Building!.Name);
            var floor = DestinationBuilder.FloorLabel(r.Floor?.Name, r.Floor?.FloorNumber);
            if (floor is not null) parts.Add(floor);
            if (parts.Count > 0) return string.Join(" · ", parts);
        }
        if (r.Kind == "geo" && !string.IsNullOrWhiteSpace(r.Address)) return r.Address!;
        return CategoryLabels.Humanize(r.Category);
    }
}

public enum DestinationKind { Building, Room, Landmark, Place }

/// <summary>Everything the destination sheet shows. Built from backend data only.</summary>
public sealed record DestinationDetail(
    DestinationKind Kind,
    string Id,
    string Title,
    string TypeLabel,
    string? Subtitle,
    IReadOnlyList<string> Aliases,
    double? Latitude,
    double? Longitude,
    string? BuildingId,
    string? Description,
    int? FloorCount,
    IReadOnlyList<string> NotableRooms,
    bool CanNavigate,
    string? CannotNavigateReason,
    bool IsDemoData,
    bool DetailsLoaded)
{
    /// <summary>For rooms: the building and floor the room belongs to (used for the University › Campus › Building › Floor trail).</summary>
    public string? BuildingName { get; init; }
    public string? FloorName { get; init; }
}

public static class DestinationBuilder
{
    public const string DevFixture = "DEV_FIXTURE";

    public static string? FloorLabel(string? name, int? floorNumber)
    {
        if (!string.IsNullOrWhiteSpace(name)) return name;
        if (floorNumber is null) return null;
        return floorNumber == 0 ? "Ground floor"
            : floorNumber < 0 ? $"Basement {Math.Abs(floorNumber.Value)}"
            : $"Floor {floorNumber}";
    }

    private static IReadOnlyList<string> Clean(IEnumerable<string>? values, string? exclude = null) =>
        (values ?? Enumerable.Empty<string>())
            .Where(v => !string.IsNullOrWhiteSpace(v) && !string.Equals(v, exclude, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>Honest wording: UNIVAST only has real routing for mapped campuses; no general routing provider is configured.</summary>
    public const string GeneralDirectionsUnavailable = "Directions to places outside UNIVAST campus data aren't available yet.";

    /// <summary>Immediate (pre-detail) view of a search hit, so the sheet and camera react at once.</summary>
    public static DestinationDetail FromSearchResult(CampusSearchResultDto r)
    {
        var kind = r.Kind switch { "room" => DestinationKind.Room, "building" => DestinationKind.Building, "landmark" => DestinationKind.Landmark, _ => DestinationKind.Place };
        var canNavigate = kind != DestinationKind.Place;
        return new DestinationDetail(
            kind, r.Id, r.Name, CategoryLabels.Humanize(r.Category), SearchResultGrouper.Subtitle(r),
            Array.Empty<string>(), r.Latitude, r.Longitude, r.Building?.Id,
            string.IsNullOrWhiteSpace(r.Description) ? null : r.Description, null, Array.Empty<string>(),
            canNavigate, canNavigate ? null : r.Kind == "geo" ? GeneralDirectionsUnavailable : "Directions to this place aren't available yet.",
            r.DataSource == DevFixture, DetailsLoaded: false)
        {
            BuildingName = r.Building?.Name,
            FloorName = FloorLabel(r.Floor?.Name, r.Floor?.FloorNumber),
        };
    }

    public static DestinationDetail FromBuilding(CampusBuildingDto b, CampusBuildingDetailDto? detail = null)
    {
        var rooms = detail?.Rooms ?? new List<CampusRoomDto>();
        var notable = rooms.Where(r => r.Type == "lecture_hall").Select(r => r.Name).Where(n => !string.IsNullOrWhiteSpace(n)).Take(5).ToList();
        var aliases = Clean(detail?.Aliases ?? b.Aliases, b.Name);
        return new DestinationDetail(
            DestinationKind.Building, b.Id, b.Name, CategoryLabels.Humanize(b.Type),
            string.IsNullOrWhiteSpace(b.Abbreviation) ? null : b.Abbreviation,
            aliases, b.Latitude, b.Longitude, b.Id,
            string.IsNullOrWhiteSpace(b.Description) ? null : b.Description,
            detail?.Floors?.Count, notable, CanNavigate: true, null, b.DataSource == DevFixture, DetailsLoaded: detail is not null);
    }

    public static DestinationDetail FromRoom(CampusRoomDetailDto r)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(r.Building?.Name)) parts.Add(r.Building!.Name);
        var floor = FloorLabel(r.Floor?.Name, r.Floor?.FloorNumber);
        if (floor is not null) parts.Add(floor);
        return new DestinationDetail(
            DestinationKind.Room, r.Id, r.Name, CategoryLabels.Humanize(r.Type),
            parts.Count > 0 ? string.Join(" · ", parts) : null,
            Clean(r.Aliases, r.Name), r.Building?.Latitude, r.Building?.Longitude, r.Building?.Id,
            string.IsNullOrWhiteSpace(r.Description) ? null : r.Description, null, Array.Empty<string>(),
            CanNavigate: true, null, r.DataSource == DevFixture, DetailsLoaded: true)
        {
            BuildingName = r.Building?.Name,
            FloorName = floor,
        };
    }

    public static DestinationDetail FromLandmark(CampusLandmarkDto l)
    {
        var routable = !string.IsNullOrWhiteSpace(l.NavigationNodeId);
        return new DestinationDetail(
            DestinationKind.Landmark, l.Id, l.Name, CategoryLabels.Humanize(l.Type), null,
            Clean(l.Aliases, l.Name), l.Latitude, l.Longitude, null,
            string.IsNullOrWhiteSpace(l.Description) ? null : l.Description, null, Array.Empty<string>(),
            routable, routable ? null : "This landmark isn't connected to the walking paths yet.",
            l.DataSource == DevFixture, DetailsLoaded: true);
    }
}

public enum HandoffKind { RouteFromDevice, NeedsStartPoint, NotRoutable }

public sealed record HandoffPlan(HandoffKind Kind, CampusRouteTo? Target, string? Message);

/// <summary>Decides how "Navigate from here" starts. Never fabricates an origin.</summary>
public static class NavigationHandoff
{
    /// <summary>The backend route target for a destination, or null if it can't be routed to.</summary>
    public static CampusRouteTo? TargetFor(DestinationDetail destination)
    {
        if (!destination.CanNavigate) return null;
        return destination.Kind switch
        {
            DestinationKind.Room => new CampusRouteTo { RoomId = destination.Id },
            DestinationKind.Building => new CampusRouteTo { BuildingId = destination.Id },
            DestinationKind.Landmark => new CampusRouteTo { LandmarkId = destination.Id },
            _ => null,
        };
    }

    public static HandoffPlan Plan(DestinationDetail destination, LocationFix? fix, LocationAvailability availability)
    {
        if (!destination.CanNavigate)
            return new(HandoffKind.NotRoutable, null, destination.CannotNavigateReason ?? "Directions to this place aren't available yet.");

        var target = TargetFor(destination);
        if (target is null) return new(HandoffKind.NotRoutable, null, "Directions to this place aren't available yet.");

        if (fix is { IsValid: true }) return new(HandoffKind.RouteFromDevice, target, null);

        var why = availability switch
        {
            LocationAvailability.PermissionDenied or LocationAvailability.PermissionRestricted =>
                "Location is turned off for UNIVAST, so we can't use where you are.",
            LocationAvailability.ServicesDisabled => "Location services are off on this device.",
            _ => "We can't find your location right now.",
        };
        return new(HandoffKind.NeedsStartPoint, target, why + " Choose a starting point on campus instead.");
    }
}

public sealed record GeoBounds(double MinLat, double MinLng, double MaxLat, double MaxLng)
{
    public bool IsPoint => MinLat == MaxLat && MinLng == MaxLng;
}

public static class CampusBounds
{
    /// <summary>Box around the campus centre plus every building, entrance and landmark that has valid coordinates.</summary>
    public static GeoBounds Compute(CampusSummaryDto campus, IEnumerable<CampusBuildingDto> buildings, IEnumerable<CampusLandmarkDto> landmarks)
    {
        var points = new List<(double Lat, double Lng)> { (campus.Latitude, campus.Longitude) };
        foreach (var b in buildings)
        {
            points.Add((b.Latitude, b.Longitude));
            foreach (var e in b.Entrances ?? new List<CampusEntranceDto>()) points.Add((e.Latitude, e.Longitude));
        }
        points.AddRange(landmarks.Select(l => (l.Latitude, l.Longitude)));

        var valid = points.Where(p => double.IsFinite(p.Lat) && double.IsFinite(p.Lng) && p.Lat is >= -90 and <= 90 && p.Lng is >= -180 and <= 180).ToList();
        if (valid.Count == 0) valid.Add((campus.Latitude, campus.Longitude));
        return new GeoBounds(valid.Min(p => p.Lat), valid.Min(p => p.Lng), valid.Max(p => p.Lat), valid.Max(p => p.Lng));
    }

    /// <summary>Web-Mercator map units per pixel for a slippy-map zoom level (256 px tiles).</summary>
    public static double ResolutionForZoom(double zoom) => 156543.03392804097 / Math.Pow(2, zoom);
}
