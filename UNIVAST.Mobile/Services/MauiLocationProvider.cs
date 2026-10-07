using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Devices.Sensors;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Device location via MAUI essentials. NOT linked into the plain-.NET test project (it uses MAUI APIs);
/// the view model only sees <see cref="ILocationProvider"/>.
/// </summary>
public sealed class MauiLocationProvider : ILocationProvider
{
    // Foreground updates: medium accuracy every 8 s is plenty for a walking map and far lighter on battery
    // than "Best / 2 s". The camera is never driven from these updates (see CampusMapViewModel).
    private static readonly GeolocationListeningRequest BrowseRequest = new(GeolocationAccuracy.Medium, TimeSpan.FromSeconds(8));

    // Following a route needs fresher, more accurate fixes (a turn is only ~10 m away). Used ONLY while navigating.
    private static readonly GeolocationListeningRequest NavigationRequest = new(GeolocationAccuracy.Best, TimeSpan.FromSeconds(2));

    private bool _listening;
    private LocationUpdateProfile _profile = LocationUpdateProfile.Browse;

    public event EventHandler<LocationFix>? LocationChanged;

    public async Task<LocationResult> GetCurrentAsync(bool requestPermission, CancellationToken ct = default)
    {
        try
        {
            var status = await MainThread.InvokeOnMainThreadAsync(() => Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>());

            if (status != PermissionStatus.Granted && requestPermission && status != PermissionStatus.Restricted)
            {
                status = await MainThread.InvokeOnMainThreadAsync(() => Permissions.RequestAsync<Permissions.LocationWhenInUse>());
            }

            if (status == PermissionStatus.Restricted) return LocationResult.Without(LocationAvailability.PermissionRestricted);
            if (status != PermissionStatus.Granted) return LocationResult.Without(LocationAvailability.PermissionDenied);

            // A cached fix is near-instant; fall back to a fresh one only if there is none.
            Microsoft.Maui.Devices.Sensors.Location? location = null;
            try { location = await Geolocation.Default.GetLastKnownLocationAsync(); } catch (Exception) { /* fall through to a fresh fix */ }
            location ??= await Geolocation.Default.GetLocationAsync(new GeolocationRequest(GeolocationAccuracy.Medium, TimeSpan.FromSeconds(8)), ct);

            return location is null
                ? LocationResult.Without(LocationAvailability.Unavailable)
                : LocationResult.WithFix(ToFix(location));
        }
        catch (FeatureNotEnabledException) { return LocationResult.Without(LocationAvailability.ServicesDisabled); }
        catch (PermissionException) { return LocationResult.Without(LocationAvailability.PermissionDenied); }
        catch (FeatureNotSupportedException) { return LocationResult.Without(LocationAvailability.Unavailable); }
        catch (OperationCanceledException) { return LocationResult.Without(LocationAvailability.Unavailable); }
        catch (Exception) { return LocationResult.Without(LocationAvailability.Unavailable); }
    }

    public async Task<bool> StartListeningAsync(LocationUpdateProfile profile = LocationUpdateProfile.Browse)
    {
        if (_listening)
        {
            if (_profile == profile) return true;
            StopListening(); // different profile: restart with the new accuracy/interval
        }
        try
        {
            var status = await MainThread.InvokeOnMainThreadAsync(() => Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>());
            if (status != PermissionStatus.Granted) return false; // never prompt from here

            Geolocation.Default.LocationChanged += OnPlatformLocationChanged;
            var started = await Geolocation.Default.StartListeningForegroundAsync(profile == LocationUpdateProfile.Navigation ? NavigationRequest : BrowseRequest);
            if (!started) Geolocation.Default.LocationChanged -= OnPlatformLocationChanged;
            _listening = started;
            _profile = profile;
            return started;
        }
        catch (Exception)
        {
            Geolocation.Default.LocationChanged -= OnPlatformLocationChanged;
            _listening = false;
            return false;
        }
    }

    public void StopListening()
    {
        if (!_listening) return;
        Geolocation.Default.LocationChanged -= OnPlatformLocationChanged;
        Geolocation.Default.StopListeningForeground();
        _listening = false;
    }

    public void OpenSettings() => AppInfo.Current.ShowSettingsUI();

    private void OnPlatformLocationChanged(object? sender, GeolocationLocationChangedEventArgs e) =>
        LocationChanged?.Invoke(this, ToFix(e.Location));

    private static LocationFix ToFix(Microsoft.Maui.Devices.Sensors.Location l) =>
        new(l.Latitude, l.Longitude, l.Accuracy, l.Timestamp);
}
