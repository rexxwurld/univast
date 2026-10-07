using System.Text.Json;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;
using UNIVAST.Mobile.ViewModels;

namespace UNIVAST.Mobile.Tests;

// ======================================================================================================================
// DTO parsing
// ======================================================================================================================
public class RouteDtoTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Parses_the_full_phase_5_route_response()
    {
        const string json = """
        {"status":"ok","campus":{"id":"c1","name":"Main Campus"},
         "origin":{"kind":"device","latitude":0.0001,"longitude":0,"snapDistanceMeters":11},
         "distanceMeters":273,"durationSeconds":204,
         "geometry":{"type":"LineString","coordinates":[[0,0.0001],[0,0],[0.0009,0]]},
         "steps":[{"type":"turn","maneuver":"turn_left","text":"After about 100 m, turn left at Demo Junction.","distanceMeters":100,"durationSeconds":75,
                   "at":{"latitude":0,"longitude":0.0009},"geometryIndex":2,"distanceFromStartMeters":111.1,"landmark":"Demo Junction"},
                  {"type":"connector","maneuver":"take_stairs","text":"Take the stairs to the First Floor.","floor":"First Floor"}],
         "instructions":[{"type":"turn","text":"x","distanceMeters":100}],
         "destination":{"kind":"room","name":"LT1","building":{"id":"b","name":"Test Science Block"},"floor":{"id":"f","floorNumber":0,"name":"Ground Floor"},
                        "position":{"latitude":0.001,"longitude":0.0004},"indoor":{"routed":false,"description":"LT1 is on the Ground Floor."}},
         "metadata":{"walkingSpeedMetersPerSecond":1.34,"rerouteDeviationMeters":30,"rerouteMinIntervalSeconds":15,"arrivalRadiusMeters":15,
                     "graphVersion":"a1b2c3","accessibleOnly":false,"indoorRouting":"not_available"}}
        """;

        var route = JsonSerializer.Deserialize<CampusRouteResponseDto>(json, Web)!;

        Assert.Equal(204, route.DurationSeconds);
        Assert.Equal("device", route.Origin!.Kind);
        Assert.Equal(3, route.Geometry!.Coordinates!.Count);
        var turn = route.Steps![0];
        Assert.Equal("turn_left", turn.Maneuver);
        Assert.Equal(2, turn.GeometryIndex);
        Assert.Equal(111.1, turn.DistanceFromStartMeters);
        Assert.Equal("Demo Junction", turn.Landmark);
        Assert.Equal("First Floor", route.Steps[1].Floor);
        Assert.Equal("LT1 is on the Ground Floor.", route.Destination!.Indoor!.Description);
        Assert.Equal(30, route.Metadata!.RerouteDeviationMeters);
        Assert.Equal("a1b2c3", route.Metadata.GraphVersion);
    }

    [Fact]
    public void An_older_backend_response_without_phase_5_fields_still_parses()
    {
        var route = JsonSerializer.Deserialize<CampusRouteResponseDto>("""{"status":"ok","distanceMeters":10,"instructions":[{"type":"depart","text":"Go."}]}""", Web)!;
        Assert.Null(route.Geometry);
        Assert.Null(route.Steps);
        Assert.Null(route.Metadata);
        Assert.Single(route.Instructions!);
    }

    [Fact]
    public void Backend_error_codes_are_read_from_error_responses()
    {
        var ex = new UnivastApiException("No walking route exists", 422, "NO_ROUTE");
        Assert.Equal("NO_ROUTE", ex.Code);
        Assert.Null(new UnivastApiException("x", 500).Code);
    }
}

// ======================================================================================================================
// Formatting
// ======================================================================================================================
public class NavigationFormatTests
{
    [Theory]
    [InlineData(0.0, "0 m")]
    [InlineData(8.0, "8 m")]
    [InlineData(85.0, "85 m")]
    [InlineData(273.0, "275 m")]
    [InlineData(997.0, "995 m")]
    [InlineData(998.0, "1.0 km")]
    [InlineData(1234.0, "1.2 km")]
    [InlineData(12000.0, "12.0 km")]
    [InlineData(-5.0, "0 m")]
    [InlineData(double.NaN, "0 m")]
    public void Distance_uses_metres_then_kilometres_without_false_precision(double meters, string expected) =>
        Assert.Equal(expected, NavigationFormat.Distance(meters));

    [Theory]
    [InlineData(0.0, "Less than 1 min")]
    [InlineData(20.0, "1 min")]
    [InlineData(61.0, "2 min")]
    [InlineData(300.0, "5 min")]
    [InlineData(3600.0, "1 h")]
    [InlineData(3900.0, "1 h 5 min")]
    [InlineData(double.NaN, "Less than 1 min")]
    public void Duration_rounds_up_to_whole_minutes(double seconds, string expected) =>
        Assert.Equal(expected, NavigationFormat.Duration(seconds));

    [Fact]
    public void Every_backend_maneuver_has_a_glyph_and_unknown_ones_fall_back()
    {
        foreach (var m in new[] { "depart", "continue", "slight_left", "slight_right", "turn_left", "turn_right", "sharp_left", "sharp_right", "u_turn", "enter_building", "exit_building", "take_stairs", "take_ramp", "take_elevator", "arrive" })
            Assert.NotEqual("•", NavigationFormat.ManeuverGlyph(m));
        Assert.Equal("•", NavigationFormat.ManeuverGlyph("teleport"));
        Assert.Equal("•", NavigationFormat.ManeuverGlyph(null));
    }
}

// ======================================================================================================================
// Route model
// ======================================================================================================================
public class RouteModelTests
{
    [Fact]
    public void Reads_geometry_as_longitude_latitude_and_measures_it()
    {
        var model = RouteModel.From(RouteSample.Ok());

        Assert.Equal(3, model.Geometry.Count);
        Assert.Equal(new GeoPoint(0, RouteSample.P1Lng), model.Geometry[1]);
        Assert.InRange(model.GeometryLengthMeters, 199, 202);
        Assert.Equal(200, model.TotalDistanceMeters);
        Assert.Equal(100, model.TotalDurationSeconds);
        Assert.True(model.CanNavigate);
    }

