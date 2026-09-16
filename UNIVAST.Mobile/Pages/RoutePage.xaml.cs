using Mapsui;
using Mapsui.Extensions;
using Mapsui.Layers;
using Mapsui.Nts;
using Mapsui.Projections;
using Mapsui.Styles;
using Mapsui.Tiling;
using Microsoft.Maui.Devices.Sensors;
using NetTopologySuite.Geometries;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Pages;

public partial class RoutePage : ContentPage
{
    private readonly UnivastApiService _api;
    private readonly string _campusId;

    private List<NavigationNodeDto> _nodes = new();
    private const string MarkerLayerName = "univast-markers";
    private const string RouteLayerName = "univast-route";

    public RoutePage(UnivastApiService api)
    {
        InitializeComponent();
        _api = api;
        _campusId = ApiConfig.DefaultCampusId;

        InitializeMap();
    }

    /// <summary>Base map setup: a plain OSM tile layer as the backdrop.</summary>
    private void InitializeMap()
    {
        var map = new Map();
        map.Layers.Add(OpenStreetMap.CreateTileLayer());
        MapView.Map = map;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await LoadNodesAsync();
    }

    private async Task LoadNodesAsync()
    {
        if (string.IsNullOrWhiteSpace(_campusId))
        {
            ShowStatus("No campus configured yet. Set ApiConfig.DefaultCampusId once a campus exists.");
            return;
        }

        try
        {
            SetBusy(true);
            _nodes = await _api.GetNavigationNodesAsync(_campusId);

            StartPicker.ItemsSource = _nodes;
            EndPicker.ItemsSource = _nodes;

            if (_nodes.Count == 0)
            {
                ShowStatus("This campus has no navigation nodes yet. Add some via the backend API first.");
            }
            else
            {
                HideStatus();
            }
        }
        catch (UnivastApiException ex)
        {
            ShowStatus($"Couldn't load navigation nodes: {ex.Message}");
        }
        catch (Exception ex)
        {
            ShowStatus($"Couldn't reach the backend: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void UseMyLocation_Clicked(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_campusId))
        {
            ShowStatus("No campus configured yet.");
            return;
        }

        try
        {
            SetBusy(true);
            HideStatus();

            var permissionStatus = await Permissions.RequestAsync<Permissions.LocationWhenInUse>();
            if (permissionStatus != PermissionStatus.Granted)
            {
                ShowStatus("Location permission was not granted.");
                return;
            }

            var location = await Geolocation.Default.GetLocationAsync(
                new GeolocationRequest(GeolocationAccuracy.Best, TimeSpan.FromSeconds(10)));

            if (location is null)
            {
                ShowStatus("Couldn't determine your current location.");
                return;
            }

            var nearest = await _api.GetNearestNodeAsync(_campusId, location.Latitude, location.Longitude);
            if (nearest.Node is null)
            {
                ShowStatus("No navigation node found near your location.");
                return;
            }

            var matched = _nodes.FirstOrDefault(n => n.Id == nearest.Node.Id);
            if (matched is not null)
            {
                StartPicker.SelectedItem = matched;
            }
        }
        catch (UnivastApiException ex)
        {
            ShowStatus($"Couldn't find the nearest node: {ex.Message}");
        }
        catch (Exception ex)
        {
            ShowStatus($"Couldn't get your location: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void GetRoute_Clicked(object? sender, EventArgs e)
    {
        var start = StartPicker.SelectedItem as NavigationNodeDto;
        var end = EndPicker.SelectedItem as NavigationNodeDto;

        if (start is null || end is null)
        {
            ShowStatus("Pick both a start and a destination.");
            return;
        }

        if (start.Id == end.Id)
        {
            ShowStatus("Start and destination must be different.");
            return;
        }

        try
        {
            SetBusy(true);
            HideStatus();
            RouteSummaryLabel.IsVisible = false;

            var route = await _api.GetRouteAsync(_campusId, start.Id, end.Id);

            DrawRoute(route);

            RouteSummaryLabel.Text = $"{route.Distance:F0} m · {route.Nodes.Count} stop(s)";
            RouteSummaryLabel.IsVisible = true;
        }
        catch (UnivastApiException ex)
        {
            ShowStatus(ex.Message);
        }
        catch (Exception ex)
        {
            ShowStatus($"Couldn't calculate a route: {ex.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    /// <summary>
    /// Renders the route on the map: a marker per node and a line connecting them, then centers
    /// the camera on the route.
    ///
    /// NOTE ON MAPSUI VERSIONS: this uses the Mapsui.Nts (NetTopologySuite) feature/geometry API
    /// and SphericalMercator.FromLonLat for WGS84 -> Web Mercator conversion, which has been the
    /// stable pattern across Mapsui 4.x. If the installed Mapsui.Maui package resolves to a
    /// different major version and a method name here has shifted, this is the one method in the
    /// project most likely to need a small adjustment — the routing/data logic elsewhere doesn't
    /// depend on Mapsui at all.
    /// </summary>
    private void DrawRoute(RouteResponse route)
    {
        var map = MapView.Map;
        if (map is null) return;

        // Remove any previous route/markers before drawing the new one.
        var previousLayers = map.Layers.Where(l => l.Name is MarkerLayerName or RouteLayerName).ToList();
        foreach (var previousLayer in previousLayers)
        {
            map.Layers.Remove(previousLayer);
        }

        if (route.Nodes.Count == 0) return;

        // --- Markers: one per node, start/end colored differently from waypoints ---
        var markerFeatures = new List<IFeature>();
        for (var i = 0; i < route.Nodes.Count; i++)
        {
            var node = route.Nodes[i];
            var isEndpoint = i == 0 || i == route.Nodes.Count - 1;
            var color = i == 0
                ? new Color(46, 125, 50)   // start: green
                : i == route.Nodes.Count - 1
                    ? new Color(198, 40, 40) // end: red
                    : new Color(25, 118, 210); // waypoint: blue

            var point = SphericalMercator.FromLonLat(node.Longitude, node.Latitude).ToMPoint();
            var feature = new PointFeature(point)
            {
                Styles = new List<IStyle>
                {
                    new SymbolStyle
                    {
                        SymbolScale = isEndpoint ? 0.9 : 0.6,
                        Fill = new Brush(color),
                        Outline = new Pen(Color.White, 2),
                    },
                },
            };
            markerFeatures.Add(feature);
        }

        var markerLayer = new MemoryLayer
        {
            Name = MarkerLayerName,
            Features = markerFeatures,
            IsMapInfoLayer = true,
        };

        // --- Route line connecting the nodes in walking order ---
        var coordinates = route.Nodes
            .Select(n =>
            {
                var (x, y) = SphericalMercator.FromLonLat(n.Longitude, n.Latitude);
                return new Coordinate(x, y);
            })
            .ToArray();

        var lineString = new LineString(coordinates);
        var routeFeature = new GeometryFeature(lineString)
        {
            Styles = new List<IStyle>
            {
                new VectorStyle
                {
                    Line = new Pen(new Color(25, 118, 210), 5),
                },
            },
        };

        var routeLayer = new MemoryLayer
        {
            Name = RouteLayerName,
            Features = new List<IFeature> { routeFeature },
        };

        map.Layers.Add(routeLayer);
        map.Layers.Add(markerLayer);

        if (routeLayer.Extent is { } extent)
        {
            // Grow the box a bit so markers at the edges aren't clipped by the viewport.
            map.Navigator.ZoomToBox(extent.Grow(extent.Width * 0.25 + 50));
        }
    }

    private void ShowStatus(string message)
    {
        StatusLabel.Text = message;
        StatusLabel.IsVisible = true;
    }

    private void HideStatus()
    {
        StatusLabel.IsVisible = false;
    }

    private void SetBusy(bool busy)
    {
        LoadingIndicator.IsRunning = busy;
        LoadingIndicator.IsVisible = busy;
        SetControlsEnabled(!busy);
    }

    private void SetControlsEnabled(bool enabled)
    {
        GetRouteButton.IsEnabled = enabled;
        StartPicker.IsEnabled = enabled;
        EndPicker.IsEnabled = enabled;
    }
}
