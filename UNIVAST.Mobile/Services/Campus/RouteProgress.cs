namespace UNIVAST.Mobile.Services;

/// <summary>Where the user is along a route. Pure data; produced by <see cref="RouteProgressTracker"/>.</summary>
public sealed record RouteProgress(
    double ProgressMeters,
    double RemainingMeters,
    double RemainingSeconds,
    double DeviationMeters,
    int UpcomingStepIndex,
    double DistanceToUpcomingStepMeters,
    bool HasArrived);

/// <summary>
/// Follows a user along a route: projects each real location fix onto the route line, measures how far off the line the
/// user is, and works out the upcoming maneuver and what remains. No timers, no I/O — just geometry.
///
/// Progress never moves backwards (GPS jitter must not make a completed instruction reappear); if the user really goes
/// astray the deviation grows and the reroute logic takes over with a fresh route (a new tracker).
/// </summary>
public sealed class RouteProgressTracker
{
    /// <summary>
    /// An instruction stays on screen until the user is this far PAST its point ("Turn left" must not disappear the moment
    /// you reach the corner). Deliberately small: smaller than typical GPS error, so it only prevents flicker.
    /// </summary>
    private const double StepPassedMarginMeters = 5;

    private readonly RouteModel _route;
    private double _maxProgress;

    public RouteProgressTracker(RouteModel route) => _route = route;

    /// <summary>Progress before any fix has been received: at the start of the route.</summary>
    public RouteProgress Initial => Build(0, 0);

    public RouteProgress Update(LocationFix fix)
    {
        var geometry = _route.Geometry;
        if (!fix.IsValid || geometry.Count < 2 || _route.GeometryLengthMeters <= 0) return Build(_maxProgress, 0);

        var here = new GeoPoint(fix.Latitude, fix.Longitude);
        var bestDistance = double.PositiveInfinity;
        var bestAlong = 0.0;

        for (var i = 0; i < geometry.Count - 1; i++)
        {
            var (distance, t) = GeoMath.ProjectOntoSegment(here, geometry[i], geometry[i + 1]);
            var segmentLength = _route.CumulativeMeters[i + 1] - _route.CumulativeMeters[i];
            var along = _route.CumulativeMeters[i] + t * segmentLength;

            // Closest segment wins; on a tie (e.g. at a junction) prefer the one further along the route.
            if (distance < bestDistance - 1e-6 || (Math.Abs(distance - bestDistance) <= 1e-6 && along > bestAlong))
            {
                bestDistance = distance;
                bestAlong = along;
            }
        }

        var progress = bestAlong / _route.GeometryLengthMeters * _route.TotalDistanceMeters;
        _maxProgress = Math.Max(_maxProgress, progress);
        return Build(_maxProgress, bestDistance);
    }

    private RouteProgress Build(double progress, double deviation)
    {
        var remaining = Math.Max(0, _route.TotalDistanceMeters - progress);
        var seconds = remaining / _route.Settings.WalkingSpeedMetersPerSecond;

        var steps = _route.Steps;
        var upcoming = steps.Count - 1;
        for (var i = 0; i < steps.Count; i++)
        {
            if (steps[i].ProgressMeters + StepPassedMarginMeters > progress) { upcoming = i; break; }
        }
        var toStep = steps.Count == 0 ? 0 : Math.Max(0, steps[upcoming].ProgressMeters - progress);

        return new RouteProgress(progress, remaining, seconds, deviation, Math.Max(0, upcoming), toStep, remaining <= _route.Settings.ArrivalRadiusMeters);
    }
}

/// <summary>
/// Decides WHEN to ask the backend for a new route. Rerouting on every GPS update would hammer the server and make the
/// line flicker, so a reroute needs all of:
///   - the user is further than the campus's reroute-deviation distance from the line, on several consecutive fixes
///     (hysteresis against a single bad fix),
///   - the fix is accurate enough to tell (accuracy no worse than that distance),
///   - at least the campus's minimum interval has passed since the last request (a failed attempt counts, so an
///     unavailable network is not retried every second),
///   - no reroute request is already in flight.
/// </summary>
public sealed class RerouteGate
{
    /// <summary>Consecutive off-route fixes required (the only client-side constant; the distance/interval come from the backend).</summary>
    public const int RequiredConsecutiveFixes = 3;

    private readonly NavigationSettings _settings;
    private readonly TimeProvider _time;
    private int _consecutive;
    private DateTimeOffset? _lastRequest;
    private bool _inFlight;

    /// <param name="lastRequestAt">When the previous reroute was requested, so the minimum interval also holds across a route swap.</param>
    public RerouteGate(NavigationSettings settings, TimeProvider time, DateTimeOffset? lastRequestAt = null)
    {
        _settings = settings;
        _time = time;
        _lastRequest = lastRequestAt;
    }

    public DateTimeOffset? LastRequestAt => _lastRequest;

    public int ConsecutiveOffRouteFixes => _consecutive;

    /// <summary>Feed every fix. Returns true when a reroute should be requested now (and marks it in flight).</summary>
    public bool ShouldReroute(RouteProgress progress, LocationFix fix)
    {
        var threshold = _settings.RerouteDeviationMeters;

        if (fix.AccuracyMeters is double accuracy && accuracy > threshold)
        {
            // Too imprecise to say whether the user is really off route: neither count it nor forgive earlier fixes.
            return false;
        }

        if (progress.DeviationMeters > threshold) _consecutive++;
        else _consecutive = 0;

        if (_consecutive < RequiredConsecutiveFixes || _inFlight) return false;
        var now = _time.GetUtcNow();
        if (_lastRequest is DateTimeOffset last && (now - last).TotalSeconds < _settings.RerouteMinIntervalSeconds) return false;

        _inFlight = true;
        _lastRequest = now;
        return true;
    }

    /// <summary>Call when the reroute attempt has finished, successfully or not.</summary>
    public void Completed(bool success)
    {
        _inFlight = false;
        if (success) _consecutive = 0;
    }
}