    [Fact]
    public void Steps_get_their_position_along_the_route_from_the_backend_distance()
    {
        var model = RouteModel.From(RouteSample.Ok());
        Assert.Equal(new[] { 0.0, 100.0, 200.0, 200.0 }, model.Steps.Select(s => s.ProgressMeters).ToArray());
        Assert.Equal("turn_left", model.Steps[1].Maneuver);
        Assert.Equal("Junction", model.Steps[1].Landmark);
        Assert.Equal("←", model.Steps[1].Glyph);
    }

    [Fact]
    public void Falls_back_to_the_geometry_index_when_a_step_has_no_cumulative_distance()
    {
        var model = RouteModel.From(RouteSample.Ok(r => { foreach (var s in r.Steps!) s.DistanceFromStartMeters = null; }));
        Assert.True(model.CanNavigate);
        Assert.InRange(model.Steps[1].ProgressMeters, 99, 101); // index 1 is the corner, half way
        Assert.InRange(model.Steps[2].ProgressMeters, 199, 201);
    }

    [Fact]
    public void Steps_that_cannot_be_placed_make_the_route_preview_only()
    {
        var model = RouteModel.From(RouteSample.Ok(r => { r.Steps![1].DistanceFromStartMeters = null; r.Steps[1].GeometryIndex = null; }));
        Assert.False(model.CanNavigate);
        Assert.Equal(4, model.Steps.Count); // still listed
    }

    [Fact]
    public void A_legacy_response_with_only_instructions_is_listed_but_cannot_be_followed()
    {
        var model = RouteModel.From(new CampusRouteResponseDto
        {
            Status = "ok", DistanceMeters = 50,
            Instructions = new() { new() { Type = "depart", Text = "Walk from A toward B." }, new() { Type = "arrive", Text = "You have arrived at B." } },
        });

        Assert.False(model.CanNavigate);
        Assert.Equal(2, model.Steps.Count);
        Assert.Equal("depart", model.Steps[0].Maneuver);
        Assert.Equal("arrive", model.Steps[1].Maneuver);
        Assert.Equal(NavigationSettings.Fallback, model.Settings);
    }

    [Theory]
    [InlineData(200.0, 0.0)]
    [InlineData(0.0, 181.0)]
    public void A_single_invalid_coordinate_discards_the_whole_line(double lat, double lng)
    {
        var model = RouteModel.From(RouteSample.Ok(r => r.Geometry!.Coordinates![1] = new() { lng, lat }));
        Assert.Empty(model.Geometry);
        Assert.False(model.CanNavigate);
    }

    [Fact]
    public void Malformed_geometry_never_throws()
    {
        Assert.False(RouteModel.From(RouteSample.Ok(r => r.Geometry!.Coordinates![0] = new() { 1 })).CanNavigate);
        Assert.False(RouteModel.From(RouteSample.Ok(r => r.Geometry = null)).CanNavigate);
        Assert.False(RouteModel.From(new CampusRouteResponseDto { Status = "ok" }).CanNavigate);
    }

    [Fact]
    public void Settings_come_from_the_backend_metadata_and_fall_back_per_field()
    {
        var model = RouteModel.From(RouteSample.Ok(r => { r.Metadata!.RerouteDeviationMeters = 45; r.Metadata.ArrivalRadiusMeters = null; }));
        Assert.Equal(45, model.Settings.RerouteDeviationMeters);
        Assert.Equal(2, model.Settings.WalkingSpeedMetersPerSecond);
        Assert.Equal(NavigationSettings.Fallback.ArrivalRadiusMeters, model.Settings.ArrivalRadiusMeters);
    }

    [Fact]
    public void Destination_title_subtitle_position_and_indoor_description()
    {
        var model = RouteModel.From(RouteSample.Ok());
        Assert.Equal("Hall 1", model.DestinationTitle);
        Assert.Equal("Block One · Ground Floor", model.DestinationSubtitle);
        Assert.Equal(new GeoPoint(RouteSample.P2Lat, RouteSample.P1Lng), model.DestinationPosition);
        Assert.Equal("Hall 1 is on the Ground Floor.", model.IndoorDescription);
        Assert.Equal("abc123", model.GraphVersion);
    }

    [Fact]
    public void Bounds_cover_the_route()
    {
        var b = RouteModel.From(RouteSample.Ok()).Bounds!;
        Assert.Equal(0, b.MinLat);
        Assert.Equal(RouteSample.P2Lat, b.MaxLat);
        Assert.Equal(RouteSample.P1Lng, b.MaxLng);
    }
}

// ======================================================================================================================
// Progress tracking
// ======================================================================================================================
public class RouteProgressTrackerTests
{
    private static RouteProgressTracker Tracker(Action<CampusRouteResponseDto>? tweak = null) => new(RouteModel.From(RouteSample.Ok(tweak)));

    [Fact]
    public void At_the_start_nothing_is_done_and_the_first_instruction_is_shown()
    {
        var p = Tracker().Update(RouteSample.OnFirstLeg(0));
        Assert.InRange(p.ProgressMeters, 0, 1);
        Assert.InRange(p.RemainingMeters, 199, 200);
        Assert.Equal(0, p.UpcomingStepIndex);
        Assert.False(p.HasArrived);
    }

    [Fact]
    public void Remaining_distance_and_time_follow_the_users_progress()
    {
        var p = Tracker().Update(RouteSample.OnFirstLeg(50));
        Assert.InRange(p.ProgressMeters, 49, 51);
        Assert.InRange(p.RemainingMeters, 149, 151);
        Assert.InRange(p.RemainingSeconds, 74, 76); // 150 m at 2 m/s
        Assert.Equal(1, p.UpcomingStepIndex);       // the turn is next
        Assert.InRange(p.DistanceToUpcomingStepMeters, 49, 51);
    }

