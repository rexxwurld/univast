using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

public readonly record struct GeoPoint(double Latitude, double Longitude)
{
    public bool IsValid => double.IsFinite(Latitude) && double.IsFinite(Longitude) && Latitude is >= -90 and <= 90 && Longitude is >= -180 and <= 180;
}

/// <summary>Navigation behaviour, taken from the backend's per-campus routing settings (route.metadata).</summary>
public sealed record NavigationSettings(double WalkingSpeedMetersPerSecond, double RerouteDeviationMeters, double RerouteMinIntervalSeconds, double ArrivalRadiusMeters)
{
    /// <summary>
    /// Used ONLY when an older backend sends no metadata. Identical to the defaults of Campus.routing in
    /// backend/models/Campus.js, so behaviour is the same either way.
    /// </summary>
    public static NavigationSettings Fallback { get; } = new(1.34, 30, 15, 15);

    public static NavigationSettings From(CampusRouteMetadataDto? m)
    {
        static double Pick(double? value, double fallback) => value is double v && double.IsFinite(v) && v > 0 ? v : fallback;
        var f = Fallback;
        return new(
            Pick(m?.WalkingSpeedMetersPerSecond, f.WalkingSpeedMetersPerSecond),
            Pick(m?.RerouteDeviationMeters, f.RerouteDeviationMeters),
            Pick(m?.RerouteMinIntervalSeconds, f.RerouteMinIntervalSeconds),
            Pick(m?.ArrivalRadiusMeters, f.ArrivalRadiusMeters));
    }
}

public sealed record RouteStepModel(
    string Maneuver,
    string Text,
    double DistanceMeters,
    double DurationSeconds,
    GeoPoint? At,
    double ProgressMeters,
    bool HasPosition)
{
    public string Glyph => NavigationFormat.ManeuverGlyph(Maneuver);
    public string? Landmark { get; init; }
    public string? Floor { get; init; }
}

/// <summary>
/// A route as the navigation UI uses it: validated geometry, steps with resolved positions along the route,
/// and the campus's navigation settings. Built from the backend DTO and never throws on odd data — it just
/// reports that turn-by-turn is not possible.
/// </summary>
public sealed class RouteModel
{
    public IReadOnlyList<GeoPoint> Geometry { get; }
    public IReadOnlyList<double> CumulativeMeters { get; }
    public double GeometryLengthMeters { get; }
    public double TotalDistanceMeters { get; }
    public double TotalDurationSeconds { get; }
    public IReadOnlyList<RouteStepModel> Steps { get; }
    public NavigationSettings Settings { get; }
    public string DestinationTitle { get; }
    public string? DestinationSubtitle { get; }
    public GeoPoint? DestinationPosition { get; }
    public string? IndoorDescription { get; }
    public string? GraphVersion { get; }
    public bool AccessibleOnly { get; }

    /// <summary>Box around the route line (for "show the whole route").</summary>
    public GeoBounds? Bounds => Geometry.Count == 0
        ? null
        : new GeoBounds(Geometry.Min(g => g.Latitude), Geometry.Min(g => g.Longitude), Geometry.Max(g => g.Latitude), Geometry.Max(g => g.Longitude));

    /// <summary>True when there is real geometry and positioned steps to follow. Legacy/odd routes are preview-only.</summary>
    public bool CanNavigate => Geometry.Count >= 2 && GeometryLengthMeters > 0 && Steps.Count > 0 && Steps.All(s => s.HasPosition);

    private RouteModel(IReadOnlyList<GeoPoint> geometry, IReadOnlyList<double> cumulative, double length, double distance, double duration,
        IReadOnlyList<RouteStepModel> steps, NavigationSettings settings, string title, string? subtitle, GeoPoint? destinationPosition,
        string? indoor, string? graphVersion, bool accessibleOnly)
    {
        Geometry = geometry; CumulativeMeters = cumulative; GeometryLengthMeters = length; TotalDistanceMeters = distance;
        TotalDurationSeconds = duration; Steps = steps; Settings = settings; DestinationTitle = title; DestinationSubtitle = subtitle;
        DestinationPosition = destinationPosition; IndoorDescription = indoor; GraphVersion = graphVersion; AccessibleOnly = accessibleOnly;
    }

    public static RouteModel From(CampusRouteResponseDto dto)
    {
        var settings = NavigationSettings.From(dto.Metadata);
        var (geometry, cumulative, length) = ParseGeometry(dto.Geometry);
        var distance = dto.DistanceMeters is double d && double.IsFinite(d) && d >= 0 ? d : length;
        var duration = dto.DurationSeconds is double s && double.IsFinite(s) && s >= 0 ? s : distance / settings.WalkingSpeedMetersPerSecond;

        var steps = BuildSteps(dto, geometry, cumulative, length, distance, settings);

        var destination = dto.Destination;
        var subtitleParts = new List<string>();
        if (!string.IsNullOrWhiteSpace(destination?.Building?.Name)) subtitleParts.Add(destination!.Building!.Name);
        var floor = DestinationBuilder.FloorLabel(destination?.Floor?.Name, destination?.Floor?.FloorNumber);
        if (floor is not null && destination?.Kind == "room") subtitleParts.Add(floor);

        GeoPoint? position = destination?.Position is { IsValid: true } p ? new GeoPoint(p.Latitude, p.Longitude) : null;

        return new RouteModel(geometry, cumulative, length, distance, duration, steps, settings,
            string.IsNullOrWhiteSpace(destination?.Name) ? "Destination" : destination!.Name!,
            subtitleParts.Count > 0 ? string.Join(" · ", subtitleParts) : null,
            position, destination?.Indoor?.Description, dto.Metadata?.GraphVersion, dto.Metadata?.AccessibleOnly ?? false);
    }

