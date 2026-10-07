using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

public enum CampusPresence
{
    /// <summary>No usable device location (denied, off, unavailable) or not evaluated yet.</summary>
    Unknown,
    OnCampus,
    NearCampus,
    AwayFromCampus,
    /// <summary>The campus has no boundary configured, so the backend can't say either way.</summary>
    BoundaryNotConfigured,
}

public sealed record CampusPresenceState(CampusPresence Presence, string Title, string? Detail)
{
    public bool IsAway => Presence == CampusPresence.AwayFromCampus;
}

/// <summary>
/// Maps the BACKEND's geofence answer (inside/near/outside/unknown) to UI state. The mobile app never
/// computes distances or thresholds itself — that logic lives in backend/utils/geofence.js.
/// </summary>
public static class CampusPresenceMapper
{
    public static CampusPresenceState From(CampusLocateResultDto? locate, LocationAvailability availability)
    {
        if (availability != LocationAvailability.Available || locate is null)
        {
            return availability switch
            {
                LocationAvailability.PermissionDenied or LocationAvailability.PermissionRestricted =>
                    new(CampusPresence.Unknown, "Location is turned off for UNIVAST", "You can still explore and search this campus."),
                LocationAvailability.ServicesDisabled =>
                    new(CampusPresence.Unknown, "Location services are off on this device", "You can still explore and search this campus."),
                LocationAvailability.Unavailable =>
                    new(CampusPresence.Unknown, "Your location isn't available right now", "You can still explore and search this campus."),
                _ => new(CampusPresence.Unknown, "Finding your location…", null),
            };
        }

        var lowAccuracy = locate.Ambiguous ? " GPS accuracy is low, so this may not be exact." : "";

        return locate.Status switch
        {
            CampusLocateResultDto.Inside => new(CampusPresence.OnCampus, "You're on campus", locate.Ambiguous ? lowAccuracy.Trim() : null),
            CampusLocateResultDto.Near => new(CampusPresence.NearCampus, "You're near campus", locate.Ambiguous ? lowAccuracy.Trim() : null),
            CampusLocateResultDto.Outside => new(CampusPresence.AwayFromCampus, "You’re away from this campus",
                "Showing the campus map. You can still explore and search." + lowAccuracy),
            _ => new(CampusPresence.BoundaryNotConfigured, "This campus has no boundary set yet", "We can't tell whether you're on campus."),
        };
    }
}