    [Fact]
    public void An_instruction_stays_until_the_user_is_a_few_metres_past_it()
    {
        var tracker = Tracker();
        Assert.Equal(1, tracker.Update(RouteSample.OnSecondLeg(0)).UpcomingStepIndex);  // standing on the corner: still "turn left"
        Assert.Equal(1, tracker.Update(RouteSample.OnSecondLeg(3)).UpcomingStepIndex);
        Assert.Equal(2, tracker.Update(RouteSample.OnSecondLeg(10)).UpcomingStepIndex); // clearly past it: the next one
    }

    [Fact]
    public void The_route_is_followed_around_the_corner()
    {
        var p = Tracker().Update(RouteSample.OnSecondLeg(50));
        Assert.InRange(p.ProgressMeters, 149, 152);
        Assert.InRange(p.RemainingMeters, 48, 51);
    }

    [Fact]
    public void Deviation_is_the_distance_from_the_route_line()
    {
        Assert.InRange(Tracker().Update(RouteSample.OnFirstLeg(60)).DeviationMeters, 0, 1);
        Assert.InRange(Tracker().Update(RouteSample.OffRoute(60, 25)).DeviationMeters, 24, 26);
    }

    [Fact]
    public void Progress_never_moves_backwards_on_gps_jitter()
    {
        var tracker = Tracker();
        var forward = tracker.Update(RouteSample.OnFirstLeg(80));
        var jitter = tracker.Update(RouteSample.OnFirstLeg(70));
        Assert.True(jitter.ProgressMeters >= forward.ProgressMeters);
        Assert.Equal(forward.UpcomingStepIndex, jitter.UpcomingStepIndex);
    }

    [Fact]
    public void Arrival_is_detected_within_the_campus_arrival_radius()
    {
        var tracker = Tracker();
        Assert.False(tracker.Update(RouteSample.OnSecondLeg(80)).HasArrived);   // ~20 m to go
        Assert.True(tracker.Update(RouteSample.OnSecondLeg(90)).HasArrived);    // ~10 m to go (radius 15)
    }

    [Fact]
    public void A_custom_arrival_radius_from_the_backend_is_respected()
    {
        var tracker = Tracker(r => r.Metadata!.ArrivalRadiusMeters = 40);
        Assert.True(tracker.Update(RouteSample.OnSecondLeg(65)).HasArrived);
    }

    [Fact]
    public void Invalid_fixes_leave_the_progress_unchanged()
    {
        var tracker = Tracker();
        var before = tracker.Update(RouteSample.OnFirstLeg(60));
        var after = tracker.Update(new LocationFix(double.NaN, 0, null, DateTimeOffset.UtcNow));
        Assert.Equal(before.ProgressMeters, after.ProgressMeters);
    }

    [Fact]
    public void A_route_without_geometry_does_not_crash_the_tracker()
    {
        var tracker = new RouteProgressTracker(RouteModel.From(new CampusRouteResponseDto { Status = "ok", DistanceMeters = 10 }));
        var p = tracker.Update(RouteSample.OnFirstLeg(5));
        Assert.Equal(0, p.ProgressMeters);
    }
}

// ======================================================================================================================
// Reroute policy
// ======================================================================================================================
public class RerouteGateTests
{
    private static readonly NavigationSettings Settings = new(2, 30, 15, 15);
    private static RouteProgress Off(double deviation) => new(50, 150, 75, deviation, 1, 50, false);
    private static LocationFix Fix(double accuracy = 5) => new(0, 0, accuracy, DateTimeOffset.UtcNow);

    [Fact]
    public void Being_on_the_route_never_triggers_a_reroute()
    {
        var gate = new RerouteGate(Settings, new FakeClock());
        for (var i = 0; i < 10; i++) Assert.False(gate.ShouldReroute(Off(5), Fix()));
    }

    [Fact]
    public void Several_consecutive_off_route_fixes_are_needed_not_one()
    {
        var gate = new RerouteGate(Settings, new FakeClock());
        Assert.False(gate.ShouldReroute(Off(60), Fix()));
        Assert.False(gate.ShouldReroute(Off(60), Fix()));
        Assert.True(gate.ShouldReroute(Off(60), Fix()));
    }

    [Fact]
    public void One_good_fix_resets_the_count()
    {
        var gate = new RerouteGate(Settings, new FakeClock());
        gate.ShouldReroute(Off(60), Fix());
        gate.ShouldReroute(Off(60), Fix());
        gate.ShouldReroute(Off(5), Fix());
        Assert.Equal(0, gate.ConsecutiveOffRouteFixes);
        Assert.False(gate.ShouldReroute(Off(60), Fix()));
    }

    [Fact]
    public void The_deviation_threshold_comes_from_the_campus_settings()
    {
        var strict = new RerouteGate(new NavigationSettings(2, 10, 15, 15), new FakeClock());
        var lenient = new RerouteGate(new NavigationSettings(2, 80, 15, 15), new FakeClock());
        var triggeredStrict = false;
        var triggeredLenient = false;
        for (var i = 0; i < 3; i++)
        {
            triggeredStrict |= strict.ShouldReroute(Off(40), Fix());
            triggeredLenient |= lenient.ShouldReroute(Off(40), Fix());
        }
        Assert.True(triggeredStrict);
        Assert.False(triggeredLenient);
    }

    [Fact]
    public void Imprecise_fixes_are_neither_counted_nor_allowed_to_reset_the_count()
    {
        var gate = new RerouteGate(Settings, new FakeClock());
        gate.ShouldReroute(Off(60), Fix());
        gate.ShouldReroute(Off(60), Fix());
        Assert.False(gate.ShouldReroute(Off(60), Fix(accuracy: 80)));   // can't tell -> ignored
        Assert.Equal(2, gate.ConsecutiveOffRouteFixes);
        Assert.True(gate.ShouldReroute(Off(60), Fix()));
    }

