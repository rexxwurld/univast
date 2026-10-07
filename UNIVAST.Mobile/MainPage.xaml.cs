using CommunityToolkit.Mvvm.Messaging;
using Mapsui;
using Mapsui.Extensions;
using Mapsui.Layers;
using Mapsui.Nts;
using Mapsui.Projections;
using Mapsui.Styles;
using Mapsui.Tiling;
using Mapsui.UI;
using Mapsui.UI.Maui;
using Microsoft.Maui.ApplicationModel;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;
using UNIVAST.Mobile.ViewModels;
using NetTopologySuite.Geometries;
using MapsuiBrush = Mapsui.Styles.Brush;
using MapsuiColor = Mapsui.Styles.Color;
using MapsuiPen = Mapsui.Styles.Pen;

namespace UNIVAST.Mobile;

/// <summary>
/// Map-first homepage: a full-screen Mapsui map with light overlays. It opens as a normal map; campus layers appear only when a campus is open. All state and decisions live in
/// <see cref="CampusMapViewModel"/>; this class only draws the map and forwards taps/permission-free UI events.
/// </summary>
public partial class MainPage : ContentPage
{
    private const string LayerBuildings = "campus-buildings";
    private const string LayerLandmarks = "campus-landmarks";
    private const string LayerEntrances = "campus-entrances";
    private const string LayerSelection = "campus-selection";
    private const string LayerUser = "campus-user";
    private const string LayerRoute = "campus-route";
    private const string LayerDestination = "campus-destination";

    private readonly CampusMapViewModel _vm;
    private readonly AuthService _authService;

    private MapView? _mapView;
    private bool _started;
    private CameraRequest? _pendingCamera;

    private MemoryLayer? _buildingsLayer;
    private MemoryLayer? _landmarksLayer;
    private MemoryLayer? _entrancesLayer;
    private MemoryLayer? _selectionLayer;
    private MemoryLayer? _userLayer;
    private MemoryLayer? _routeLayer;
    private MemoryLayer? _destinationLayer;
    private bool _zoomOnNextFollow;

