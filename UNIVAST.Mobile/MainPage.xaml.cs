using Mapsui;
using Mapsui.Projections;
using Mapsui.Styles;
using Mapsui.Tiling;
using Mapsui.UI;
using Mapsui.UI.Maui;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Devices.Sensors;
using static Microsoft.Maui.ApplicationModel.Permissions;
using Mapsui.Layers;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile;

public partial class MainPage : ContentPage
{
    private const double DefaultSearchRadiusMeters = 3000;

    private readonly DiscoveryApiService _discoveryApi;

    private MapView? _mapView;
    private bool _isTrackingLocation;
    private bool _hasCenteredOnUser;
    private MemoryLayer? _locationLayer;
    private MemoryLayer? _placesLayer;

    private double? _lastLatitude;
    private double? _lastLongitude;

    private List<CategoryDto> _categories = new();
    private string? _selectedCategoryId;

    public MainPage(DiscoveryApiService discoveryApi)
    {
        InitializeComponent();

        _discoveryApi = discoveryApi;

        CreateMap();

        _ = InitializeLocationAsync();
        _ = LoadCategoriesAsync();
    }

    private async Task LoadCategoriesAsync()
    {
        try
        {
            _categories = await _discoveryApi.GetCategoriesAsync();
            BuildCategoryChips();
        }
        catch (Exception)
        {
            NoCategoriesLabel.IsVisible = true;
        }
    }

    private void BuildCategoryChips()
    {
        CategoryChipsPanel.Children.Clear();
        CategoryChipsPanel.Children.Add(CreateCategoryChip("All", null));

        foreach (var category in _categories)
        {
            var label = string.IsNullOrWhiteSpace(category.Icon) ? category.Name : $"{category.Icon}  {category.Name}";
            CategoryChipsPanel.Children.Add(CreateCategoryChip(label, category.Id));
        }
    }

    private Button CreateCategoryChip(string text, string? categoryId)
    {
        var isSelected = _selectedCategoryId == categoryId;

        var chip = new Button
        {
            Text = text,
            FontSize = 13,
            CornerRadius = 16,
            Padding = new Thickness(14, 8),
            Margin = new Thickness(0, 0, 8, 8),
            BackgroundColor = isSelected ? Color.FromArgb("#1976D2") : Color.FromArgb("#F2F2F2"),
            TextColor = isSelected ? Colors.White : Color.FromArgb("#111111"),
        };

        chip.Clicked += (s, e) =>
        {
            _selectedCategoryId = categoryId;
            BuildCategoryChips(); // rebuild so the newly selected chip highlights
            ExplorePanel.IsVisible = false;
            ExploreButton.IsVisible = true;
            RunSearch();
        };

        return chip;
    }

    private void CreateMap()
    {
        var map = new Mapsui.Map();

        map.Layers.Add(
            OpenStreetMap.CreateTileLayer(
                "UNIVAST.Mobile/1.0 (univast)"
            )
        );

        _mapView = new MapView
        {
            HorizontalOptions = LayoutOptions.Fill,
            VerticalOptions = LayoutOptions.Fill
        };

        _mapView.Map = map;

        // Fires on a map tap. Mapsui 5 removed Layer.IsMapInfoLayer: the handler must say
        // which layers to hit-test (see OnMapInfo) — used to open a place's detail page
        // when its marker is tapped.
        _mapView.Info += OnMapInfo;

        // Put the real map behind your existing UI.
        var grid = Content as Grid;

        if (grid != null)
        {
            grid.Children.Insert(0, _mapView);
        }
    }

    private void Explore_Clicked(object sender, EventArgs e)
    {
        ExplorePanel.IsVisible = true;
        ExploreButton.IsVisible = false;
    }

    private void CloseExplore_Clicked(object sender, EventArgs e)
    {
        ExplorePanel.IsVisible = false;
        ExploreButton.IsVisible = true;
    }

    private async void Navigate_Clicked(object sender, EventArgs e)
    {
        await Shell.Current.GoToAsync(nameof(Pages.RoutePage));
    }