    [Fact]
    public void Requests_respect_the_minimum_interval_even_after_a_failure()
    {
        var clock = new FakeClock();
        var gate = new RerouteGate(Settings, clock);
        for (var i = 0; i < 2; i++) gate.ShouldReroute(Off(60), Fix());
        Assert.True(gate.ShouldReroute(Off(60), Fix()));
        gate.Completed(success: false);                                  // e.g. no network

        clock.Advance(TimeSpan.FromSeconds(5));
        Assert.False(gate.ShouldReroute(Off(60), Fix()));                // too soon: no request storm
        clock.Advance(TimeSpan.FromSeconds(11));
        Assert.True(gate.ShouldReroute(Off(60), Fix()));                 // 16 s since the last attempt
    }

    [Fact]
    public void Only_one_request_is_in_flight_at_a_time()
    {
        var clock = new FakeClock();
        var gate = new RerouteGate(Settings, clock);
        for (var i = 0; i < 2; i++) gate.ShouldReroute(Off(60), Fix());
        Assert.True(gate.ShouldReroute(Off(60), Fix()));
        clock.Advance(TimeSpan.FromMinutes(5));
        Assert.False(gate.ShouldReroute(Off(60), Fix()));                // still waiting for the first answer
        gate.Completed(success: false);
        Assert.True(gate.ShouldReroute(Off(60), Fix()));
    }

    [Fact]
    public void A_successful_reroute_clears_the_off_route_count()
    {
        var gate = new RerouteGate(Settings, new FakeClock());
        for (var i = 0; i < 3; i++) gate.ShouldReroute(Off(60), Fix());
        gate.Completed(success: true);
        Assert.Equal(0, gate.ConsecutiveOffRouteFixes);
    }
}

// ======================================================================================================================
// Navigation view model: preview, active guidance, rerouting, cancellation, lifecycle
// ======================================================================================================================
public class CampusNavigationViewModelTests
{
    private static (CampusNavigationViewModel Vm, FakeCampusApi Api, FakeLocationProvider Location, FakeClock Clock, List<CameraRequest> Cameras) Create()
    {
        var api = new FakeCampusApi();
        var location = new FakeLocationProvider();
        var clock = new FakeClock();
        var vm = new CampusNavigationViewModel(api, location, clock);
        var cameras = new List<CameraRequest>();
        vm.CameraRequested += (_, r) => cameras.Add(r);
        return (vm, api, location, clock, cameras);
    }

    private static readonly CampusRouteTo Target = new() { RoomId = "r1" };

    private static void Preview(CampusNavigationViewModel vm, Action<CampusRouteResponseDto>? tweak = null, CampusRouteOptions? options = null) =>
        vm.ShowPreview(RouteModel.From(RouteSample.Ok(tweak)), "c1", Target, options);

    private static async Task<(CampusNavigationViewModel Vm, FakeCampusApi Api, FakeLocationProvider Location, FakeClock Clock, List<CameraRequest> Cameras)> Started()
    {
        var ctx = Create();
        Preview(ctx.Vm);
        await ctx.Vm.StartAsync(RouteSample.OnFirstLeg(0), LocationAvailability.Available);
        return ctx;
    }

    // ---- preview -----------------------------------------------------------------------------------------------------

    [Fact]
    public void A_preview_shows_destination_time_distance_and_the_directions_without_starting_anything()
    {
        var (vm, _, location, _, cameras) = Create();

        Preview(vm);

        Assert.Equal(NavigationState.Preview, vm.State);
        Assert.True(vm.IsPreview);
        Assert.Equal("Hall 1", vm.DestinationTitle);
        Assert.Equal("Block One · Ground Floor", vm.DestinationSubtitle);
        Assert.Equal("2 min · 200 m", vm.PreviewSummary);
        Assert.True(vm.CanStart);
        Assert.Equal(4, vm.PreviewSteps.Count);
        Assert.Equal("100 m", vm.PreviewSteps[1].DistanceText);
        Assert.Equal("Hall 1 is on the Ground Floor.", vm.IndoorGuidance);
        // Nothing runs until "Start navigation": no location subscription, no high-accuracy updates.
        Assert.Equal(0, location.Subscribers);
        Assert.Equal(0, location.Starts);
        // The whole route is shown.
        Assert.Contains(cameras, c => c.Target == CameraTarget.Route && c.Bounds is not null);
    }

    [Fact]
    public void A_legacy_route_can_be_previewed_but_not_started()
    {
        var (vm, _, location, _, _) = Create();
        vm.ShowPreview(RouteModel.From(new CampusRouteResponseDto { Status = "ok", DistanceMeters = 80, Instructions = new() { new() { Type = "depart", Text = "Go." } } }), "c1", Target, null);

        Assert.False(vm.CanStart);
        Assert.True(vm.HasStartHint);
        Assert.Single(vm.PreviewSteps);
    }

    [Fact]
    public async Task Starting_a_legacy_route_does_nothing()
    {
        var (vm, _, location, _, _) = Create();
        vm.ShowPreview(RouteModel.From(new CampusRouteResponseDto { Status = "ok", DistanceMeters = 80 }), "c1", Target, null);

        await vm.StartAsync(RouteSample.OnFirstLeg(0), LocationAvailability.Available);

        Assert.Equal(NavigationState.Preview, vm.State);
        Assert.Equal(0, location.Subscribers);
    }

    // ---- starting ------------------------------------------------------------------------------------------------------

    [Theory]
    [InlineData(LocationAvailability.PermissionDenied, "Turn on location")]
    [InlineData(LocationAvailability.PermissionRestricted, "Turn on location")]
    [InlineData(LocationAvailability.ServicesDisabled, "Location services are off")]
    [InlineData(LocationAvailability.Unavailable, "can't find your location")]
    public async Task Without_a_real_location_the_preview_stays_and_says_why(LocationAvailability why, string expected)
    {
        var (vm, _, location, _, _) = Create();
        Preview(vm);

        await vm.StartAsync(null, why);

        Assert.Equal(NavigationState.Preview, vm.State);
        Assert.Contains(expected, vm.NavMessage, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, location.Subscribers);
        Assert.Equal(0, location.Starts);
    }

    [Fact]
    public async Task An_invalid_fix_is_not_accepted_as_a_starting_position()
    {
        var (vm, _, _, _, _) = Create();
        Preview(vm);
        await vm.StartAsync(new LocationFix(double.NaN, 0, null, DateTimeOffset.UtcNow), LocationAvailability.Available);
        Assert.Equal(NavigationState.Preview, vm.State);
    }

