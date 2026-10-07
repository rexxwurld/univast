using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.ViewModels;

/// <summary>
/// The map itself is ALWAYS usable: these states only describe the optional campus layer. There is deliberately
/// no "choose a campus first" or "no campuses" state.
/// </summary>
public enum HomeState
{
    /// <summary>The map is shown (normal map, or a campus that finished loading).</summary>
    Ready,
    /// <summary>A campus the user opened is loading; the map stays usable meanwhile.</summary>
    LoadingCampus,
    /// <summary>The campus the user opened could not be loaded (inline message; the map stays usable).</summary>
    CampusFailed,
}

/// <summary>
/// Which campus context the map is in. Independent of active navigation (see <c>Navigation</c>):
/// None = normal map; Nearby = the device is near a known campus (a dismissible suggestion, nothing opened);
/// Viewing = a campus is open (possibly remotely); CheckedIn = the user checked in while really on that campus.
/// </summary>
public enum CampusContext { None, Nearby, Viewing, CheckedIn }

public enum SearchStatus { Idle, Searching, Results, Empty, Failed }

public enum CameraTarget
{
    Campus,
    User,
    Point,
    /// <summary>Keep the user centred while navigating (pan only, zoom unchanged).</summary>
    Follow,
    /// <summary>Show the whole route.</summary>
    Route,
}

/// <summary>A request from the view model to the map view. The view never moves the camera on its own.</summary>
public sealed record CameraRequest(CameraTarget Target, double? Latitude = null, double? Longitude = null, double? Zoom = null, GeoBounds? Bounds = null);

/// <summary>
/// State and behaviour of the map-first homepage: a normal interactive map with an optional campus layer. No MAUI types are used here, so it is unit-tested
/// with fakes. Data comes only from the Phase 2 API (ICampusApi); location only from ILocationProvider.
/// </summary>
public partial class CampusMapViewModel : ObservableObject
{
    private readonly ICampusApi _api;
    private readonly ILocationProvider _location;
    private readonly TimeProvider _time;
    private readonly IPlaceSearchApi? _places;
    private readonly CampusPackManager? _packs;
    private readonly SearchCache _searchCache;

    private CancellationTokenSource? _searchCts;
    private CancellationTokenSource? _destinationCts;
    private bool _promptedForLocation;
    private DateTimeOffset _lastLocateAt = DateTimeOffset.MinValue;
    private bool _locating;
    private bool _detectingNearby;
    private bool _liveStarted;
    private readonly HashSet<string> _dismissedNearby = new();
    private readonly Dictionary<string, CampusLocateResultDto> _locateResults = new();
    private DateTimeOffset _locateResultsAt = DateTimeOffset.MinValue;
    private static readonly TimeSpan LocateResultReuse = TimeSpan.FromSeconds(10);

    /// <summary>Re-checks "on/near/away" at most this often while location updates stream in.</summary>
    public TimeSpan LocateThrottle { get; set; } = TimeSpan.FromSeconds(30);
    public TimeSpan SearchDebounce { get; set; } = TimeSpan.FromMilliseconds(350);