    /// <summary>
    /// Gets the map onto the user's actual location as fast as possible, then loads
    /// nearby places once. Deliberately two-tier: a cached last-known fix (near
    /// instant) is used to center+zoom immediately if available, so the map never
    /// sits on the default world view waiting for a fresh GPS fix. Only falls back
    /// to a fresh GetLocationAsync call if there's no cached fix at all.
    /// </summary>
    private async Task InitializeLocationAsync()
    {
        Microsoft.Maui.Devices.Sensors.Location? location = null;

        try
        {
            location = await Geolocation.Default.GetLastKnownLocationAsync();
        }
        catch (Exception)
        {
            // No cached fix available (or platform doesn't support it) — fall through.
        }

        location ??= await GetCurrentLocationAsync();

        if (location != null)
        {
            await CenterOnAndLoadNearbyAsync(location.Latitude, location.Longitude, zoom: true);
        }

        LocationLoadingIndicator.IsVisible = false;
        LocationLoadingIndicator.IsRunning = false;

        _ = StartLocationTrackingAsync();
    }

    private async Task CenterOnAndLoadNearbyAsync(double latitude, double longitude, bool zoom)
    {
        if (_mapView?.Map == null) return;

        var mapPoint = SphericalMercator.FromLonLat(longitude, latitude);

        if (zoom)
        {
            _mapView.Map.Navigator.CenterOnAndZoomTo(new MPoint(mapPoint.x, mapPoint.y), 16);
        }

        _lastLatitude = latitude;
        _lastLongitude = longitude;
        _hasCenteredOnUser = true;

        await LoadNearbyPlacesAsync(latitude, longitude);
    }

    /// <summary>
    /// Fetches nearby places once for a given location and renders them as markers.
    /// Deliberately NOT called on every live-location update (see OnLocationChanged) —
    /// refetching on every GPS tick would be excessive network use for no real benefit.
    /// </summary>
    private async Task LoadNearbyPlacesAsync(double latitude, double longitude, string? query = null)
    {
        if (_mapView?.Map == null) return;

        List<PlaceDto> places;
        try
        {
            places = await _discoveryApi.GetNearbyAsync(
                latitude, longitude, DefaultSearchRadiusMeters,
                categoryId: _selectedCategoryId, query: query);

            // Only cache plain area/category results — a text search's results aren't
            // "what's around here" and would poison the offline fallback.
            if (string.IsNullOrWhiteSpace(query))
            {
                NearbyPlacesCache.Save(latitude, longitude, _selectedCategoryId, places);
            }
            OfflineBanner.IsVisible = false;
        }
        catch (Exception)
        {
            // Fall back to the closest cached area (same category) rather than leaving
            // the map empty — a real offline state instead of a silent failure.
            var cached = NearbyPlacesCache.Load(latitude, longitude, _selectedCategoryId);
            if (cached == null || cached.Count == 0)
            {
                return;
            }

            places = cached;
            OfflineBanner.IsVisible = true;
        }

        var features = new List<PointFeature>();
        foreach (var place in places)
        {
            var point = SphericalMercator.FromLonLat(place.Location.Longitude, place.Location.Latitude);
            var feature = new PointFeature(new MPoint(point.x, point.y));
            feature["placeId"] = place.Id;
            feature["placeName"] = place.Name;

            feature.Styles.Add(new SymbolStyle
            {
                SymbolScale = 0.7,
                Fill = new Mapsui.Styles.Brush(new Mapsui.Styles.Color(255, 87, 34)), // orange — distinct from the blue "my location" dot
                Outline = new Mapsui.Styles.Pen(Mapsui.Styles.Color.White, 2)
            });

            features.Add(feature);
        }

        if (_placesLayer != null)
        {
            _mapView.Map.Layers.Remove(_placesLayer);
        }

        _placesLayer = new MemoryLayer
        {
            Name = "Nearby Places",
            Features = features,
        };

        _mapView.Map.Layers.Add(_placesLayer);
    }

    private void OnMapInfo(object? sender, MapInfoEventArgs e)
    {
        if (_placesLayer is null) return;

        // Mapsui 5: MapInfo is no longer a property of the event args; ask for it and
        // name the layer(s) to query.
        var feature = e.GetMapInfo(new ILayer[] { _placesLayer }).Feature;
        if (feature == null) return;

        if (feature["placeId"] is string placeId && !string.IsNullOrEmpty(placeId))
        {
            e.Handled = true;
            _ = Shell.Current.GoToAsync($"{nameof(Pages.PlaceDetailPage)}?placeId={Uri.EscapeDataString(placeId)}");
        }
    }

    private void SearchButton_Clicked(object sender, EventArgs e) => RunSearch();

    private void SearchEntry_Completed(object sender, EventArgs e) => RunSearch();