    [Fact]
    public async Task Starting_shows_the_first_instruction_subscribes_to_location_and_asks_for_navigation_grade_updates()
    {
        var (vm, _, location, _, cameras) = await Started();

        Assert.Equal(NavigationState.Active, vm.State);
        Assert.True(vm.IsNavigating);
        Assert.Equal("Walk from Gate toward Junction.", vm.CurrentInstruction);
        Assert.Equal("▶", vm.CurrentGlyph);
        Assert.Equal("Then: After about 100 m, turn left at Junction.".Replace("Then: ", ""), vm.NextInstruction);
        Assert.Equal("200 m", vm.RemainingDistanceText);
        Assert.Equal("2 min", vm.RemainingTimeText);
        Assert.Equal("12:02", vm.ArrivalTimeText);
        Assert.Equal(1, location.Subscribers);
        Assert.Equal(LocationUpdateProfile.Navigation, location.StartProfiles.Last());
        Assert.Contains(cameras, c => c.Target == CameraTarget.Follow);
    }

    // ---- progress --------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Moving_along_the_route_advances_the_instruction_and_updates_remaining_distance_and_time()
    {
        var (vm, _, location, _, _) = await Started();

        location.Raise(RouteSample.OnFirstLeg(60));

        Assert.Equal("After about 100 m, turn left at Junction.", vm.CurrentInstruction);
        Assert.Equal("←", vm.CurrentGlyph);
        Assert.Equal("In 40 m", vm.DistanceToNextText);
        Assert.Equal("Enter Block One through Main Entrance.", vm.NextInstruction);
        Assert.Equal("140 m", vm.RemainingDistanceText);
        Assert.Equal("2 min", vm.RemainingTimeText);

        location.Raise(RouteSample.OnSecondLeg(20));
        Assert.Equal("Enter Block One through Main Entrance.", vm.CurrentInstruction);
        Assert.Equal("80 m", vm.RemainingDistanceText);
        Assert.Equal("1 min", vm.RemainingTimeText);
    }

    [Fact]
    public async Task The_user_does_not_have_to_advance_steps_by_hand()
    {
        var (vm, _, location, _, _) = await Started();
        var seen = new List<string>();
        foreach (var along in new[] { 3.0, 55, 95, 99 }) { location.Raise(RouteSample.OnFirstLeg(along)); seen.Add(vm.CurrentInstruction); }
        Assert.Equal("Walk from Gate toward Junction.", seen[0]);
        Assert.All(seen.Skip(1), text => Assert.Equal("After about 100 m, turn left at Junction.", text));
    }

    [Fact]
    public async Task Reaching_the_destination_ends_guidance_stops_updates_and_gives_the_indoor_description()
    {
        var (vm, _, location, _, _) = await Started();

        location.Raise(RouteSample.OnSecondLeg(92));

        Assert.Equal(NavigationState.Arrived, vm.State);
        Assert.Equal("You have arrived at Hall 1.", vm.CurrentInstruction);
        Assert.Equal("Hall 1 is on the Ground Floor.", vm.IndoorGuidance);
        Assert.Equal(0, location.Subscribers);
        Assert.Equal(1, location.Stops);
    }

    [Fact]
    public async Task Updates_after_arrival_are_ignored()
    {
        var (vm, _, location, _, _) = await Started();
        location.Raise(RouteSample.OnSecondLeg(92));
        var text = vm.CurrentInstruction;

        location.Raise(RouteSample.OnFirstLeg(10));

        Assert.Equal(text, vm.CurrentInstruction);
        Assert.Equal(NavigationState.Arrived, vm.State);
    }

    [Fact]
    public async Task Invalid_fixes_while_navigating_are_ignored()
    {
        var (vm, _, location, _, _) = await Started();
        location.Raise(RouteSample.OnFirstLeg(60));
        var remaining = vm.RemainingDistanceText;

        location.Raise(new LocationFix(double.NaN, 0, null, DateTimeOffset.UtcNow));

        Assert.Equal(remaining, vm.RemainingDistanceText);
    }

    // ---- follow / overview ----------------------------------------------------------------------------------------------

    [Fact]
    public async Task The_camera_follows_the_user_until_follow_is_switched_off_and_again_when_it_is_switched_on()
    {
        var (vm, _, location, _, cameras) = await Started();
        cameras.Clear();

        location.Raise(RouteSample.OnFirstLeg(20));
        Assert.Single(cameras, c => c.Target == CameraTarget.Follow);

        vm.ToggleFollowCommand.Execute(null);
        Assert.False(vm.FollowUser);
        cameras.Clear();
        location.Raise(RouteSample.OnFirstLeg(30));
        Assert.Empty(cameras); // the user can explore the map without being dragged back

        vm.ToggleFollowCommand.Execute(null);
        Assert.Contains(cameras, c => c.Target == CameraTarget.Follow);
    }

    [Fact]
    public async Task Overview_shows_the_whole_route_and_stops_following()
    {
        var (vm, _, _, _, cameras) = await Started();
        cameras.Clear();

        vm.ShowOverviewCommand.Execute(null);

        Assert.False(vm.FollowUser);
        Assert.Contains(cameras, c => c.Target == CameraTarget.Route);
    }

    // ---- rerouting ---------------------------------------------------------------------------------------------------------

    private static async Task OffRouteFixes(FakeLocationProvider location, int count, double along = 50, double offset = 60)
    {
        for (var i = 0; i < count; i++) location.Raise(RouteSample.OffRoute(along, offset));
        await Task.Yield();
    }

    [Fact]
    public async Task Moving_well_off_the_route_requests_a_new_one_from_the_real_position_to_the_same_destination()
    {
        var (vm, api, location, _, _) = await Started();
        api.Route = (_, _) => RouteSample.Ok(r => { r.Metadata!.GraphVersion = "new"; });

        await OffRouteFixes(location, 3);

        var (from, to) = Assert.Single(api.RouteRequests);
        Assert.Equal("device", from.Source);
        Assert.InRange(from.Latitude!.Value, -0.001, 0);
        Assert.Equal("r1", to.RoomId);
        Assert.Equal("Route updated.", vm.NavMessage);
        Assert.Equal("new", vm.Route!.GraphVersion);
    }

