using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.ViewModels;

public enum NavigationState { Idle, Preview, Active, Arrived }

public sealed record RouteStepRow(string Glyph, string Text, string DistanceText);

/// <summary>
/// Route preview and active turn-by-turn navigation. Owned by <see cref="CampusMapViewModel"/>, which hands it the
/// route the backend calculated. No MAUI types here, so the whole flow is unit-tested with fakes.
///
///   Idle ──ShowPreview──▶ Preview ──Start──▶ Active ──arrive──▶ Arrived
///     ▲                      │                  │                   │
///     └──────────────────────┴──End/Cancel──────┴───────────────────┘
///
/// While Active the view model listens to location updates (and ONLY then — the subscription and the high-accuracy
/// update profile are dropped on end/arrival/page hide). There are no timers.
/// </summary>
public partial class CampusNavigationViewModel : ObservableObject
{
    private readonly ICampusApi _api;
    private readonly ILocationProvider _location;
    private readonly TimeProvider _time;

    private RouteProgressTracker? _tracker;
    private RerouteGate? _gate;
    private string? _campusId;
    private CampusRouteTo? _target;
    private CampusRouteOptions? _options;
    private bool _subscribed;
    private bool _messageIsRerouteProblem;
    private LocationFix? _lastFix;

    public CampusNavigationViewModel(ICampusApi api, ILocationProvider location, TimeProvider? time = null)
    {
        _api = api;
        _location = location;
        _time = time ?? TimeProvider.System;
    }

    // ---- state ----------------------------------------------------------------------------------------

    [ObservableProperty, NotifyPropertyChangedFor(nameof(IsIdle), nameof(IsPreview), nameof(IsActive), nameof(IsArrived), nameof(IsNavigating), nameof(ShowGuidance))]
    private NavigationState _state = NavigationState.Idle;

    [ObservableProperty] private RouteModel? _route;
    [ObservableProperty] private RouteProgress? _progress;

