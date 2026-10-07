namespace UNIVAST.Mobile.Services;

/// <summary>Why a device location is or isn't available. Drives honest, specific UI messages.</summary>
public enum LocationAvailability
{
    Available,
    PermissionDenied,
    /// <summary>Blocked by the OS or policy (iOS "Restricted", or Android "don't ask again").</summary>
    PermissionRestricted,
    ServicesDisabled,
    /// <summary>No fix right now (timeout, no signal) or the device has no location hardware.</summary>
    Unavailable,
}

/// <summary>A real device fix. Only ever created from the platform's location API.</summary>
public sealed record LocationFix(double Latitude, double Longitude, double? AccuracyMeters, DateTimeOffset Timestamp)
{
    /// <summary>Finite and within valid ranges. (0,0) is deliberately NOT rejected — it is a valid coordinate.</summary>
    public bool IsValid =>
        double.IsFinite(Latitude) && double.IsFinite(Longitude) &&
        Latitude is >= -90 and <= 90 && Longitude is >= -180 and <= 180;
}

public sealed record LocationResult(LocationAvailability Availability, LocationFix? Fix)
{
    public static LocationResult WithFix(LocationFix fix) => new(LocationAvailability.Available, fix);
    public static LocationResult Without(LocationAvailability reason) => new(reason, null);
}

/// <summary>How hard the platform should work for fixes. Navigation needs frequent, accurate updates; browsing does not.</summary>
public enum LocationUpdateProfile
{
    /// <summary>Medium accuracy every few seconds — enough for a dot on the map, light on battery.</summary>
    Browse,
    /// <summary>Best accuracy, frequent — only while actively following a route.</summary>
    Navigation,
}

/// <summary>Platform-independent location source (MauiLocationProvider on device, a fake in tests).</summary>
public interface ILocationProvider
{
    /// <summary>
    /// Current location. When <paramref name="requestPermission"/> is false the user is never prompted.
    /// Never throws for permission/service problems — they are reported through <see cref="LocationResult"/>.
    /// </summary>
    Task<LocationResult> GetCurrentAsync(bool requestPermission, CancellationToken ct = default);

    event EventHandler<LocationFix>? LocationChanged;

    /// <summary>
    /// Starts foreground updates with the given profile (switching profile restarts them). Never prompts for
    /// permission. Returns false if they could not be started.
    /// </summary>
    Task<bool> StartListeningAsync(LocationUpdateProfile profile = LocationUpdateProfile.Browse);

    void StopListening();

    /// <summary>Opens the OS settings page for this app (so a denied permission can be re-enabled).</summary>
    void OpenSettings();
}