    [Fact]
    public async Task A_single_stray_fix_or_a_small_wander_does_not_reroute()
    {
        var (vm, api, location, _, _) = await Started();

        location.Raise(RouteSample.OffRoute(50, 60));
        location.Raise(RouteSample.OnFirstLeg(55));
        location.Raise(RouteSample.OffRoute(60, 60));
        for (var i = 0; i < 6; i++) location.Raise(RouteSample.OffRoute(60 + i, 12)); // within the campus's 30 m

        Assert.Equal(0, api.RouteCalls);
    }

    [Fact]
    public async Task Reroute_requests_are_not_repeated_while_one_is_pending_or_too_soon()
    {
        var gate = new TaskCompletionSource<CampusRouteResponseDto>();
        var (vm, api, location, clock, _) = await Started();
        api.RouteAsyncOverride = (_, _) => gate.Task;

        await OffRouteFixes(location, 8);
        Assert.Equal(1, api.RouteCalls);          // one in flight
        Assert.True(vm.IsRerouting);

        gate.SetResult(RouteSample.Ok());
        for (var i = 0; i < 200 && vm.IsRerouting; i++) await Task.Delay(10);
        Assert.False(vm.IsRerouting);

        await OffRouteFixes(location, 6);
        Assert.Equal(1, api.RouteCalls);          // still off the (same) line, but the minimum interval has not passed

        clock.Advance(TimeSpan.FromSeconds(16));
        await OffRouteFixes(location, 1);
        Assert.Equal(2, api.RouteCalls);          // ...and after it has, one more request is allowed
    }

    [Fact]
    public async Task Without_a_connection_the_current_route_continues_and_the_user_is_told()
    {
        var (vm, api, location, clock, _) = await Started();
        api.Route = (_, _) => throw new HttpRequestException("offline");

        await OffRouteFixes(location, 3);

        Assert.Equal("Connection unavailable. Continuing with the current route.", vm.NavMessage);
        Assert.Equal(NavigationState.Active, vm.State);
        Assert.NotNull(vm.Route);
        Assert.Equal(1, api.RouteCalls);

        // No request storm: more off-route fixes within the interval do nothing...
        await OffRouteFixes(location, 4);
        Assert.Equal(1, api.RouteCalls);

        // ...and once the interval has passed, it tries again.
        clock.Advance(TimeSpan.FromSeconds(16));
        await OffRouteFixes(location, 1);
        Assert.Equal(2, api.RouteCalls);
    }

    [Fact]
    public async Task Progress_keeps_working_on_the_old_route_while_rerouting_is_unavailable()
    {
        var (vm, api, location, _, _) = await Started();
        api.Route = (_, _) => throw new HttpRequestException("offline");
        await OffRouteFixes(location, 3);

        location.Raise(RouteSample.OnFirstLeg(70));

        Assert.Equal("After about 100 m, turn left at Junction.", vm.CurrentInstruction);
        Assert.Equal("In 30 m", vm.DistanceToNextText);
    }

    [Fact]
    public async Task Getting_back_on_the_route_clears_the_connection_notice()
    {
        var (vm, api, location, _, _) = await Started();
        api.Route = (_, _) => throw new HttpRequestException("offline");
        await OffRouteFixes(location, 3);
        Assert.NotNull(vm.NavMessage);

        location.Raise(RouteSample.OnFirstLeg(70));

        Assert.Null(vm.NavMessage);
    }

    [Theory]
    [InlineData("away_from_campus", "outside this campus")]
    [InlineData("start_too_far_from_paths", "too far from a mapped path")]
    [InlineData("something_new", "Couldn't update the route")]
    public async Task Honest_backend_statuses_during_a_reroute_keep_the_current_route(string status, string expected)
    {
        var (vm, api, location, _, _) = await Started();
        api.Route = (_, _) => new CampusRouteResponseDto { Status = status };

        await OffRouteFixes(location, 3);

        Assert.Contains(expected, vm.NavMessage);
        Assert.Contains("Continuing with the current route", vm.NavMessage);
        Assert.Equal("abc123", vm.Route!.GraphVersion);
    }

    [Theory]
    [InlineData(422, "couldn't find a new route")]
    [InlineData(503, "server had a problem")]
    [InlineData(400, "Couldn't update the route")]
    public async Task Backend_errors_during_a_reroute_become_friendly_notices(int status, string expected)
    {
        var (vm, api, location, _, _) = await Started();
        api.Route = (_, _) => throw new UnivastApiException("stack trace Foo.Bar()", status);

        await OffRouteFixes(location, 3);

        Assert.Contains(expected, vm.NavMessage);
        Assert.DoesNotContain("stack trace", vm.NavMessage);
    }

    [Fact]
    public async Task A_new_route_without_usable_geometry_is_not_adopted()
    {
        var (vm, api, location, _, _) = await Started();
        api.Route = (_, _) => new CampusRouteResponseDto { Status = "ok", DistanceMeters = 20, Instructions = new() { new() { Text = "Go." } } };

        await OffRouteFixes(location, 3);

        Assert.Equal("abc123", vm.Route!.GraphVersion);
        Assert.Contains("Couldn't update the route", vm.NavMessage);
    }

    [Fact]
    public async Task Ending_navigation_while_a_reroute_is_in_flight_discards_its_answer()
    {
        var gate = new TaskCompletionSource<CampusRouteResponseDto>();
        var (vm, api, location, _, _) = await Started();
        api.RouteAsyncOverride = (_, _) => gate.Task;
        await OffRouteFixes(location, 3);

        vm.EndNavigationCommand.Execute(null);
        gate.SetResult(RouteSample.Ok());
        await Task.Yield();

        Assert.Equal(NavigationState.Idle, vm.State);
        Assert.Null(vm.Route);
        Assert.Null(vm.NavMessage);
    }