    public CampusMapViewModel(ICampusApi api, ILocationProvider location, TimeProvider? time = null, IPlaceSearchApi? places = null, CampusPackManager? packs = null)
    {
        _api = api;
        _location = location;
        _time = time ?? TimeProvider.System;
        _places = places;
        _packs = packs;
        _searchCache = new SearchCache(_time);

        Navigation = new CampusNavigationViewModel(api, location, _time);
        Navigation.CameraRequested += (_, request) => CameraRequested?.Invoke(this, request);
        Navigation.RouteChanged += (_, _) => MapContentChanged?.Invoke(this, EventArgs.Empty);
        Navigation.Ended += (_, _) => { _liveStarted = false; _ = StartLiveLocationAsync(); }; // back to light, battery-friendly updates
        Navigation.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(CampusNavigationViewModel.State))
            {
                OnPropertyChanged(nameof(ShowDestinationSheet));
                OnPropertyChanged(nameof(ShowBrowseOverlays));
            }
        };
        _location.LocationChanged += OnLocationChanged;
        PickerChoices.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasNoPickerChoices));
    }

    // ---- observable state -----------------------------------------------------------------------

    [ObservableProperty, NotifyPropertyChangedFor(nameof(IsLoading), nameof(IsError), nameof(IsReady), nameof(ShowBrowseOverlays))]
    private HomeState _state = HomeState.Ready;

    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasError))] private string? _errorMessage;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(CampusLabel), nameof(HasCampus), nameof(Context), nameof(CanCheckIn), nameof(IsCheckedIn), nameof(HasNearbySuggestion), nameof(ContextLabel), nameof(ShowCampusRow), nameof(ShowNearbySuggestion), nameof(ShowNavigateButton), nameof(ShowNavigateUnavailable))] private CampusSummaryDto? _campus;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(PresenceIsPositive), nameof(PresenceDetailVisible), nameof(CanCheckIn))] private CampusPresenceState _presence = new(CampusPresence.Unknown, "Finding your location…", null);
    [ObservableProperty] private LocationAvailability _locationAvailability = LocationAvailability.Unavailable;
    [ObservableProperty] private LocationFix? _userFix;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasLocationMessage))] private string? _locationMessage;
    [ObservableProperty] private bool _canOpenLocationSettings;

    [ObservableProperty] private bool _isCampusPickerOpen;

    // map-first context ---------------------------------------------------------------------------
    /// <summary>Campuses the device is inside/near right now (geofence answers from the backend). A suggestion only.</summary>
    [ObservableProperty, NotifyPropertyChangedFor(nameof(Context), nameof(HasNearbySuggestion), nameof(NearbySuggestionText), nameof(ContextLabel), nameof(ShowNearbySuggestion))]
    private IReadOnlyList<CampusSummaryDto> _nearbyCandidates = Array.Empty<CampusSummaryDto>();
    /// <summary>The user explicitly checked into the open campus while really on it.</summary>
    [ObservableProperty, NotifyPropertyChangedFor(nameof(Context), nameof(CanCheckIn), nameof(IsCheckedIn), nameof(ContextLabel))]
    private string? _checkedInCampusId;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasNotice))] private string? _notice;
    /// <summary>The campuses offered by the picker (all of them, or only those near the user).</summary>
    public ObservableCollection<CampusSummaryDto> PickerChoices { get; } = new();
    [ObservableProperty, NotifyPropertyChangedFor(nameof(CampusLabel))] private string _universityName = "";

    [ObservableProperty] private List<CampusBuildingDto> _buildings = new();
    [ObservableProperty] private List<CampusLandmarkDto> _landmarks = new();
    [ObservableProperty] private bool _isOfflineMode;
    [ObservableProperty] private List<CampusEntranceDto> _visibleEntrances = new();
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasMapEmptyMessage))] private string? _mapEmptyMessage;
    [ObservableProperty] private string? _selectedMapItemId;

    // search
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ShowPresenceBanner), nameof(ShowCampusRow), nameof(ShowNearbySuggestion))] private bool _isSearchOpen;
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(IsSearching), nameof(ShowSearchResults), nameof(ShowSearchEmpty), nameof(ShowSearchFailed), nameof(ShowSearchHint), nameof(ShowAmbiguityHint), nameof(ShowExplore))] private SearchStatus _searchStatus = SearchStatus.Idle;
    [ObservableProperty] private string? _searchMessage;
    [ObservableProperty] private IReadOnlyList<SearchSection> _searchSections = Array.Empty<SearchSection>();
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ShowAmbiguityHint))] private bool _searchAmbiguous;

    // destination sheet
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasDestination), nameof(DestinationAliasesText), nameof(HasDestinationAliases), nameof(DestinationFactsText), nameof(HasDestinationFacts), nameof(DestinationSubtitleVisible), nameof(DestinationTrail), nameof(HasDestinationTrail), nameof(ShowDestinationSheet), nameof(IsGeneralPlace), nameof(IsCampusDestination), nameof(DestinationSourceLabel), nameof(DestinationSourceHint), nameof(HasDestinationSourceHint), nameof(DestinationCoordinatesText), nameof(HasDestinationCoordinates), nameof(ShowNavigateButton), nameof(ShowNavigateUnavailable), nameof(NavigateUnavailableText), nameof(ShowOpenInMapsApp))] private DestinationDetail? _destination;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(ShowNavigateUnavailable))] private bool _isLoadingDestination;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasDestinationError))] private string? _destinationError;

    // navigation hand-off
    [ObservableProperty] private bool _isRouting;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasRouteMessage))] private string? _routeMessage;
    [ObservableProperty] private bool _needsStartPoint;
    [ObservableProperty] private List<CampusLandmarkDto> _startPointOptions = new();

    /// <summary>Route preview and turn-by-turn guidance.</summary>
    public CampusNavigationViewModel Navigation { get; }

    public ObservableCollection<CampusSummaryDto> CampusChoices { get; } = new();
    public ObservableCollection<string> RouteSteps { get; } = new();

    public bool IsLoading => State == HomeState.LoadingCampus;
    public bool IsError => State == HomeState.CampusFailed;
    public bool IsReady => State == HomeState.Ready;
    public bool HasCampus => Campus is not null;
    /// <summary>The campus chip row shows only while a campus is open and search isn't covering the top of the screen.</summary>
    public bool ShowCampusRow => HasCampus && !IsSearchOpen;
    public bool ShowNearbySuggestion => HasNearbySuggestion && !IsSearchOpen;
    public bool HasNoPickerChoices => PickerChoices.Count == 0;
    public bool HasNotice => !string.IsNullOrEmpty(Notice);
    public bool IsCheckedIn => Campus is not null && CheckedInCampusId == Campus.Id;
    /// <summary>Check-in needs the backend to say the device really is inside the open campus.</summary>
    public bool CanCheckIn => Campus is not null && !IsCheckedIn && Presence.Presence == CampusPresence.OnCampus;
    public bool HasNearbySuggestion => NearbyCandidates.Count > 0 && (Campus is not { } open || !NearbyCandidates.Any(c => c.Id == open.Id));
    public string NearbySuggestionText => NearbyCandidates.Count switch
    {
        0 => "",
        1 => $"You're near {NearbyCandidates[0].Name}",
        var n => $"{n} campuses are near you",
    };
    public CampusContext Context => IsCheckedIn ? CampusContext.CheckedIn
        : Campus is not null ? CampusContext.Viewing
        : NearbyCandidates.Count > 0 ? CampusContext.Nearby
        : CampusContext.None;
    /// <summary>Short label for the campus chip: viewing vs checked in.</summary>
    public string ContextLabel => Context switch
    {
        CampusContext.CheckedIn => "Checked in",
        CampusContext.Viewing => "Viewing",
        _ => "",
    };
    public bool HasDestination => Destination is not null;
    /// <summary>The destination sheet gives way to the route preview / navigation panels.</summary>
    public bool ShowDestinationSheet => HasDestination && !Navigation.IsNavigating;
    /// <summary>Search, campus chip and presence banner are hidden while a route is shown or followed.</summary>
    public bool ShowBrowseOverlays => !Navigation.IsNavigating;
    public bool ShowPresenceBanner => !IsSearchOpen;
    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);
    public bool HasLocationMessage => !string.IsNullOrEmpty(LocationMessage);
    public bool HasMapEmptyMessage => !string.IsNullOrEmpty(MapEmptyMessage);
    public bool HasDestinationError => !string.IsNullOrEmpty(DestinationError);
    public bool HasRouteMessage => !string.IsNullOrEmpty(RouteMessage);
    public bool IsSearching => SearchStatus == SearchStatus.Searching;
    public bool ShowSearchResults => SearchStatus == SearchStatus.Results;
    public bool ShowSearchEmpty => SearchStatus == SearchStatus.Empty;
    public bool ShowSearchFailed => SearchStatus == SearchStatus.Failed;
    public bool ShowSearchHint => SearchStatus == SearchStatus.Idle;
    /// <summary>The backend found several different places with the same name (e.g. "LT1" in two buildings).</summary>
    public bool ShowAmbiguityHint => SearchAmbiguous && SearchStatus == SearchStatus.Results;
    /// <summary>University › Campus › Building › Floor for the open destination.</summary>
    // A general map place has no campus hierarchy, even while a campus happens to be open.
    public string DestinationTrail => IsGeneralPlace ? "" : DestinationHierarchy.Trail(UniversityName, Campus?.Name, Destination);
    public bool HasDestinationTrail => DestinationTrail.Length > 0;
    public bool PresenceDetailVisible => !string.IsNullOrEmpty(Presence.Detail);
    /// <summary>True when the device is really on/near the open campus (drawn with the success tint; everything else stays neutral).</summary>
    public bool PresenceIsPositive => Presence.Presence is CampusPresence.OnCampus or CampusPresence.NearCampus;
    /// <summary>The destination is a general map place (geocoder), not UNIVAST campus data.</summary>
    public bool IsGeneralPlace => Destination is { Id: var id } && id.StartsWith("osm:", StringComparison.Ordinal);
    public bool IsCampusDestination => Destination is { Kind: DestinationKind.Building or DestinationKind.Room or DestinationKind.Landmark };
    /// <summary>Where the information comes from, so a general place is never mistaken for verified campus data.</summary>
    public string DestinationSourceLabel => Destination is null ? ""
        : IsGeneralPlace ? "Map place"
        : IsCampusDestination ? "UNIVAST campus"
        : "UNIVAST place";
    public string DestinationSourceHint => Destination is null ? ""
        : IsGeneralPlace ? "From the map search. UNIVAST has no campus details for this place."
        : "";
    public bool HasDestinationSourceHint => DestinationSourceHint.Length > 0;
    public string DestinationCoordinatesText => Destination is { Latitude: double lat, Longitude: double lng } && IsGeneralPlace
        ? $"{lat:0.00000}, {lng:0.00000}" : "";
    public bool HasDestinationCoordinates => DestinationCoordinatesText.Length > 0;
    /// <summary>Directions button: only where a real route is possible. Otherwise an honest reason is shown instead.</summary>
    public bool ShowNavigateButton => Campus is not null && Destination is { CanNavigate: true };
    public bool ShowNavigateUnavailable => Destination is not null && !ShowNavigateButton && !IsLoadingDestination;
    public string NavigateUnavailableText => Destination is null ? ""
        : IsGeneralPlace ? DestinationBuilder.GeneralDirectionsUnavailable
        : Destination.CannotNavigateReason ?? DestinationBuilder.GeneralDirectionsUnavailable;
    /// <summary>The phone's own maps app can give directions to a general place; UNIVAST does not pretend to.</summary>
    public bool ShowOpenInMapsApp => IsGeneralPlace && Destination is { Latitude: not null, Longitude: not null };
    /// <summary>Real campuses from the directory, offered when search opens with nothing typed.</summary>
    public IReadOnlyList<CampusSummaryDto> ExploreCampuses => CampusChoices.Take(5).ToList();
    public bool ShowExplore => SearchStatus == SearchStatus.Idle && CampusChoices.Count > 0;
    public bool DestinationSubtitleVisible => !string.IsNullOrEmpty(Destination?.Subtitle);
    public bool HasDestinationAliases => Destination is { Aliases.Count: > 0 };
    public string DestinationAliasesText => Destination is { Aliases.Count: > 0 } d ? "Also known as " + string.Join(", ", d.Aliases) : "";
    public bool HasDestinationFacts => !string.IsNullOrEmpty(DestinationFactsText);
    public string DestinationFactsText
    {
        get
        {
            if (Destination is null) return "";
            var lines = new List<string>();
            if (Destination.FloorCount is int n) lines.Add(n == 1 ? "1 floor" : $"{n} floors");
            if (Destination.NotableRooms.Count > 0) lines.Add("Lecture halls: " + string.Join(", ", Destination.NotableRooms));
            if (!string.IsNullOrWhiteSpace(Destination.Description)) lines.Add(Destination.Description!);
            return string.Join("\n", lines);
        }
    }
    public string CampusLabel => Campus is null ? "" : string.IsNullOrWhiteSpace(UniversityName) ? Campus.Name : $"{UniversityName} · {Campus.Name}";

    public event EventHandler<CameraRequest>? CameraRequested;
    /// <summary>The user chose an existing UNIVAST place/business result; the page opens its detail screen.</summary>
    public event EventHandler<string>? PlaceRequested;
    /// <summary>Raised when markers (buildings/landmarks/entrances) or the selection changed and the map should redraw.</summary>
    public event EventHandler? MapContentChanged;
    /// <summary>Raised when the user's dot moved or disappeared.</summary>
    public event EventHandler? UserLocationChanged;

    // ---- start-up: the MAP first; campuses are an optional layer ------------------------------------

    /// <summary>
    /// Opens the normal map immediately — no campus is selected, loaded or required. In the background it finds
    /// the device location (shown as the blue dot, camera moves there once), loads the campus directory (used
    /// for campus search hits and the "near you" suggestion) and checks whether the device is near a known campus.
    /// Every one of those is allowed to fail without blocking the map.
    /// </summary>
    [RelayCommand]
    public async Task InitializeAsync()
    {
        State = HomeState.Ready;
        ErrorMessage = null;
        IsCampusPickerOpen = false;

        var locationTask = AcquireLocationAsync(requestPermission: true);
        await LoadCampusDirectoryAsync();
        await locationTask;

        // Normal map: show where the user is. A campus the user already opened is never pulled away from.
        if (Campus is null && UserFix is { IsValid: true } fix)
            CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.User, fix.Latitude, fix.Longitude, Zoom: 15));

        if (Campus is null) await DetectNearbyCampusesAsync();
        await StartLiveLocationAsync();
    }

    /// <summary>Loads the campus directory from the API, or from installed offline packs. Never blocks or throws.</summary>
    private async Task LoadCampusDirectoryAsync()
    {
        List<CampusSummaryDto> campuses;
        try
        {
            campuses = (await _api.GetCampusesAsync()).Where(c => c.IsValid).ToList();
        }
        catch
        {
            // Not an error for the map: the normal map and general search keep working without the campus directory.
            campuses = _packs?.GetInstalledCampuses() ?? new List<CampusSummaryDto>();
        }

        CampusChoices.Clear();
        foreach (var c in campuses) CampusChoices.Add(c);
        OnPropertyChanged(nameof(ExploreCampuses));
        OnPropertyChanged(nameof(ShowExplore));
    }

    /// <summary>
    /// Another screen (a place that belongs to a campus) asks the map to show that campus: it is opened for viewing —
    /// never checked into — and the camera goes to the place if it has real coordinates.
    /// </summary>
    public async Task ViewCampusAsync(string campusId, double? latitude, double? longitude)
    {
        if (CampusChoices.Count == 0) await LoadCampusDirectoryAsync();
        var campus = CampusChoices.FirstOrDefault(c => string.Equals(c.Id, campusId, StringComparison.Ordinal));
        if (campus is null)
        {
            Notice = "That campus isn't available to open right now.";
            return;
        }

        if (!string.Equals(Campus?.Id, campus.Id, StringComparison.Ordinal))
            await OpenCampusAsync(campus, Task.CompletedTask, RecentLocateResult(campus.Id));

        if (latitude is double lat && longitude is double lng && lat != 0 && lng != 0)
            CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Point, lat, lng));
    }

    /// <summary>
    /// Asks the backend whether the device is inside/near any campus with a configured boundary. The answer is
    /// only a SUGGESTION (<see cref="NearbyCandidates"/>): nothing is opened, and the user can dismiss it.
    /// </summary>
    private async Task DetectNearbyCampusesAsync()
    {
        if (UserFix is not { IsValid: true } fix || _detectingNearby) return;
        var candidates = CampusChoices.Where(c => c.GeofenceConfigured && !_dismissedNearby.Contains(c.Id)).ToList();
        if (candidates.Count == 0)
        {
            NearbyCandidates = Array.Empty<CampusSummaryDto>();
            return;
        }

        _detectingNearby = true;
        try
        {
            var checks = candidates.Select(async c =>
            {
                try { return (c, Result: (CampusLocateResultDto?)await _api.LocateAsync(c.Id, fix.Latitude, fix.Longitude, fix.AccuracyMeters)); }
                catch { return (c, Result: (CampusLocateResultDto?)null); }
            });
            var answers = await Task.WhenAll(checks);

            var answered = answers.Where(a => a.Result is not null).ToList();
            if (answered.Count == 0) return; // couldn't ask (offline): keep whatever suggestion we had

            foreach (var (c, result) in answered) _locateResults[c.Id] = result!;
            _locateResultsAt = _time.GetUtcNow();
            _lastLocateAt = _locateResultsAt;

            // Only real geofence answers count; "the only campus available" is NOT a reason to suggest a far-away campus.
            var inside = answered.Where(a => a.Result!.Status == CampusLocateResultDto.Inside).Select(a => a.c).ToList();
            var near = answered.Where(a => a.Result!.Status == CampusLocateResultDto.Near).Select(a => a.c).ToList();
            NearbyCandidates = inside.Count > 0 ? inside : near;
        }
        finally { _detectingNearby = false; }
    }

    [RelayCommand]
    public Task RetryAsync() => Campus is not null && State == HomeState.CampusFailed
        ? OpenCampusAsync(Campus, Task.CompletedTask)
        : InitializeAsync();

    /// <summary>Open a campus (remotely or on site). Same path for the picker, search hits and the nearby suggestion.</summary>
    [RelayCommand]
    public Task ChooseCampusAsync(CampusSummaryDto campus) =>
        OpenCampusAsync(campus, Task.CompletedTask, RecentLocateResult(campus.Id));

    private CampusLocateResultDto? RecentLocateResult(string campusId) =>
        _locateResults.TryGetValue(campusId, out var known) && _time.GetUtcNow() - _locateResultsAt <= LocateResultReuse ? known : null;

    [RelayCommand]
    public void ShowCampusPicker()
    {
        PickerChoices.Clear();
        foreach (var c in CampusChoices) PickerChoices.Add(c);
        IsCampusPickerOpen = true;
    }

    [RelayCommand]
    public void HideCampusPicker() => IsCampusPickerOpen = false;

    /// <summary>The "near you" banner: one campus opens it; several open a picker limited to those campuses.</summary>
    [RelayCommand]
    public Task OpenNearbySuggestionAsync()
    {
        var candidates = NearbyCandidates;
        if (candidates.Count == 1) return ChooseCampusAsync(candidates[0]);
        if (candidates.Count > 1)
        {
            PickerChoices.Clear();
            foreach (var c in candidates) PickerChoices.Add(c);
            IsCampusPickerOpen = true;
        }
        return Task.CompletedTask;
    }

    /// <summary>The user doesn't want this suggestion; it won't come back during this session.</summary>
    [RelayCommand]
    public void DismissNearbySuggestion()
    {
        foreach (var c in NearbyCandidates) _dismissedNearby.Add(c.Id);
        NearbyCandidates = Array.Empty<CampusSummaryDto>();
    }

    [RelayCommand] public void DismissNotice() => Notice = null;

    /// <summary>Closes the inline "couldn't load the campus" message and returns to the normal map.</summary>
    [RelayCommand]
    public void DismissCampusError() => ExitCampus();

    /// <summary>
    /// Explicit check-in: needs a fresh answer from the backend that the device really is inside this campus.
    /// Viewing a campus remotely, or being near one, never checks in by itself.
    /// </summary>
    [RelayCommand]
    public async Task CheckInAsync()
    {
        if (Campus is null) return;
        Notice = null;
        if (UserFix is null) await AcquireLocationAsync(requestPermission: false);
        await EvaluatePresenceAsync();

        if (Presence.Presence != CampusPresence.OnCampus)
        {
            Notice = UserFix is null
                ? "Check-in needs your location. Turn it on, or keep exploring this campus without checking in."
                : "You can check in once you're on this campus. You can still explore and search it from here.";
            return;
        }
        CheckedInCampusId = Campus.Id;
    }

    /// <summary>
    /// Back to the normal map: drops the campus layer, any campus route, search state and check-in. Used by the
    /// "close campus" action, the error banner, and automatically when a checked-in user leaves the campus.
    /// </summary>
    [RelayCommand]
    public void ExitCampus()
    {
        Navigation.EndNavigation();
        _destinationCts?.Cancel();
        Campus = null;
        CheckedInCampusId = null;
        UniversityName = "";
        Buildings = new();
        Landmarks = new();
        VisibleEntrances = new();
        MapEmptyMessage = null;
        SelectedMapItemId = null;
        Destination = null;
        DestinationError = null;
        IsLoadingDestination = false;
        ResetRoute();
        ClearSearch();
        _searchCache.Clear();
        ErrorMessage = null;
        IsOfflineMode = false;
        Notice = null;
        Presence = new(CampusPresence.Unknown, "Finding your location…", null);
        State = HomeState.Ready;
        MapContentChanged?.Invoke(this, EventArgs.Empty);
        if (UserFix is { IsValid: true } fix)
            CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.User, fix.Latitude, fix.Longitude, Zoom: 15));
        _ = DetectNearbyCampusesAsync();
    }

    private async Task OpenCampusAsync(CampusSummaryDto campus, Task pendingLocation, CampusLocateResultDto? knownLocate = null)
    {
        Navigation.EndNavigation(); // a route belongs to one campus
        State = HomeState.LoadingCampus;
        ErrorMessage = null;
        Notice = null;
        IsOfflineMode = false;
        IsCampusPickerOpen = false;
        if (CheckedInCampusId is not null && CheckedInCampusId != campus.Id) CheckedInCampusId = null; // check-in belongs to one campus
        Campus = campus;
        UniversityName = campus.University?.Name ?? "";
        CloseDestination();
        ClearSearch();
        _searchCache.Clear(); // results belong to one campus only

        try
        {
            var buildingsTask = _api.GetBuildingsAsync(campus.Id);
            var landmarksTask = _api.GetLandmarksAsync(campus.Id);
            await Task.WhenAll(buildingsTask, landmarksTask);
            Buildings = (buildingsTask.Result ?? new()).Where(b => !string.IsNullOrWhiteSpace(b.Id) && !string.IsNullOrWhiteSpace(b.Name)).ToList();
            Landmarks = (landmarksTask.Result ?? new()).Where(l => !string.IsNullOrWhiteSpace(l.Id) && !string.IsNullOrWhiteSpace(l.Name)).ToList();
            IsOfflineMode = false;
            _ = SyncCampusPackAsync(campus.Id);
        }
        catch (Exception ex)
        {
            if (_packs is null || !_packs.TryLoadCampusData(campus.Id, out var buildings, out var landmarks))
            {
                ErrorMessage = CampusErrorMapper.ToUserMessage(ex, "load this campus");
                State = HomeState.CampusFailed;
                return;
            }

            Buildings = buildings.Where(building => !string.IsNullOrWhiteSpace(building.Id) && !string.IsNullOrWhiteSpace(building.Name)).ToList();
            Landmarks = landmarks.Where(landmark => !string.IsNullOrWhiteSpace(landmark.Id) && !string.IsNullOrWhiteSpace(landmark.Name)).ToList();
            IsOfflineMode = true;
        }

        MapEmptyMessage = Buildings.Count == 0 && Landmarks.Count == 0 ? "No campus locations found" : null;
        State = HomeState.Ready;
        VisibleEntrances = new();
        SelectedMapItemId = null;
        MapContentChanged?.Invoke(this, EventArgs.Empty);

        // A campus the user chose to open fits the campus — never an unrelated user location.
        CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Campus));

        await pendingLocation;
        await EvaluatePresenceAsync(knownLocate);
        await StartLiveLocationAsync();
    }

    // ---- location ------------------------------------------------------------------------------

    private async Task AcquireLocationAsync(bool requestPermission)
    {
        // Prompt at most once per session; later calls never show the system dialog.
        var allowPrompt = requestPermission && !_promptedForLocation;
        if (allowPrompt) _promptedForLocation = true;

        try
        {
            var result = await _location.GetCurrentAsync(allowPrompt);
            ApplyLocation(result);
        }
        catch
        {
            ApplyLocation(LocationResult.Without(LocationAvailability.Unavailable));
        }
    }

    private void ApplyLocation(LocationResult result)
    {
        LocationAvailability = result.Availability;
        UserFix = result.Fix is { IsValid: true } ? result.Fix : null;
        if (UserFix is null && result.Availability == LocationAvailability.Available) LocationAvailability = LocationAvailability.Unavailable;
        UserLocationChanged?.Invoke(this, EventArgs.Empty);
    }

    private async Task EvaluatePresenceAsync(CampusLocateResultDto? known = null)
    {
        if (Campus is null) return;
        if (UserFix is not { IsValid: true } fix)
        {
            Presence = CampusPresenceMapper.From(null, LocationAvailability);
            return;
        }

        if (known is null)
        {
            if (_locating) return;
            _locating = true;
            try
            {
                known = await _api.LocateAsync(Campus.Id, fix.Latitude, fix.Longitude, fix.AccuracyMeters);
                _lastLocateAt = _time.GetUtcNow();
            }
            catch
            {
                // Can't ask the backend (offline): say so honestly rather than guessing on/off campus.
                Presence = new(CampusPresence.Unknown, "Can't check whether you're on campus", "You can still explore and search this campus.");
                return;
            }
            finally { _locating = false; }
        }
        Presence = CampusPresenceMapper.From(known, LocationAvailability.Available);

        // Checked in, then the backend says the device is outside: leaving campus returns to the normal map.
        if (IsCheckedIn && Presence.Presence == CampusPresence.AwayFromCampus) ExitCampus();
    }

    private void OnLocationChanged(object? sender, LocationFix fix)
    {
        if (!fix.IsValid) return;
        UserFix = fix;
        LocationAvailability = LocationAvailability.Available;
        UserLocationChanged?.Invoke(this, EventArgs.Empty);
        // NOTE: the camera is deliberately NOT moved here — the user may be exploring the map.

        if (State == HomeState.Ready && !Navigation.IsNavigating && _time.GetUtcNow() - _lastLocateAt >= LocateThrottle)
        {
            if (Campus is not null) _ = EvaluatePresenceAsync();
            else _ = DetectNearbyCampusesAsync();
        }
    }

    public async Task OnPageAppearingAsync()
    {
        if (Navigation.IsActive)
        {
            await Navigation.ResumeAsync(); // high-frequency updates come back only while actually navigating
            return;
        }
        if (State == HomeState.Ready && LocationAvailability == LocationAvailability.Available)
        {
            await _location.StartListeningAsync();
            _liveStarted = true;
        }
    }

    public void OnPageDisappearing()
    {
        _liveStarted = false;
        _location.StopListening();
    }

    /// <summary>Begin live updates (only if permission was granted) — called once the map is ready.</summary>
    public async Task StartLiveLocationAsync()
    {
        // Already listening (start-up started it): opening/closing a campus must not restart or duplicate updates.
        if (_liveStarted || LocationAvailability != LocationAvailability.Available) return;
        await _location.StartListeningAsync();
        _liveStarted = true;
    }

    [RelayCommand]
    public async Task RecenterAsync()
    {
        LocationMessage = null;
        CanOpenLocationSettings = false;

        // While navigating, recentering means "follow me again".
        if (Navigation.IsActive && !Navigation.FollowUser) Navigation.ToggleFollow();

        if (UserFix is null)
        {
            // Never re-prompt: after the one start-up request, denied/blocked means "send them to Settings".
            if (LocationAvailability is LocationAvailability.PermissionDenied or LocationAvailability.PermissionRestricted && _promptedForLocation)
            {
                LocationMessage = "Location is turned off for UNIVAST. Turn it on in Settings to see where you are.";
                CanOpenLocationSettings = true;
                return;
            }
            await AcquireLocationAsync(requestPermission: true);
            if (UserFix is not null && Campus is not null) await EvaluatePresenceAsync();
        }

        if (UserFix is { } fix)
        {
            CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.User, fix.Latitude, fix.Longitude, Zoom: Campus is null ? 16 : null));
            return;
        }

        LocationMessage = LocationAvailability switch
        {
            LocationAvailability.PermissionDenied or LocationAvailability.PermissionRestricted =>
                "Location is turned off for UNIVAST. Turn it on in Settings to see where you are.",
            LocationAvailability.ServicesDisabled => "Location services are off. Turn them on to see where you are.",
            _ => "We can't find your location right now. Try again outside or near a window.",
        };
        CanOpenLocationSettings = LocationAvailability is LocationAvailability.PermissionDenied or LocationAvailability.PermissionRestricted or LocationAvailability.ServicesDisabled;
    }

    [RelayCommand] public void OpenLocationSettings() => _location.OpenSettings();

    /// <summary>"Start navigation" on the route preview.</summary>
    [RelayCommand]
    public Task StartNavigationAsync() => Navigation.StartAsync(UserFix, LocationAvailability);

    [RelayCommand]
    public void FitCampus()
    {
        if (Navigation.IsNavigating) { Navigation.ShowOverview(); return; } // during a route, "fit" shows the whole route
        CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Campus));
    }

    // ---- search --------------------------------------------------------------------------------

    [RelayCommand]
    public void OpenSearch() => IsSearchOpen = true;

    [RelayCommand]
    public void CloseSearch() => IsSearchOpen = false;

    public void ClearSearch()
    {
        _searchCts?.Cancel();
        SearchText = "";
        SearchSections = Array.Empty<SearchSection>();
        SearchAmbiguous = false;
        SearchStatus = SearchStatus.Idle;
        SearchMessage = null;
    }

    /// <summary>Immediate search (keyboard "Search" key / retry button): no debounce.</summary>
    public Task SearchNowAsync(string? text) => SearchAsync(text, immediate: true);

    /// <summary>
    /// Call whenever the search box text changes. The text is trimmed and whitespace-collapsed, typing is debounced,
    /// a newer search cancels the older one (an older response can never overwrite a newer one), identical recent
    /// searches are answered from a short-lived cache, and everything else — matching, aliases, ranking — is the backend's job.
    /// </summary>
    public async Task SearchAsync(string? text, bool immediate = false)
    {
        _searchCts?.Cancel();
        SearchText = text ?? "";
        var query = SearchQuery.Normalize(text);
        var campus = Campus;

        if (query.Length == 0)
        {
            SearchSections = Array.Empty<SearchSection>();
            SearchAmbiguous = false;
            SearchStatus = SearchStatus.Idle;
            SearchMessage = null;
            return;
        }

        var cts = _searchCts = new CancellationTokenSource();
        var key = campus is null
            ? "global|" + query.ToLowerInvariant()
            : SearchQuery.CacheKey(campus.Id, query);
        // A submitted search also asks for general map places; those results must not be served for plain typing, or vice versa.
        if (immediate) key += "|geo";

        if (_searchCache.TryGet(key, out var cached))
        {
            ShowSearchResponse(cached);
            return;
        }

        SearchStatus = SearchStatus.Searching;
        SearchMessage = null;

        try
        {
            if (!immediate && SearchDebounce > TimeSpan.Zero) await Task.Delay(SearchDebounce, cts.Token);

            CampusSearchResponseDto response;
            if (campus is null)
            {
                response = await _api.GlobalSearchAsync(query, 20, cts.Token, includeGeo: immediate, nearLatitude: UserFix?.Latitude, nearLongitude: UserFix?.Longitude);
            }
            else
            {
                // Campus search and the (optional) places search run in parallel; places can never fail the campus search.
                var campusTask = _api.SearchAsync(campus.Id, query, 20, cts.Token);
                var placesTask = SearchPlacesSafeAsync(campus, query, cts.Token);
                // A campus being open must not hide the rest of the world: other universities/campuses and (on a
                // submitted search) general map places come from the same backend search, after the campus hits.
                var extrasTask = SearchBeyondCampusSafeAsync(campus, query, immediate, cts.Token);
                var campusResponse = await campusTask;
                var places = await placesTask;
                var (extras, geoStatus) = await extrasTask;
                response = new CampusSearchResponseDto
                {
                    Query = campusResponse.Query,
                    Ambiguous = campusResponse.Ambiguous,
                    Category = campusResponse.Category,
                    Results = (campusResponse.Results ?? new List<CampusSearchResultDto>()).Concat(places).Concat(extras).ToList(),
                    Geo = geoStatus,
                };
            }

            // Ignore the answer if the user has typed something newer or switched campus meanwhile.
            if (cts.IsCancellationRequested || Campus?.Id != campus?.Id) return;

            IsOfflineMode = false;
            _searchCache.Set(key, response);
            ShowSearchResponse(response);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            // superseded by a newer keystroke
        }
        catch (Exception ex)
        {
            if (cts.IsCancellationRequested) return;
            var offline = campus is null ? null : _packs?.SearchOffline(campus.Id, query);
            if (offline is not null)
            {
                IsOfflineMode = true;
                ShowSearchResponse(offline);
                SearchMessage = offline.Results?.Count > 0 ? "Showing saved campus results while offline." : "No saved results match this search.";
                return;
            }
            SearchSections = Array.Empty<SearchSection>();
            SearchAmbiguous = false;
            SearchStatus = SearchStatus.Failed;
            SearchMessage = CampusErrorMapper.ToUserMessage(ex, "search");
        }
    }

    private async Task SyncCampusPackAsync(string campusId)
    {
        if (_packs is null) return;
        try
        {
            await _packs.EnsureInstalledAsync(campusId);
        }
        catch
        {
            // Online campus data remains usable when pack publication or download is unavailable.
        }
    }

    private void ShowSearchResponse(CampusSearchResponseDto response)
    {
        var sections = SearchResultGrouper.Group(response);
        SearchSections = sections;
        SearchAmbiguous = response.Ambiguous;
        if (sections.Count == 0)
        {
            SearchStatus = SearchStatus.Empty;
            SearchMessage = "Try a place, address, building, room number, landmark, or abbreviation.";
        }
        else
        {
            SearchStatus = SearchStatus.Results;
            SearchMessage = null;
        }

        // Be honest when general map places were asked for but could not be searched: no results then means
        // "not searched", not "nothing there".
        if (response.Geo is { Requested: true } geo && geo.Status != CampusSearchGeoDto.Ok)
        {
            SearchMessage = geo.Status == "disabled"
                ? "Searching general map places isn't turned on yet. Showing UNIVAST results only."
                : "Couldn't search general map places right now. Showing UNIVAST results only.";
        }
    }

    /// <summary>
    /// Other universities/campuses and general map places for a submitted search made while a campus is open. Never throws:
    /// the campus results must show even if this part fails.
    /// </summary>
    private async Task<(IReadOnlyList<CampusSearchResultDto> Results, CampusSearchGeoDto? Geo)> SearchBeyondCampusSafeAsync(CampusSummaryDto campus, string query, bool includeGeo, CancellationToken ct)
    {
        // Only for a submitted search: typing stays one light campus request per pause (and the geocoder must
        // never be asked per keystroke).
        if (!includeGeo) return (Array.Empty<CampusSearchResultDto>(), null);

        try
        {
            var global = await _api.GlobalSearchAsync(query, 20, ct, includeGeo, UserFix?.Latitude, UserFix?.Longitude);
            var results = (global.Results ?? new List<CampusSearchResultDto>())
                .Where(r => r.Kind == "geo"
                    || (r.Kind == "campus" && !string.Equals(r.Id, campus.Id, StringComparison.Ordinal))
                    || (r.Kind == "university" && !string.Equals(r.Id, campus.University?.Id, StringComparison.Ordinal)))
                .ToList();
            return (results, global.Geo);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            return (Array.Empty<CampusSearchResultDto>(), includeGeo ? new CampusSearchGeoDto { Requested = true, Status = "unavailable" } : null);
        }
    }

    private async Task<IReadOnlyList<CampusSearchResultDto>> SearchPlacesSafeAsync(CampusSummaryDto campus, string query, CancellationToken ct)
    {
        if (_places is null || query.Length < 2) return Array.Empty<CampusSearchResultDto>();
        try
        {
            return await _places.SearchAsync(campus.Latitude, campus.Longitude, query, ct);
        }
        catch (Exception)
        {
            // Places/businesses are a bonus section: if they can't be reached, campus results still show.
            return Array.Empty<CampusSearchResultDto>();
        }
    }

    // ---- selecting destinations ----------------------------------------------------------------

    /// <summary>User tapped a search result: close search, move the camera, show the sheet. Never starts navigation.</summary>
    [RelayCommand]
    public async Task SelectSearchResultAsync(CampusSearchResultDto result)
    {
        IsSearchOpen = false;

        // A general map place (from the geocoder): show it on the map as-is. It is not campus data, so it never
        // switches campus and never claims directions that UNIVAST cannot really provide.
        if (result.Kind == "geo")
        {
            ShowDestination(DestinationBuilder.FromSearchResult(result), focus: true);
            return;
        }

        // An existing UNIVAST place/business: not a campus destination — open its own detail screen.
        if (result.Kind == "place")
        {
            PlaceRequested?.Invoke(this, result.Id);
            return;
        }

        var targetCampus = FindCampusForGlobalResult(result);
        if (targetCampus is not null && !string.Equals(Campus?.Id, targetCampus.Id, StringComparison.Ordinal))
        {
            // Viewing a campus remotely is a normal thing to do: no check-in, no need to be anywhere near it.
            await OpenCampusAsync(targetCampus, Task.CompletedTask, RecentLocateResult(targetCampus.Id));
        }

        // A university or campus hit opens that campus. If it isn't in the directory we can load, say so.
        if (result.Kind is "university" or "campus")
        {
            if (targetCampus is null)
                Notice = "That campus isn't available to open right now. Check your connection and try again.";
            return;
        }

        var quick = DestinationBuilder.FromSearchResult(result);
        ShowDestination(quick, focus: true);

        // Only ask the open campus for details of a result that belongs to it.
        if (Campus is not null && (result.CampusId is null || string.Equals(result.CampusId, Campus.Id, StringComparison.Ordinal)))
            await LoadDestinationDetailAsync(result.Kind, result.Id, quick);

        // The search hit had no coordinates: use the ones the detail record resolved (a room's building, say) —
        // never made-up ones. If there are none, say so instead of leaving the map unmoved without explanation.
        if (quick.Latitude is null || quick.Longitude is null)
        {
            if (Destination is { Latitude: double lat, Longitude: double lng } resolved && resolved.Id == quick.Id)
                CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Point, lat, lng));
            else if (DestinationError is null && Destination is not null)
                DestinationError = "We don't have a map position for this place yet.";
        }
    }

    private CampusSummaryDto? FindCampusForGlobalResult(CampusSearchResultDto result)
    {
        var campusId = result.CampusId ?? result.SourceCampusId;
        if (result.Kind == "campus") campusId = result.Id;
        if (!string.IsNullOrWhiteSpace(campusId))
        {
            var match = CampusChoices.FirstOrDefault(c => string.Equals(c.Id, campusId, StringComparison.Ordinal));
            if (match is not null) return match;
            // Not in the directory: only the campus that is already open can stand in for it, never a different one.
            return string.Equals(Campus?.Id, campusId, StringComparison.Ordinal) ? Campus : null;
        }

        if (!string.IsNullOrWhiteSpace(result.UniversityId))
        {
            return CampusChoices.FirstOrDefault(c =>
                string.Equals(c.University?.Id, result.UniversityId, StringComparison.Ordinal));
        }

        return Campus;
    }

    /// <summary>Map marker tap. kind: "building" | "landmark" | "entrance".</summary>
    public async Task SelectMapItemAsync(string kind, string id)
    {
        if (kind == "entrance")
        {
            var building = Buildings.FirstOrDefault(b => b.Entrances?.Any(e => e.Id == id) == true);
            if (building is null) return;
            kind = "building";
            id = building.Id;
        }

        if (kind == "building")
        {
            var b = Buildings.FirstOrDefault(x => x.Id == id);
            if (b is null) return;
            ShowDestination(DestinationBuilder.FromBuilding(b), focus: true);
            await LoadDestinationDetailAsync("building", id, Destination!);
        }
        else if (kind == "landmark")
        {
            var l = Landmarks.FirstOrDefault(x => x.Id == id);
            if (l is null) return;
            ShowDestination(DestinationBuilder.FromLandmark(l), focus: true);
        }
    }

    private void ShowDestination(DestinationDetail detail, bool focus)
    {
        ResetRoute();
        DestinationError = null;
        Destination = detail;
        SelectedMapItemId = detail.Kind == DestinationKind.Room ? detail.BuildingId : detail.Id;

        // Only the selected building's doors are drawn — keeps the map uncluttered.
        var buildingId = detail.Kind == DestinationKind.Building ? detail.Id : detail.BuildingId;
        VisibleEntrances = buildingId is null
            ? new()
            : (Buildings.FirstOrDefault(b => b.Id == buildingId)?.Entrances ?? new()).ToList();
        MapContentChanged?.Invoke(this, EventArgs.Empty);

        if (focus && detail.Latitude is double lat && detail.Longitude is double lng)
            CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Point, lat, lng));
    }

    private async Task LoadDestinationDetailAsync(string kind, string id, DestinationDetail current)
    {
        if (Campus is null) return;
        _destinationCts?.Cancel();
        var cts = _destinationCts = new CancellationTokenSource();

        try
        {
            switch (kind)
            {
                case "room":
                    IsLoadingDestination = true;
                    var room = await _api.GetRoomAsync(Campus.Id, id, cts.Token);
                    if (cts.IsCancellationRequested) return;
                    ApplyDetail(DestinationBuilder.FromRoom(room));
                    break;
                case "building":
                    IsLoadingDestination = true;
                    var detail = await _api.GetBuildingAsync(Campus.Id, id, cts.Token);
                    if (cts.IsCancellationRequested) return;
                    ApplyDetail(DestinationBuilder.FromBuilding(detail, detail));
                    break;
                case "landmark":
                    var landmark = Landmarks.FirstOrDefault(l => l.Id == id);
                    if (landmark is not null) ApplyDetail(DestinationBuilder.FromLandmark(landmark));
                    break;
            }
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested) { }
        catch (Exception ex)
        {
            if (!cts.IsCancellationRequested)
                DestinationError = CampusErrorMapper.ToUserMessage(ex, "load the details");
        }
        finally
        {
            if (!cts.IsCancellationRequested) IsLoadingDestination = false;
        }

        void ApplyDetail(DestinationDetail detail)
        {
            // Keep what the user already sees if the richer record lacks coordinates.
            Destination = detail with { Latitude = detail.Latitude ?? current.Latitude, Longitude = detail.Longitude ?? current.Longitude };
            SelectedMapItemId = Destination.Kind == DestinationKind.Room ? Destination.BuildingId : Destination.Id;
        }
    }

    [RelayCommand]
    public void CloseDestination()
    {
        if (Navigation.IsPreview) Navigation.EndNavigation();
        _destinationCts?.Cancel();
        Destination = null;
        DestinationError = null;
        IsLoadingDestination = false;
        SelectedMapItemId = null;
        VisibleEntrances = new();
        ResetRoute();
        MapContentChanged?.Invoke(this, EventArgs.Empty);
    }

    // ---- navigate from here (hand-off to Phase 2 routing) ---------------------------------------

    private void ResetRoute()
    {
        if (Navigation.IsPreview) Navigation.EndNavigation(); // a preview belongs to the destination that produced it
        RouteMessage = null;
        NeedsStartPoint = false;
        StartPointOptions = new();
        RouteSteps.Clear();
    }

    [RelayCommand]
    public async Task NavigateFromHereAsync()
    {
        if (Destination is null) return;
        ResetRoute();
        if (Campus is null)
        {
            // A general map place: UNIVAST has no general routing provider, so say so rather than guess a route.
            RouteMessage = Destination.CannotNavigateReason ?? DestinationBuilder.GeneralDirectionsUnavailable;
            return;
        }

        // Use the freshest real fix; try once more (without prompting) if we don't have one.
        if (UserFix is null) await AcquireLocationAsync(requestPermission: false);

        var plan = NavigationHandoff.Plan(Destination, UserFix, LocationAvailability);
        switch (plan.Kind)
        {
            case HandoffKind.NotRoutable:
                RouteMessage = plan.Message;
                return;
            case HandoffKind.NeedsStartPoint:
                RouteMessage = plan.Message;
                StartPointOptions = Landmarks.Where(l => !string.IsNullOrWhiteSpace(l.NavigationNodeId)).ToList();
                NeedsStartPoint = true;
                if (StartPointOptions.Count == 0) RouteMessage += " No starting points are available for this campus yet.";
                return;
            default:
                await RequestRouteAsync(new CampusRouteFrom
                {
                    Latitude = UserFix!.Latitude,
                    Longitude = UserFix.Longitude,
                    AccuracyMeters = UserFix.AccuracyMeters,
                }, plan.Target!);
                break;
        }
    }

    [RelayCommand]
    public async Task NavigateFromLandmarkAsync(CampusLandmarkDto start)
    {
        if (Destination is null) return;
        var target = NavigationHandoff.TargetFor(Destination);
        if (target is null) { RouteMessage = Destination.CannotNavigateReason ?? "Directions to this place aren't available yet."; return; }
        NeedsStartPoint = false;
        await RequestRouteAsync(new CampusRouteFrom { LandmarkId = start.Id }, target);
    }

    private string OriginLabelFor(CampusRouteFrom start)
    {
        if (!string.IsNullOrWhiteSpace(start.LandmarkId))
            return Landmarks.FirstOrDefault(l => l.Id == start.LandmarkId)?.Name ?? "Chosen starting point";
        if (!string.IsNullOrWhiteSpace(start.EntranceId)) return "Chosen entrance";
        return start.Source == "map" ? "Chosen point on the map" : "Your location";
    }

    private async Task RequestRouteAsync(CampusRouteFrom start, CampusRouteTo target)
    {
        if (Campus is null) return;
        IsRouting = true;
        RouteSteps.Clear();
        RouteMessage = null;
        try
        {
            var route = await _api.RouteAsync(Campus.Id, start, target);
            switch (route.Status)
            {
                case CampusRouteResponseDto.Ok:
                    var model = RouteModel.From(route);
                    RouteMessage = route.DistanceMeters is null
                        ? "Route ready"
                        : $"Walking route · about {NavigationFormat.Distance(model.TotalDistanceMeters)} · {NavigationFormat.Duration(model.TotalDurationSeconds)}";
                    foreach (var step in model.Steps) RouteSteps.Add(step.Text);
                    // Preview first: nothing starts until the user taps "Start navigation".
                    Navigation.ShowPreview(model, Campus.Id, target, options: null);
                    Navigation.OriginLabel = OriginLabelFor(start);
                    break;
                case CampusRouteResponseDto.AwayFromCampus:
                    // Honest: we do not draw a route from a position that is not on campus.
                    RouteMessage = string.IsNullOrWhiteSpace(route.Message)
                        ? "You're away from this campus. Choose a starting point on campus to get walking directions."
                        : route.Message;
                    StartPointOptions = Landmarks.Where(l => !string.IsNullOrWhiteSpace(l.NavigationNodeId)).ToList();
                    NeedsStartPoint = StartPointOptions.Count > 0;
                    break;
                case CampusRouteResponseDto.StartTooFarFromPaths:
                    RouteMessage = string.IsNullOrWhiteSpace(route.Message)
                        ? "No walking path was found near you. Choose a starting point on campus."
                        : route.Message;
                    StartPointOptions = Landmarks.Where(l => !string.IsNullOrWhiteSpace(l.NavigationNodeId)).ToList();
                    NeedsStartPoint = StartPointOptions.Count > 0;
                    break;
                default:
                    RouteMessage = "We couldn't work out a route. Please try again.";
                    break;
            }
        }
        catch (Exception ex)
        {
            RouteMessage = ex is UnivastApiException { StatusCode: 422, Code: null } api && !string.IsNullOrWhiteSpace(api.Message)
                ? api.Message // an older backend's own user-safe wording
                : CampusErrorMapper.ToRouteMessage(ex);
        }
        finally
        {
            IsRouting = false;
        }
    }
}