    public MainPage(CampusMapViewModel vm, AuthService authService)
    {
        InitializeComponent();

        _vm = vm;
        _authService = authService;
        BindingContext = vm;

        // Other screens (a place that belongs to a campus) ask the map to show that campus.
        WeakReferenceMessenger.Default.Register<MainPage, ViewCampusOnMapMessage>(this,
            static (page, message) => page.Dispatcher.Dispatch(async () => await page._vm.ViewCampusAsync(message.CampusId, message.Latitude, message.Longitude)));

        CreateMap();

        _vm.MapContentChanged += (_, _) => MainThread.BeginInvokeOnMainThread(RebuildMarkerLayers);
        _vm.UserLocationChanged += (_, _) => MainThread.BeginInvokeOnMainThread(RebuildUserLayer);
        _vm.CameraRequested += (_, request) => MainThread.BeginInvokeOnMainThread(() => ApplyCamera(request));

        // An existing UNIVAST place/business was chosen from the search results: open its own detail screen.
        _vm.PlaceRequested += (_, placeId) => MainThread.BeginInvokeOnMainThread(async () =>
            await Shell.Current.GoToAsync($"{nameof(Pages.PlaceDetailPage)}?placeId={Uri.EscapeDataString(placeId)}"));

        // First "follow" after navigation starts also zooms in to walking scale; later ones only pan.
        _vm.Navigation.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(CampusNavigationViewModel.State) && _vm.Navigation.IsActive) _zoomOnNextFollow = true;
        };

        // Close the keyboard whenever search closes (result chosen, cancelled, or campus switched).
        _vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(CampusMapViewModel.IsSearchOpen) && !_vm.IsSearchOpen)
                MainThread.BeginInvokeOnMainThread(() => SearchEntry.Unfocus());
        };
    }

    // ---- lifecycle -----------------------------------------------------------------------------

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (!_started)
        {
            _started = true;
            await _vm.InitializeAsync();
        }
        else
        {
            await _vm.OnPageAppearingAsync();
        }
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        // Live location is the biggest battery cost: stop it whenever the map isn't on screen.
        _vm.OnPageDisappearing();
    }



    protected override bool OnBackButtonPressed()
{
    if (_vm.Navigation.IsNavigating)
    {
        _vm.Navigation.EndNavigationCommand.Execute(null);
        return true;
    }

    if (_vm.IsSearchOpen)
    {
        CloseSearchUi();
        return true;
    }

    if (_vm.HasDestination)
    {
        _vm.CloseDestinationCommand.Execute(null);
        return true;
    }

    return base.OnBackButtonPressed();
}

    // ---- map -----------------------------------------------------------------------------------

    private void CreateMap()
    {
        var map = new Mapsui.Map();
        map.Layers.Add(OpenStreetMap.CreateTileLayer("UNIVAST.Mobile/1.0 (univast)"));

        _mapView = new MapView
        {
            HorizontalOptions = LayoutOptions.Fill,
            VerticalOptions = LayoutOptions.Fill,
            Map = map,
            // Our own floating controls replace Mapsui's stock zoom/compass/location buttons.
            IsZoomButtonVisible = false,
            IsNorthingButtonVisible = false,
            IsMyLocationButtonVisible = false,
        };
        _mapView.Info += OnMapInfo;
        _mapView.SizeChanged += (_, _) =>
        {
            // ZoomToBox needs a laid-out viewport; apply a camera request that arrived too early.
            if (_pendingCamera is { } pending && _mapView.Width > 0 && _mapView.Height > 0)
            {
                _pendingCamera = null;
                ApplyCamera(pending);
            }
        };

        RootGrid.Children.Insert(0, _mapView);
    }

    private static MPoint ToMap(double latitude, double longitude)
    {
        var p = SphericalMercator.FromLonLat(longitude, latitude);
        return new MPoint(p.x, p.y);
    }

    private static SymbolStyle Symbol(SymbolType type, MapsuiColor fill, double scale, double outline = 2) => new()
    {
        SymbolType = type,
        SymbolScale = scale,
        Fill = new MapsuiBrush(fill),
        Outline = new MapsuiPen(MapsuiColor.White, outline),
    };

    private static PointFeature Feature(double latitude, double longitude, string kind, string id, string name, SymbolStyle style)
    {
        var feature = new PointFeature(ToMap(latitude, longitude));
        feature["kind"] = kind;
        feature["id"] = id;
        feature["name"] = name;
        feature.Styles.Add(style);
        return feature;
    }

    private void ReplaceLayer(ref MemoryLayer? slot, string name, IEnumerable<IFeature> features)
    {
        if (_mapView?.Map is not { } map) return;
        if (slot is not null) map.Layers.Remove(slot);
        slot = new MemoryLayer { Name = name, Features = features.ToList() };
        map.Layers.Add(slot);
    }

    /// <summary>
    /// Campus markers — drawn from backend data only. Buildings are ink squares, landmarks ink triangles and
    /// entrances small muted dots shown ONLY for the selected building, so the map stays uncluttered. The single
    /// accent colour is kept for you, the selected place and the route (see <see cref="MapPalette"/>).
    /// </summary>
    private void RebuildMarkerLayers()
    {
        if (_mapView?.Map is null) return;

        RebuildRouteLayers(); // underneath the campus markers

        var buildingStyle = Symbol(SymbolType.Rectangle, MapPalette.Data, 0.75);
        var landmarkStyle = Symbol(SymbolType.Triangle, MapPalette.Data, 0.7);
        var entranceStyle = Symbol(SymbolType.Ellipse, MapPalette.Minor, 0.4, 1.5);

        ReplaceLayer(ref _buildingsLayer, LayerBuildings,
            _vm.Buildings.Select(b => Feature(b.Latitude, b.Longitude, "building", b.Id, b.Name, buildingStyle)));

        ReplaceLayer(ref _landmarksLayer, LayerLandmarks,
            _vm.Landmarks.Select(l => Feature(l.Latitude, l.Longitude, "landmark", l.Id, l.Name, landmarkStyle)));

        ReplaceLayer(ref _entrancesLayer, LayerEntrances,
            _vm.VisibleEntrances.Select(e => Feature(e.Latitude, e.Longitude, "entrance", e.Id, e.Name, entranceStyle)));

        // Highlight ring around the selected item.
        var selected = _vm.SelectedMapItemId;
        var ring = new List<IFeature>();
        if (selected is not null)
        {
            var building = _vm.Buildings.FirstOrDefault(b => b.Id == selected);
            var landmark = _vm.Landmarks.FirstOrDefault(l => l.Id == selected);
            var style = new SymbolStyle
            {
                SymbolType = SymbolType.Ellipse,
                SymbolScale = 1.1,
                Fill = new MapsuiBrush(MapPalette.AccentFill),
                Outline = new MapsuiPen(MapPalette.Accent, 3),
            };
            if (building is not null) ring.Add(Feature(building.Latitude, building.Longitude, "selection", building.Id, building.Name, style));
            else if (landmark is not null) ring.Add(Feature(landmark.Latitude, landmark.Longitude, "selection", landmark.Id, landmark.Name, style));
            // A selected general map place (not campus data) is marked at its own coordinates.
            else if (_vm.Destination is { Latitude: double dlat, Longitude: double dlng } picked && picked.Id == selected)
            {
                var pin = Feature(dlat, dlng, "selection", picked.Id, picked.Title, style);
                pin.Styles.Add(Symbol(SymbolType.Ellipse, MapPalette.Accent, 0.45, 2.5)); // solid centre so the pin reads at any zoom
                ring.Add(pin);
            }
        }
        ReplaceLayer(ref _selectionLayer, LayerSelection, ring);

        // Keep the user's dot on top of the campus markers.
        RebuildUserLayer();
    }

    /// <summary>
    /// The route line exactly as the backend returned it (it follows graph edges — nothing is interpolated or
    /// straightened here) plus the destination flag. Removed entirely when there is no route.
    /// </summary>
    private void RebuildRouteLayers()
    {
        if (_mapView?.Map is not { } map) return;
        if (_routeLayer is not null) { map.Layers.Remove(_routeLayer); _routeLayer = null; }
        if (_destinationLayer is not null) { map.Layers.Remove(_destinationLayer); _destinationLayer = null; }

        if (_vm.Navigation.Route is not { } route || route.Geometry.Count < 2) return;

        var coordinates = route.Geometry
            .Select(g =>
            {
                var (x, y) = SphericalMercator.FromLonLat(g.Longitude, g.Latitude);
                return new Coordinate(x, y);
            })
            .ToArray();

        // White casing under the accent line keeps the route readable on any map background.
        var casing = new GeometryFeature(new LineString(coordinates))
        {
            Styles = new List<IStyle> { new VectorStyle { Line = new MapsuiPen(MapPalette.Outline, 10) } },
        };
        var line = new GeometryFeature(new LineString(coordinates))
        {
            Styles = new List<IStyle> { new VectorStyle { Line = new MapsuiPen(MapPalette.Accent, 6) } },
        };
        _routeLayer = new MemoryLayer { Name = LayerRoute, Features = new List<IFeature> { casing, line } };
        map.Layers.Add(_routeLayer);

        var end = route.DestinationPosition ?? route.Geometry[^1];
        var flag = Symbol(SymbolType.Ellipse, MapPalette.Accent, 0.9, 3);
        _destinationLayer = new MemoryLayer
        {
            Name = LayerDestination,
            Features = new List<IFeature> { Feature(end.Latitude, end.Longitude, "destination", "destination", route.DestinationTitle, flag) },
        };
        map.Layers.Add(_destinationLayer);
    }

    /// <summary>The user's real position (blue dot). Only drawn from an actual device fix.</summary>
    private void RebuildUserLayer()
    {
        if (_mapView?.Map is not { } map) return;
        if (_userLayer is not null) { map.Layers.Remove(_userLayer); _userLayer = null; }
        if (_vm.UserFix is not { IsValid: true } fix) { _mapView.RefreshGraphics(); return; }

        // A soft halo + solid dot. The halo is decoration (it is NOT the GPS accuracy radius).
        var halo = new SymbolStyle { SymbolType = SymbolType.Ellipse, SymbolScale = 1.3, Fill = new MapsuiBrush(MapPalette.AccentHalo), Outline = new MapsuiPen(MapPalette.AccentHalo, 0) };
        var dot = new SymbolStyle
        {
            SymbolType = SymbolType.Ellipse,
            SymbolScale = 0.7,
            Fill = new MapsuiBrush(MapPalette.Accent),
            Outline = new MapsuiPen(MapPalette.Outline, 3),
        };
        var me = Feature(fix.Latitude, fix.Longitude, "user", "user", "You", halo);
        me.Styles.Add(dot);
        _userLayer = new MemoryLayer { Name = LayerUser, Features = new List<IFeature> { me } };
        map.Layers.Add(_userLayer);
        _mapView.RefreshGraphics();
    }

    private void ApplyCamera(CameraRequest request)
    {
        if (_mapView?.Map is not { } map) return;
        if (_mapView.Width <= 0 || _mapView.Height <= 0) { _pendingCamera = request; return; }

        switch (request.Target)
        {
            case CameraTarget.Campus:
                FitCampus(map);
                break;
            case CameraTarget.User when request.Latitude is double ulat && request.Longitude is double ulng:
                map.Navigator.CenterOnAndZoomTo(ToMap(ulat, ulng), CampusBounds.ResolutionForZoom(request.Zoom ?? 18));
                break;
            case CameraTarget.Point when request.Latitude is double lat && request.Longitude is double lng:
                map.Navigator.CenterOnAndZoomTo(ToMap(lat, lng), CampusBounds.ResolutionForZoom(request.Zoom ?? 18));
                break;
            case CameraTarget.Follow when request.Latitude is double flat && request.Longitude is double flng:
                // Navigation only: keep the user in view. Zoom to walking scale once, then just pan.
                if (_zoomOnNextFollow)
                {
                    _zoomOnNextFollow = false;
                    map.Navigator.CenterOnAndZoomTo(ToMap(flat, flng), CampusBounds.ResolutionForZoom(18));
                }
                else map.Navigator.CenterOn(ToMap(flat, flng));
                break;
            case CameraTarget.Route when request.Bounds is { } routeBounds:
                FitBounds(map, routeBounds);
                break;
        }
    }

    private static void FitBounds(Mapsui.Map map, GeoBounds bounds)
    {
        var min = ToMap(bounds.MinLat, bounds.MinLng);
        var max = ToMap(bounds.MaxLat, bounds.MaxLng);
        if (bounds.IsPoint)
        {
            map.Navigator.CenterOnAndZoomTo(min, CampusBounds.ResolutionForZoom(18));
            return;
        }
        var box = new MRect(min.X, min.Y, max.X, max.Y);
        map.Navigator.ZoomToBox(box.Grow(Math.Max(box.Width, box.Height) * 0.25 + 30));
    }

    private void FitCampus(Mapsui.Map map)
    {
        if (_vm.Campus is not { } campus) return;

        var bounds = CampusBounds.Compute(campus, _vm.Buildings, _vm.Landmarks);
        var min = ToMap(bounds.MinLat, bounds.MinLng);
        var max = ToMap(bounds.MaxLat, bounds.MaxLng);

        if (bounds.IsPoint)
        {
            // Nothing to fit (no markers yet): centre on the campus at the campus's configured zoom.
            var zoom = campus.MapMetadata?.DefaultZoom ?? 17;
            map.Navigator.CenterOnAndZoomTo(ToMap(campus.Latitude, campus.Longitude), CampusBounds.ResolutionForZoom(zoom));
            return;
        }

        var box = new MRect(min.X, min.Y, max.X, max.Y);
        map.Navigator.ZoomToBox(box.Grow(Math.Max(box.Width, box.Height) * 0.25 + 50));
    }

    private void OnMapInfo(object? sender, MapInfoEventArgs e)
    {
        // Mapsui 5: name the layers to hit-test (see the same pattern in NearbyPlacesPage).
        var layers = new List<ILayer>();
        if (_entrancesLayer is not null) layers.Add(_entrancesLayer);
        if (_landmarksLayer is not null) layers.Add(_landmarksLayer);
        if (_buildingsLayer is not null) layers.Add(_buildingsLayer);
        if (layers.Count == 0) return;

        var feature = e.GetMapInfo(layers.ToArray()).Feature;
        if (feature is null) return;

        if (feature["kind"] is string kind && feature["id"] is string id && !string.IsNullOrEmpty(id))
        {
            e.Handled = true;
            _ = _vm.SelectMapItemAsync(kind, id);
        }
    }

    // ---- search UI -----------------------------------------------------------------------------

    private void SearchEntry_Focused(object? sender, FocusEventArgs e) => _vm.OpenSearchCommand.Execute(null);

    private void SearchEntry_TextChanged(object? sender, TextChangedEventArgs e) => _ = _vm.SearchAsync(e.NewTextValue);

    // Keyboard "Search" key: search right now, without waiting for the typing debounce.
    private void SearchEntry_Completed(object? sender, EventArgs e) => _ = _vm.SearchNowAsync(SearchEntry.Text);

    private void SearchRetry_Clicked(object? sender, EventArgs e) => _ = _vm.SearchNowAsync(SearchEntry.Text);

    private void SearchCancel_Clicked(object? sender, EventArgs e) => CloseSearchUi();

    private void CloseSearchUi()
    {
        SearchEntry.Unfocus();
        _vm.ClearSearch(); // clears SearchText, which the entry is bound to
        _vm.CloseSearchCommand.Execute(null);
    }

    // ---- menu / secondary features ---------------------------------------------------------------

    private async void Menu_Tapped(object? sender, Microsoft.Maui.Controls.TappedEventArgs e)
    {
        const string browse = "Browse campuses";
        const string exitCampus = "Close campus (back to map)";
        const string checkIn = "Check in to this campus";
        const string finder = "Campus finder";
        const string contribute = "Contribute campus data";
        const string places = "Nearby places & businesses";

        var account = await _authService.IsLoggedInAsync() ? "Account / Log out" : "Log in or create account";
        var options = new List<string> { browse };
        if (_vm.CanCheckIn) options.Add(checkIn);
        if (_vm.HasCampus) options.AddRange(new[] { finder, contribute, exitCampus });
        options.AddRange(new[] { places, account });

        var choice = await DisplayActionSheetAsync("UNIVAST", "Cancel", null, options.ToArray());

        switch (choice)
        {
            case browse: _vm.ShowCampusPickerCommand.Execute(null); break;
            case checkIn: await _vm.CheckInAsync(); break;
            case exitCampus: _vm.ExitCampusCommand.Execute(null); break;
            case finder:
                if (_vm.Campus is not null)
                    await Shell.Current.GoToAsync($"{nameof(Pages.CampusDiscoveryPage)}?campusId={Uri.EscapeDataString(_vm.Campus.Id)}&campusName={Uri.EscapeDataString(_vm.Campus.Name)}");
                break;
            case contribute:
                if (_vm.Campus is not null)
                    await Shell.Current.GoToAsync($"{nameof(Pages.ContributionCenterPage)}?campusId={Uri.EscapeDataString(_vm.Campus.Id)}&campusName={Uri.EscapeDataString(_vm.Campus.Name)}");
                break;
            case places: await Shell.Current.GoToAsync(nameof(NearbyPlacesPage)); break;
            case var a when a == account: await HandleAccountAsync(); break;
        }
    }

    private async void Contribute_Clicked(object? sender, EventArgs e)
    {
        if (_vm.Campus is null) return;
        await Shell.Current.GoToAsync($"{nameof(Pages.ContributionCenterPage)}?campusId={Uri.EscapeDataString(_vm.Campus.Id)}&campusName={Uri.EscapeDataString(_vm.Campus.Name)}");
    }

    private async void NearbyPlaces_Clicked(object? sender, EventArgs e) =>
        await Shell.Current.GoToAsync(nameof(NearbyPlacesPage));

    private async Task HandleAccountAsync()
    {
        var user = await _authService.GetCurrentUserAsync();

        if (user is null || !await _authService.IsLoggedInAsync())
        {
            var choice = await DisplayActionSheetAsync("Account", "Cancel", null, "Log in", "Create account");
            if (choice == "Log in") await Shell.Current.GoToAsync(nameof(Pages.LoginPage));
            else if (choice == "Create account") await Shell.Current.GoToAsync(nameof(Pages.RegisterPage));
            return;
        }

        var action = await DisplayActionSheetAsync($"{user.Name} ({user.Email})", "Cancel", "Log out");
        if (action == "Log out")
        {
            await _authService.LogoutAsync();
            await DisplayAlertAsync("Logged out", "You have been signed out.", "OK");
        }
    }

    // ---- navigate hand-off: alternative start points ---------------------------------------------

    /// <summary>
    /// For a general map place UNIVAST has no routing provider. The phone's own maps app does, so hand the point over
    /// to it — clearly labelled as such; UNIVAST shows no route, distance or time of its own for these places.
    /// </summary>
    private async void OpenInMapsApp_Clicked(object? sender, EventArgs e)
    {
        if (_vm.Destination is not { Latitude: double lat, Longitude: double lng } place) return;
        try
        {
            await Microsoft.Maui.ApplicationModel.Map.Default.OpenAsync(lat, lng, new MapLaunchOptions { Name = place.Title });
        }
        catch (Exception)
        {
            _vm.Notice = "Couldn't open a maps app on this device.";
        }
    }

    private async void ChooseStartPoint_Clicked(object? sender, EventArgs e)
    {
        var options = _vm.StartPointOptions;
        if (options.Count == 0) return;

        var names = options.Select(o => o.Name).Distinct().ToArray();
        var choice = await DisplayActionSheetAsync("Start from", "Cancel", null, names);
        var landmark = options.FirstOrDefault(o => o.Name == choice);
        if (landmark is not null) await _vm.NavigateFromLandmarkAsync(landmark);
    }
}