    [Fact]
    public async Task The_accessible_only_choice_is_kept_for_reroutes()
    {
        var ctx = Create();
        Preview(ctx.Vm, options: new CampusRouteOptions { AccessibleOnly = true });
        await ctx.Vm.StartAsync(RouteSample.OnFirstLeg(0), LocationAvailability.Available);

        await OffRouteFixes(ctx.Location, 3);

        Assert.True(ctx.Api.RouteOptions.Single()!.AccessibleOnly);
    }

    // ---- ending / cancelling / lifecycle ---------------------------------------------------------------------------------------

    [Fact]
    public async Task Ending_navigation_stops_location_follows_clears_the_route_and_tells_the_owner()
    {
        var (vm, _, location, _, _) = await Started();
        var ended = 0;
        var changed = 0;
        vm.Ended += (_, _) => ended++;
        vm.RouteChanged += (_, _) => changed++;

        vm.EndNavigationCommand.Execute(null);

        Assert.Equal(NavigationState.Idle, vm.State);
        Assert.False(vm.IsNavigating);
        Assert.Null(vm.Route);
        Assert.Empty(vm.PreviewSteps);
        Assert.Equal(0, location.Subscribers);
        Assert.Equal(1, location.Stops);
        Assert.Equal(1, ended);
        Assert.Equal(1, changed);

        location.Raise(RouteSample.OnFirstLeg(50)); // nothing listens any more
        Assert.Equal("", vm.CurrentInstruction);
    }

    [Fact]
    public void Cancelling_a_preview_clears_it_without_having_touched_location()
    {
        var (vm, _, location, _, _) = Create();
        Preview(vm);

        vm.EndNavigationCommand.Execute(null);

        Assert.Equal(NavigationState.Idle, vm.State);
        Assert.Equal(0, location.Stops);
        Assert.Equal(0, location.Starts);
    }

    [Fact]
    public void Ending_when_idle_does_nothing()
    {
        var (vm, _, _, _, _) = Create();
        var ended = 0;
        vm.Ended += (_, _) => ended++;
        vm.EndNavigationCommand.Execute(null);
        Assert.Equal(0, ended);
    }

    [Fact]
    public async Task Replacing_a_running_navigation_with_a_new_preview_releases_the_old_subscription()
    {
        var (vm, _, location, _, _) = await Started();

        Preview(vm);

        Assert.Equal(NavigationState.Preview, vm.State);
        Assert.Equal(0, location.Subscribers);
    }

    [Fact]
    public async Task Resuming_restores_navigation_grade_updates_only_while_navigating()
    {
        var (vm, _, location, _, _) = await Started();
        location.StartProfiles.Clear();

        await vm.ResumeAsync();
        Assert.Equal(new[] { LocationUpdateProfile.Navigation }, location.StartProfiles.ToArray());
        Assert.Equal(1, location.Subscribers); // resuming never adds a second subscription

        vm.EndNavigationCommand.Execute(null);
        location.StartProfiles.Clear();
        await vm.ResumeAsync();
        Assert.Empty(location.StartProfiles);
    }

    [Fact]
    public async Task Starting_twice_does_not_double_subscribe()
    {
        var (vm, _, location, _, _) = await Started();
        await vm.StartAsync(RouteSample.OnFirstLeg(0), LocationAvailability.Available); // already Active: ignored
        Assert.Equal(1, location.Subscribers);
    }
}