    private void RunSearch()
    {
        if (_lastLatitude is not double lat || _lastLongitude is not double lng) return;

        var query = SearchEntry.Text?.Trim();
        _ = LoadNearbyPlacesAsync(lat, lng, string.IsNullOrWhiteSpace(query) ? null : query);
    }

    private async Task<Microsoft.Maui.Devices.Sensors.Location?> GetCurrentLocationAsync()
    {
        try
        {
            var permission =
                await Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>();

            if (permission != PermissionStatus.Granted)
            {
                permission =
                    await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
            }

            if (permission != PermissionStatus.Granted)
            {
                await DisplayAlertAsync(
                    "Location",
                    "Location permission was not granted.",
                    "OK");

                return null;
            }

            var request = new GeolocationRequest(
                GeolocationAccuracy.Medium,
                TimeSpan.FromSeconds(8));

            return await Geolocation.Default.GetLocationAsync(request);
        }
        catch (System.Exception ex)
        {
            await DisplayAlertAsync(
                "Location Error",
                ex.Message,
                "OK");

            return null;
        }
    }

    // Live GPS is the biggest battery cost in the app. Stop it whenever the map isn't
    // on screen (e.g. while a place detail page is open) and resume when it returns.
    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_hasCenteredOnUser && !_isTrackingLocation)
        {
            await StartLocationTrackingAsync();
        }
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        StopLocationTracking();
    }

    private void StopLocationTracking()
    {
        if (!_isTrackingLocation) return;

        Geolocation.Default.LocationChanged -= OnLocationChanged;
        Geolocation.Default.StopListeningForeground();
        _isTrackingLocation = false;
    }

    private async Task StartLocationTrackingAsync()
    {
        if (_isTrackingLocation)
            return;

        var permission =
            await Permissions.CheckStatusAsync<Permissions.LocationWhenInUse>();

        if (permission != PermissionStatus.Granted)
        {
            permission =
                await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
        }

        if (permission != PermissionStatus.Granted)
        {
            await DisplayAlertAsync(
                "Location",
                "Location permission is required for live navigation.",
                "OK");

            return;
        }

        var request = new GeolocationListeningRequest(
            GeolocationAccuracy.Best,
            TimeSpan.FromSeconds(2));

        var started =
            await Geolocation.Default.StartListeningForegroundAsync(request);

        if (!started)
        {
            await DisplayAlertAsync(
                "Location",
                "Could not start live location tracking.",
                "OK");

            return;
        }

        _isTrackingLocation = true;

        Geolocation.Default.LocationChanged += OnLocationChanged;
    }

    private void OnLocationChanged(
    object? sender,
    GeolocationLocationChangedEventArgs e)
    {
        var location = e.Location;

        if (_mapView?.Map == null)
            return;

        MainThread.BeginInvokeOnMainThread(() =>
        {
            var mapPoint = SphericalMercator.FromLonLat(
                location.Longitude,
                location.Latitude);

            var feature = new PointFeature(
                new MPoint(mapPoint.x, mapPoint.y));

            feature.Styles.Add(
                new SymbolStyle
                {
                    SymbolScale = 0.8,
                    Fill = new Mapsui.Styles.Brush(
                        new Mapsui.Styles.Color(33, 150, 243)),
                    Outline = new Mapsui.Styles.Pen(
                        Mapsui.Styles.Color.White,
                        3)
                });

            if (_locationLayer != null)
            {
                _mapView.Map.Layers.Remove(_locationLayer);
            }

            _locationLayer = new MemoryLayer
            {
                Name = "My Location",
                Features = new[] { feature }
            };

            _mapView.Map.Layers.Add(_locationLayer);

            // Only zoom-to-fit on the very first fix. If InitializeLocationAsync
            // already got a fix (the common case), _hasCenteredOnUser is already
            // true and this is skipped — live updates just move the dot without
            // yanking the camera back if the user has panned around. If both the
            // cached and fresh location attempts failed, this is the fallback:
            // the first live update centers and zooms in properly instead of
            // leaving the map at whatever (likely default) zoom it was at.
            if (!_hasCenteredOnUser)
            {
                _mapView.Map.Navigator.CenterOnAndZoomTo(new MPoint(mapPoint.x, mapPoint.y), 16);
                _hasCenteredOnUser = true;
                _lastLatitude = location.Latitude;
                _lastLongitude = location.Longitude;
                _ = LoadNearbyPlacesAsync(location.Latitude, location.Longitude);
            }
        });
    }
}