    private static (IReadOnlyList<GeoPoint>, IReadOnlyList<double>, double) ParseGeometry(CampusRouteGeometryDto? geometry)
    {
        var points = new List<GeoPoint>();
        foreach (var pair in geometry?.Coordinates ?? new List<List<double>>())
        {
            // GeoJSON order is [longitude, latitude]. One bad coordinate makes the whole line untrustworthy.
            if (pair is null || pair.Count < 2) return (Array.Empty<GeoPoint>(), Array.Empty<double>(), 0);
            var point = new GeoPoint(pair[1], pair[0]);
            if (!point.IsValid) return (Array.Empty<GeoPoint>(), Array.Empty<double>(), 0);
            points.Add(point);
        }

        if (points.Count == 0) return (points, Array.Empty<double>(), 0);

        var cumulative = new List<double>(points.Count) { 0 };
        for (var i = 1; i < points.Count; i++) cumulative.Add(cumulative[i - 1] + GeoMath.DistanceMeters(points[i - 1], points[i]));
        return (points, cumulative, cumulative[^1]);
    }

    private static IReadOnlyList<RouteStepModel> BuildSteps(CampusRouteResponseDto dto, IReadOnlyList<GeoPoint> geometry,
        IReadOnlyList<double> cumulative, double geometryLength, double totalDistance, NavigationSettings settings)
    {
        var result = new List<RouteStepModel>();
        var previous = 0.0;

        if (dto.Steps is { Count: > 0 })
        {
            foreach (var step in dto.Steps.Where(s => !string.IsNullOrWhiteSpace(s.Text)))
            {
                double? progress = null;
                if (step.DistanceFromStartMeters is double d && double.IsFinite(d) && d >= 0) progress = Math.Min(d, totalDistance);
                else if (step.GeometryIndex is int i && i >= 0 && i < cumulative.Count && geometryLength > 0)
                    progress = cumulative[i] / geometryLength * totalDistance;

                var hasPosition = progress is not null;
                var value = Math.Max(previous, progress ?? previous); // progress along the route never goes backwards
                previous = value;

                GeoPoint? at = step.At is { IsValid: true } a ? new GeoPoint(a.Latitude, a.Longitude) : null;
                var distance = step.DistanceMeters is double sd && double.IsFinite(sd) && sd >= 0 ? sd : 0;
                var duration = step.DurationSeconds is double ss && double.IsFinite(ss) && ss >= 0 ? ss : distance / settings.WalkingSpeedMetersPerSecond;

                result.Add(new RouteStepModel(step.Maneuver ?? ManeuverFromType(step.Type), step.Text, distance, duration, at, value, hasPosition)
                {
                    Landmark = step.Landmark,
                    Floor = step.Floor,
                });
            }
            return result;
        }

        // Older backend: only flat instructions. They can be shown as a list but cannot drive navigation.
        foreach (var instruction in (dto.Instructions ?? new()).Where(i => !string.IsNullOrWhiteSpace(i.Text)))
        {
            var distance = instruction.DistanceMeters is double d && double.IsFinite(d) && d >= 0 ? d : 0;
            result.Add(new RouteStepModel(ManeuverFromType(instruction.Type), instruction.Text, distance, distance / settings.WalkingSpeedMetersPerSecond, null, 0, false));
        }
        return result;
    }

    private static string ManeuverFromType(string? type) => type switch
    {
        "depart" or "start" => "depart",
        "enter" => "enter_building",
        "exit" => "exit_building",
        "arrive" or "destination_floor" => "arrive",
        _ => "continue",
    };
}

public static class GeoMath
{
    private const double EarthRadiusMeters = 6371000;
    private const double MetersPerDegreeLatitude = 111320;

    public static double DistanceMeters(GeoPoint a, GeoPoint b)
    {
        static double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(b.Latitude - a.Latitude);
        var dLng = Rad(b.Longitude - a.Longitude);
        var h = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(Rad(a.Latitude)) * Math.Cos(Rad(b.Latitude)) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return 2 * EarthRadiusMeters * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }

    /// <summary>Distance from <paramref name="p"/> to segment a-b, and where along the segment (0..1) the closest point lies.</summary>
    public static (double DistanceMeters, double T) ProjectOntoSegment(GeoPoint p, GeoPoint a, GeoPoint b)
    {
        var cosLat = Math.Cos(p.Latitude * Math.PI / 180);
        double X(GeoPoint q) => (q.Longitude - p.Longitude) * MetersPerDegreeLatitude * cosLat;
        double Y(GeoPoint q) => (q.Latitude - p.Latitude) * MetersPerDegreeLatitude;

        double ax = X(a), ay = Y(a), bx = X(b), by = Y(b);
        double dx = bx - ax, dy = by - ay;
        var lengthSquared = dx * dx + dy * dy;
        var t = lengthSquared == 0 ? 0 : Math.Clamp(-(ax * dx + ay * dy) / lengthSquared, 0, 1);
        return (Math.Sqrt(Math.Pow(ax + t * dx, 2) + Math.Pow(ay + t * dy, 2)), t);
    }
}