// ======================================================================================================================
// Integration with the map view model (Phase 3/4 flow -> preview -> navigation)
// ======================================================================================================================
public class MapNavigationIntegrationTests
{
    private static async Task<(CampusMapViewModel Vm, FakeCampusApi Api, FakeLocationProvider Location, List<CameraRequest> Cameras)> Ready(
        Action<FakeLocationProvider>? configureLocation = null, Action<FakeCampusApi>? configureApi = null)
    {
        var api = new FakeCampusApi();
        api.Campuses = () => new() { Sample.Campus() };
        api.Buildings = _ => new() { Sample.Building() };
        api.Landmarks = _ => new() { Sample.Landmark() };
        api.Route = (_, _) => RouteSample.Ok();
        configureApi?.Invoke(api);
        var location = new FakeLocationProvider();
        configureLocation?.Invoke(location);
        var vm = new CampusMapViewModel(api, location, new FakeClock()) { SearchDebounce = TimeSpan.Zero, LocateThrottle = TimeSpan.Zero };
        var cameras = new List<CameraRequest>();
        vm.CameraRequested += (_, r) => cameras.Add(r);
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());
        return (vm, api, location, cameras);
    }

    [Fact]
    public async Task Tapping_navigate_shows_a_preview_and_does_not_start_following()
    {
        var (vm, api, location, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        var startsBefore = location.Starts;

        await vm.NavigateFromHereAsync();

        Assert.True(vm.Navigation.IsPreview);
        Assert.True(vm.Navigation.CanStart);
        Assert.Equal(1, api.RouteCalls);
        Assert.False(vm.ShowDestinationSheet);           // the preview panel replaces the destination sheet
        Assert.Equal(startsBefore, location.Starts);     // nothing high-frequency yet
        Assert.Contains("Walking route", vm.RouteMessage);
        Assert.Contains("200 m", vm.RouteMessage); // formatted by NavigationFormat
    }

    [Fact]
    public async Task Start_navigation_follows_the_route_with_the_real_location()
    {
        var (vm, _, location, cameras) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        await vm.NavigateFromHereAsync();

        await vm.StartNavigationAsync();

        Assert.True(vm.Navigation.IsActive);
        Assert.False(vm.ShowBrowseOverlays);
        Assert.Equal(LocationUpdateProfile.Navigation, location.StartProfiles.Last());

        location.Raise(RouteSample.OnFirstLeg(60));
        Assert.Equal("After about 100 m, turn left at Junction.", vm.Navigation.CurrentInstruction);
    }

    [Fact]
    public async Task Start_navigation_without_location_explains_and_keeps_the_preview()
    {
        // The route was previewed from a chosen landmark because the device had no location.
        var (vm, api, location, _) = await Ready();
        var baseline = location.Subscribers; // the map view model's own subscription
        await vm.NavigateFromHereAsync();
        await vm.NavigateFromLandmarkAsync(vm.StartPointOptions[0]);
        Assert.True(vm.Navigation.IsPreview);

        await vm.StartNavigationAsync();

        Assert.True(vm.Navigation.IsPreview);
        Assert.Contains("Turn on location", vm.Navigation.NavMessage);
        Assert.Equal(baseline, location.Subscribers);
    }

    [Fact]
    public async Task Ending_navigation_returns_to_the_map_and_restores_light_location_updates()
    {
        var (vm, _, location, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        await vm.NavigateFromHereAsync();
        await vm.StartNavigationAsync();
        location.StartProfiles.Clear();

        vm.Navigation.EndNavigationCommand.Execute(null);
        await Task.Yield();

        Assert.False(vm.Navigation.IsNavigating);
        Assert.NotNull(vm.Destination);                   // the selected destination is still there
        Assert.NotNull(vm.Campus);                        // the campus state is untouched
        Assert.True(vm.ShowDestinationSheet);
        Assert.Contains(LocationUpdateProfile.Browse, location.StartProfiles);
    }

    [Fact]
    public async Task Hiding_the_page_stops_location_and_showing_it_again_restores_navigation_updates()
    {
        var (vm, _, location, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        await vm.NavigateFromHereAsync();
        await vm.StartNavigationAsync();
        var stops = location.Stops;
        location.StartProfiles.Clear();

        vm.OnPageDisappearing();
        Assert.Equal(stops + 1, location.Stops);

        await vm.OnPageAppearingAsync();
        Assert.Equal(new[] { LocationUpdateProfile.Navigation }, location.StartProfiles.ToArray());
    }

    [Fact]
    public async Task No_campus_presence_checks_are_made_while_navigating()
    {
        var (vm, api, location, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        await vm.NavigateFromHereAsync();
        await vm.StartNavigationAsync();
        var locateCalls = api.LocateCalls;

        for (var i = 0; i < 4; i++) location.Raise(RouteSample.OnFirstLeg(10 + i));

        Assert.Equal(locateCalls, api.LocateCalls);
    }

    [Fact]
    public async Task Closing_the_destination_cancels_a_preview()
    {
        var (vm, _, _, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        await vm.NavigateFromHereAsync();
        Assert.True(vm.Navigation.IsPreview);

        vm.CloseDestinationCommand.Execute(null);

        Assert.False(vm.Navigation.IsNavigating);
    }

    [Fact]
    public async Task Switching_campus_ends_navigation()
    {
        var (vm, api, location, _) = await Ready(
            l => l.Result = FakeLocationProvider.At(0.0001, 0),
            a => a.Campuses = () => new() { Sample.Campus("c1"), Sample.Campus("c2") });
        // two campuses and a location that matches neither -> the user chose c1 earlier; emulate by choosing now
        await vm.ChooseCampusAsync(vm.CampusChoices[0]);
        await vm.SelectSearchResultAsync(Sample.RoomHit());
        await vm.NavigateFromHereAsync();
        await vm.StartNavigationAsync();
        Assert.True(vm.Navigation.IsActive);

        await vm.ChooseCampusAsync(vm.CampusChoices[1]);

        Assert.False(vm.Navigation.IsNavigating);
        Assert.Equal(1, location.Subscribers); // only the map view model itself is still listening
    }

    [Fact]
    public async Task Recentering_while_navigating_turns_following_back_on()
    {
        var (vm, _, _, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        await vm.NavigateFromHereAsync();
        await vm.StartNavigationAsync();
        vm.Navigation.ShowOverviewCommand.Execute(null);
        Assert.False(vm.Navigation.FollowUser);

        await vm.RecenterAsync();

        Assert.True(vm.Navigation.FollowUser);
    }

    [Fact]
    public async Task Fit_while_navigating_shows_the_whole_route_instead_of_the_campus()
    {
        var (vm, _, _, cameras) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0));
        await vm.NavigateFromHereAsync();
        await vm.StartNavigationAsync();
        cameras.Clear();

        vm.FitCampusCommand.Execute(null);

        Assert.Contains(cameras, c => c.Target == CameraTarget.Route);
        Assert.DoesNotContain(cameras, c => c.Target == CameraTarget.Campus);
    }

    [Theory]
    [InlineData("NO_ROUTE", "No walking route was found")]
    [InlineData("DESTINATION_NOT_ROUTABLE", "entrance isn't connected")]
    [InlineData("INDOOR_UNREACHABLE", "isn't mapped yet")]
    [InlineData("NO_NAVIGATION_GRAPH", "aren't available for this campus")]
    [InlineData("DESTINATION_NOT_FOUND", "couldn't find that destination")]
    [InlineData("LANDMARK_NOT_ROUTABLE", "isn't connected to the campus paths")]
    public async Task Backend_error_codes_become_friendly_routing_messages(string code, string expected)
    {
        var (vm, _, _, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0),
            a => a.Route = (_, _) => throw new UnivastApiException("raw backend text", 422, code));

        await vm.NavigateFromHereAsync();

        Assert.Contains(expected, vm.RouteMessage, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("raw backend text", vm.RouteMessage);
        Assert.False(vm.Navigation.IsNavigating);
    }

    [Fact]
    public async Task A_legacy_backend_route_still_shows_its_steps_as_a_guide()
    {
        var (vm, _, _, _) = await Ready(l => l.Result = FakeLocationProvider.At(0.0001, 0),
            a => a.Route = (_, _) => new() { Status = "ok", DistanceMeters = 60, Instructions = new() { new() { Text = "Walk from A toward B." } } });

        await vm.NavigateFromHereAsync();

        Assert.True(vm.Navigation.IsPreview);
        Assert.False(vm.Navigation.CanStart);
        Assert.Equal(new[] { "Walk from A toward B." }, vm.RouteSteps.ToArray());
    }
}