    // preview
    [ObservableProperty] private string _destinationTitle = "";
    [ObservableProperty] private string? _destinationSubtitle;
    [ObservableProperty] private string _previewSummary = "";
    /// <summary>Where the route starts, in words ("Your location" or the chosen starting point). Set by the map when it asks for a route.</summary>
    [ObservableProperty] private string _originLabel = "Your location";
    /// <summary>The only mode UNIVAST can route today (the campus walking graph). Never a made-up mode.</summary>
    public string ModeLabel => "Walking";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasStartHint))] private string? _startHint;
    [ObservableProperty] private bool _canStart;

    // guidance
    [ObservableProperty] private string _currentInstruction = "";
    [ObservableProperty] private string _currentGlyph = "";
    [ObservableProperty] private string _distanceToNextText = "";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasNextInstruction))] private string? _nextInstruction;
    [ObservableProperty] private string _remainingDistanceText = "";
    [ObservableProperty] private string _remainingTimeText = "";
    [ObservableProperty] private string _arrivalTimeText = "";
    [ObservableProperty] private string? _indoorGuidance;

    // status
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasNavMessage))] private string? _navMessage;
    [ObservableProperty] private bool _isRerouting;
    [ObservableProperty] private bool _followUser = true;

    public ObservableCollection<RouteStepRow> PreviewSteps { get; } = new();

    public bool IsIdle => State == NavigationState.Idle;
    public bool IsPreview => State == NavigationState.Preview;
    public bool IsActive => State == NavigationState.Active;
    public bool IsArrived => State == NavigationState.Arrived;
    /// <summary>Anything other than normal map browsing: the destination sheet and search give way to navigation UI.</summary>
    public bool IsNavigating => State != NavigationState.Idle;
    public bool ShowGuidance => State is NavigationState.Active or NavigationState.Arrived;
    public bool HasStartHint => !string.IsNullOrEmpty(StartHint);
    public bool HasNextInstruction => !string.IsNullOrEmpty(NextInstruction);
    public bool HasNavMessage => !string.IsNullOrEmpty(NavMessage);

    /// <summary>The route line / markers changed (or were removed): the map should redraw them.</summary>
    public event EventHandler? RouteChanged;
    public event EventHandler<CameraRequest>? CameraRequested;
    /// <summary>Navigation finished or was cancelled; the owner returns to normal map mode.</summary>
    public event EventHandler? Ended;

    // ---- preview ---------------------------------------------------------------------------------------

    public void ShowPreview(RouteModel route, string campusId, CampusRouteTo target, CampusRouteOptions? options)
    {
        // A new preview replaces anything in progress. A running navigation is ended properly (location stopped,
        // owner told) rather than silently orphaned.
        if (State is NavigationState.Active or NavigationState.Arrived) EndNavigation();
        Detach();

        _campusId = campusId;
        _target = target;
        _options = options;
        _tracker = null;
        _gate = null;
        _lastFix = null;
        Route = route;
        Progress = null;
        State = NavigationState.Preview;
        NavMessage = null;
        FollowUser = true;
        IndoorGuidance = route.IndoorDescription;

        DestinationTitle = route.DestinationTitle;
        DestinationSubtitle = route.DestinationSubtitle;
        PreviewSummary = $"{NavigationFormat.Duration(route.TotalDurationSeconds)} · {NavigationFormat.Distance(route.TotalDistanceMeters)}";
        CanStart = route.CanNavigate;
        StartHint = route.CanNavigate ? null : "Step-by-step guidance isn't available for this route. You can still use the steps below as a guide.";

        PreviewSteps.Clear();
        foreach (var step in route.Steps)
        {
            PreviewSteps.Add(new RouteStepRow(step.Glyph, step.Text, step.DistanceMeters > 0 ? NavigationFormat.Distance(step.DistanceMeters) : ""));
        }

        RouteChanged?.Invoke(this, EventArgs.Empty);
        if (route.Bounds is { } bounds) CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Route, Bounds: bounds));
    }

    // ---- start / follow ----------------------------------------------------------------------------------

    public async Task StartAsync(LocationFix? currentFix, LocationAvailability availability)
    {
        if (State != NavigationState.Preview || Route is null || !Route.CanNavigate) return;

        // Following a route needs the real device position. Without it we stay in preview (the steps remain a guide).
        if (currentFix is not { IsValid: true })
        {
            SetMessage(availability switch
            {
                LocationAvailability.PermissionDenied or LocationAvailability.PermissionRestricted =>
                    "Turn on location for UNIVAST to follow the route. You can still use the steps as a guide.",
                LocationAvailability.ServicesDisabled => "Location services are off. Turn them on to follow the route.",
                _ => "We can't find your location yet. Try again in a moment.",
            }, isRerouteProblem: false);
            return;
        }

        _tracker = new RouteProgressTracker(Route);
        _gate = new RerouteGate(Route.Settings, _time);
        NavMessage = null;
        FollowUser = true;
        State = NavigationState.Active;

        Attach();
        ApplyProgress(_tracker.Update(currentFix));
        RouteChanged?.Invoke(this, EventArgs.Empty);
        await _location.StartListeningAsync(LocationUpdateProfile.Navigation);
        RequestFollow(currentFix);
    }

    /// <summary>The page came back to the foreground: restore the high-frequency updates (only while actively navigating).</summary>
    public async Task ResumeAsync()
    {
        if (State != NavigationState.Active) return;
        Attach();
        await _location.StartListeningAsync(LocationUpdateProfile.Navigation);
    }

    private void Attach()
    {
        if (_subscribed) return;
        _location.LocationChanged += OnLocationChanged;
        _subscribed = true;
    }

    private void Detach()
    {
        if (!_subscribed) return;
        _location.LocationChanged -= OnLocationChanged;
        _subscribed = false;
    }

    private void OnLocationChanged(object? sender, LocationFix fix)
    {
        if (State != NavigationState.Active || _tracker is null || _gate is null || Route is null || !fix.IsValid) return;
        _lastFix = fix;

        var progress = _tracker.Update(fix);
        ApplyProgress(progress);

        if (progress.HasArrived)
        {
            Arrive();
            return;
        }

        if (FollowUser) RequestFollow(fix);

        // Back on the line: an old "connection unavailable" notice no longer applies.
        if (_messageIsRerouteProblem && progress.DeviationMeters <= Route.Settings.RerouteDeviationMeters) NavMessage = null;

        if (_gate.ShouldReroute(progress, fix)) _ = RerouteAsync(fix, _gate);
    }

    private void RequestFollow(LocationFix fix) =>
        CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Follow, fix.Latitude, fix.Longitude));

    // ---- progress -> display ------------------------------------------------------------------------------

    private void ApplyProgress(RouteProgress progress)
    {
        if (Route is null) return;
        Progress = progress;

        var steps = Route.Steps;
        var index = Math.Clamp(progress.UpcomingStepIndex, 0, steps.Count - 1);
        var step = steps[index];

        CurrentInstruction = step.Text;
        CurrentGlyph = step.Glyph;
        DistanceToNextText = progress.DistanceToUpcomingStepMeters < 10 ? "Now" : "In " + NavigationFormat.Distance(progress.DistanceToUpcomingStepMeters);
        NextInstruction = index + 1 < steps.Count ? steps[index + 1].Text : null;

        RemainingDistanceText = NavigationFormat.Distance(progress.RemainingMeters);
        RemainingTimeText = NavigationFormat.Duration(progress.RemainingSeconds);
        // Rounded UP to the next whole minute, like the durations: better early than late.
        var eta = _time.GetLocalNow().AddSeconds(progress.RemainingSeconds);
        var floored = eta.AddTicks(-(eta.Ticks % TimeSpan.TicksPerMinute));
        if (floored < eta) floored = floored.AddMinutes(1);
        ArrivalTimeText = floored.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    private void Arrive()
    {
        Detach();
        _location.StopListening();
        State = NavigationState.Arrived;
        CurrentGlyph = NavigationFormat.ManeuverGlyph("arrive");
        CurrentInstruction = $"You have arrived at {Route?.DestinationTitle}.";
        DistanceToNextText = "";
        NextInstruction = null;
        RemainingDistanceText = NavigationFormat.Distance(0);
        RemainingTimeText = "";
        ArrivalTimeText = "";
        NavMessage = null;
        // Indoor guidance only says where the room is — it is never presented as an indoor route.
        IndoorGuidance = Route?.IndoorDescription;
        RouteChanged?.Invoke(this, EventArgs.Empty);
    }

    // ---- rerouting -----------------------------------------------------------------------------------------

    private async Task RerouteAsync(LocationFix fix, RerouteGate gate)
    {
        if (_campusId is null || _target is null) { gate.Completed(false); return; }

        var success = false;
        IsRerouting = true;
        try
        {
            var response = await _api.RouteAsync(
                _campusId,
                new CampusRouteFrom { Latitude = fix.Latitude, Longitude = fix.Longitude, AccuracyMeters = fix.AccuracyMeters, Source = "device" },
                _target,
                _options);

            if (State != NavigationState.Active) return; // ended while the request was in flight

            switch (response.Status)
            {
                case CampusRouteResponseDto.Ok:
                    var model = RouteModel.From(response);
                    if (!model.CanNavigate)
                    {
                        SetMessage("Couldn't update the route. Continuing with the current route.", isRerouteProblem: true);
                        break;
                    }
                    Route = model;
                    _tracker = new RouteProgressTracker(model);
                    _gate = new RerouteGate(model.Settings, _time, gate.LastRequestAt); // the minimum interval survives the route swap
                    DestinationTitle = model.DestinationTitle;
                    DestinationSubtitle = model.DestinationSubtitle;
                    IndoorGuidance = model.IndoorDescription;
                    ApplyProgress(_tracker.Update(fix));
                    SetMessage("Route updated.", isRerouteProblem: false);
                    RouteChanged?.Invoke(this, EventArgs.Empty);
                    success = true;
                    break;
                case CampusRouteResponseDto.AwayFromCampus:
                    SetMessage("You're outside this campus. Continuing with the current route.", isRerouteProblem: true);
                    break;
                case CampusRouteResponseDto.StartTooFarFromPaths:
                    SetMessage("You're too far from a mapped path to update the route. Continuing with the current route.", isRerouteProblem: true);
                    break;
                default:
                    SetMessage("Couldn't update the route. Continuing with the current route.", isRerouteProblem: true);
                    break;
            }
        }
        catch (Exception ex)
        {
            if (State == NavigationState.Active) SetMessage(RerouteFailureMessage(ex), isRerouteProblem: true);
        }
        finally
        {
            IsRerouting = false;
            gate.Completed(success);
        }
    }

    public static string RerouteFailureMessage(Exception ex) => ex switch
    {
        HttpRequestException or TimeoutException or OperationCanceledException => "Connection unavailable. Continuing with the current route.",
        UnivastApiException { StatusCode: 422 } => "We couldn't find a new route from here. Continuing with the current route.",
        UnivastApiException { StatusCode: >= 500 } => "The UNIVAST server had a problem. Continuing with the current route.",
        _ => "Couldn't update the route. Continuing with the current route.",
    };

    private void SetMessage(string message, bool isRerouteProblem)
    {
        NavMessage = message;
        _messageIsRerouteProblem = isRerouteProblem;
    }

    // ---- commands ---------------------------------------------------------------------------------------------

    /// <summary>"End navigation" (or "Cancel" in preview / "Done" on arrival): back to normal map mode, selection untouched.</summary>
    [RelayCommand]
    public void EndNavigation()
    {
        if (State == NavigationState.Idle) return;

        var wasFollowing = State is NavigationState.Active or NavigationState.Arrived;
        Detach();
        if (wasFollowing) _location.StopListening(); // the owner restores light browsing updates in response to Ended

        _tracker = null;
        _gate = null;
        _lastFix = null;
        Route = null;
        Progress = null;
        State = NavigationState.Idle;
        NavMessage = null;
        IsRerouting = false;
        CurrentInstruction = "";
        NextInstruction = null;
        IndoorGuidance = null;
        PreviewSteps.Clear();

        RouteChanged?.Invoke(this, EventArgs.Empty);
        Ended?.Invoke(this, EventArgs.Empty);
    }

    [RelayCommand]
    public void ToggleFollow()
    {
        FollowUser = !FollowUser;
        if (FollowUser && _lastFix is { } fix) RequestFollow(fix);
    }

    [RelayCommand]
    public void ShowOverview()
    {
        FollowUser = false;
        if (Route?.Bounds is { } bounds) CameraRequested?.Invoke(this, new CameraRequest(CameraTarget.Route, Bounds: bounds));
    }
}
