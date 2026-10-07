using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;
using UNIVAST.Mobile.ViewModels;

namespace UNIVAST.Mobile.Tests;

public class CampusMapViewModelTests
{
    private static (CampusMapViewModel Vm, FakeCampusApi Api, FakeLocationProvider Location, List<CameraRequest> Cameras) Create(
        Action<FakeCampusApi>? configureApi = null, Action<FakeLocationProvider>? configureLocation = null)
    {
        var api = new FakeCampusApi();
        api.Campuses = () => new() { Sample.Campus() };
        api.Buildings = _ => new() { Sample.Building() };
        api.Landmarks = _ => new() { Sample.Landmark() };
        configureApi?.Invoke(api);

        var location = new FakeLocationProvider();
        configureLocation?.Invoke(location);

        var vm = new CampusMapViewModel(api, location) { SearchDebounce = TimeSpan.Zero, LocateThrottle = TimeSpan.Zero };
        var cameras = new List<CameraRequest>();
        vm.CameraRequested += (_, r) => cameras.Add(r);
        return (vm, api, location, cameras);
    }

    // ---- map-first start-up: the map first, campuses are optional ----------------------------------------------------

    [Fact]
    public async Task Starts_on_the_normal_map_without_selecting_or_loading_any_campus()
    {
        var (vm, api, _, _) = Create();

        await vm.InitializeAsync();

        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Null(vm.Campus);
        Assert.False(vm.IsCampusPickerOpen);
        Assert.False(vm.IsLoading);
        Assert.False(vm.IsError);
        Assert.Equal(CampusContext.None, vm.Context);
        Assert.Equal(0, api.BuildingCalls);
        Assert.Equal(0, api.LandmarkCalls);
        Assert.Single(vm.CampusChoices); // the directory is only loaded so search and "near you" can use it
    }

    [Fact]
    public async Task No_campuses_still_shows_the_normal_map_with_no_blocking_state()
    {
        var (vm, _, _, _) = Create(api => api.Campuses = () => new());

        await vm.InitializeAsync();

        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Null(vm.Campus);
        Assert.False(vm.IsCampusPickerOpen);
        Assert.False(vm.IsError);
        Assert.Empty(vm.CampusChoices);
    }

    [Fact]
    public async Task Invalid_campuses_are_ignored_and_the_map_still_opens()
    {
        var (vm, _, _, _) = Create(api => api.Campuses = () => new() { new CampusSummaryDto { Name = "no id" } });
        await vm.InitializeAsync();
        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Empty(vm.CampusChoices);
    }

    [Fact]
    public async Task A_failed_campus_directory_never_blocks_the_map_or_shows_an_error()
    {
        var (vm, _, _, _) = Create(api => api.Campuses = () => throw new HttpRequestException("Connection refused 10.0.2.2:5000"));

        await vm.InitializeAsync();

        Assert.Equal(HomeState.Ready, vm.State);
        Assert.False(vm.IsError);
        Assert.Null(vm.ErrorMessage);
        Assert.Null(vm.Campus);
    }

    [Fact]
    public async Task The_camera_goes_to_the_user_once_when_a_real_location_is_available()
    {
        var (vm, _, _, cameras) = Create(
            a => a.Locate = (_, _, _) => new() { Status = "outside" },
            l => l.Result = FakeLocationProvider.At(40, -70));

        await vm.InitializeAsync();

        var move = Assert.Single(cameras);
        Assert.Equal(CameraTarget.User, move.Target);
        Assert.Equal(40, move.Latitude);
        Assert.Equal(15, move.Zoom);
        Assert.Null(vm.Campus);
    }

    [Fact]
    public async Task Without_a_location_the_map_still_opens_and_the_camera_is_left_alone()
    {
        var (vm, _, _, cameras) = Create(); // default fake location: permission denied

        await vm.InitializeAsync();

        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Empty(cameras);
        Assert.Null(vm.UserFix);
    }

    [Fact]
    public async Task Near_a_known_campus_it_is_suggested_but_never_opened()
    {
        var (vm, api, _, _) = Create(
            a =>
            {
                a.Campuses = () => new() { Sample.Campus("a"), Sample.Campus("b") };
                a.Locate = (id, _, _) => new() { Status = id == "b" ? "inside" : "outside" };
            },
            l => l.Result = FakeLocationProvider.At(1, 2));

        await vm.InitializeAsync();

        Assert.Null(vm.Campus);
        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Equal(CampusContext.Nearby, vm.Context);
        Assert.True(vm.HasNearbySuggestion);
        Assert.Equal("You're near Campus b", vm.NearbySuggestionText);
        Assert.Equal("b", Assert.Single(vm.NearbyCandidates).Id);
        Assert.False(vm.IsCampusPickerOpen);
        Assert.Equal(0, api.BuildingCalls);
    }

    [Fact]
    public async Task A_far_away_campus_is_not_suggested_even_if_it_is_the_only_one()
    {
        var (vm, _, _, _) = Create(a => a.Locate = (_, _, _) => new() { Status = "outside" }, l => l.Result = FakeLocationProvider.At(40, -70));

        await vm.InitializeAsync();

        Assert.False(vm.HasNearbySuggestion);
        Assert.Equal(CampusContext.None, vm.Context);
    }

    [Fact]
    public async Task Overlapping_campuses_are_offered_as_a_choice_not_a_guess()
    {
        var (vm, _, _, _) = Create(
            a => { a.Campuses = () => new() { Sample.Campus("a"), Sample.Campus("b"), Sample.Campus("c") }; a.Locate = (id, _, _) => new() { Status = id == "c" ? "outside" : "inside" }; },
            l => l.Result = FakeLocationProvider.At(1, 2));

        await vm.InitializeAsync();

        Assert.Null(vm.Campus);
        Assert.Equal(2, vm.NearbyCandidates.Count);
        Assert.Equal("2 campuses are near you", vm.NearbySuggestionText);
        Assert.False(vm.IsCampusPickerOpen);

        await vm.OpenNearbySuggestionAsync();

        Assert.True(vm.IsCampusPickerOpen);
        Assert.Equal(new[] { "a", "b" }, vm.PickerChoices.Select(c => c.Id).ToArray());
        Assert.Null(vm.Campus);
    }

    [Fact]
    public async Task Dismissing_the_suggestion_hides_it_and_it_does_not_come_back_while_moving()
    {
        var (vm, _, location, _) = Create(
            a => a.Locate = (_, _, _) => new() { Status = "inside" },
            l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.InitializeAsync();
        Assert.True(vm.HasNearbySuggestion);

        vm.DismissNearbySuggestionCommand.Execute(null);
        location.Raise(new LocationFix(1.0001, 2.0001, 5, DateTimeOffset.UtcNow));

        Assert.False(vm.HasNearbySuggestion);
        Assert.Equal(CampusContext.None, vm.Context);
    }

    [Fact]
    public async Task Opening_the_suggestion_views_the_campus_and_does_not_check_in()
    {
        var (vm, _, _, _) = Create(a => a.Locate = (_, _, _) => new() { Status = "inside" }, l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.InitializeAsync();

        await vm.OpenNearbySuggestionAsync();

        Assert.Equal("c1", vm.Campus!.Id);
        Assert.Equal(CampusContext.Viewing, vm.Context);
        Assert.False(vm.IsCheckedIn);
        Assert.True(vm.CanCheckIn);   // really on campus, so checking in is offered
        Assert.False(vm.HasNearbySuggestion); // already open
    }

    [Fact]
    public async Task Viewing_a_campus_remotely_works_without_any_location_and_cannot_check_in()
    {
        var (vm, _, _, _) = Create(); // location denied
        await vm.InitializeAsync();

        await vm.ChooseCampusAsync(vm.CampusChoices[0]);

        Assert.Equal(CampusContext.Viewing, vm.Context);
        Assert.Single(vm.Buildings);
        Assert.False(vm.CanCheckIn);

        await vm.CheckInAsync();

        Assert.False(vm.IsCheckedIn);
        Assert.Equal(CampusContext.Viewing, vm.Context);
        Assert.Contains("location", vm.Notice, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Checking_in_is_refused_when_the_backend_says_the_device_is_away()
    {
        var (vm, _, _, _) = Create(a => a.Locate = (_, _, _) => new() { Status = "outside" }, l => l.Result = FakeLocationProvider.At(40, -70));
        await vm.OpenFirstCampusAsync();

        await vm.CheckInAsync();

        Assert.False(vm.IsCheckedIn);
        Assert.Equal(CampusContext.Viewing, vm.Context);
        Assert.NotNull(vm.Notice);
    }

    [Fact]
    public async Task Checking_in_on_campus_activates_the_checked_in_context()
    {
        var (vm, _, _, _) = Create(a => a.Locate = (_, _, _) => new() { Status = "inside" }, l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.OpenFirstCampusAsync();

        await vm.CheckInAsync();

        Assert.True(vm.IsCheckedIn);
        Assert.Equal(CampusContext.CheckedIn, vm.Context);
        Assert.False(vm.CanCheckIn);
    }

    [Fact]
    public async Task Leaving_the_campus_after_checking_in_returns_to_the_normal_map()
    {
        var status = "inside";
        var (vm, _, location, _) = Create(a => a.Locate = (_, _, _) => new() { Status = status }, l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.OpenFirstCampusAsync();
        await vm.CheckInAsync();
        Assert.True(vm.IsCheckedIn);

        status = "outside";
        location.Raise(new LocationFix(40, -70, 5, DateTimeOffset.UtcNow));
        await Task.Yield();

        Assert.Null(vm.Campus);
        Assert.Empty(vm.Buildings);
        Assert.Equal(CampusContext.None, vm.Context);
        Assert.Equal(HomeState.Ready, vm.State);
    }

    [Fact]
    public async Task Viewing_a_campus_remotely_is_not_closed_just_because_the_user_is_elsewhere()
    {
        var (vm, _, location, _) = Create(a => a.Locate = (_, _, _) => new() { Status = "outside" }, l => l.Result = FakeLocationProvider.At(40, -70));
        await vm.OpenFirstCampusAsync();

        location.Raise(new LocationFix(41, -71, 5, DateTimeOffset.UtcNow));
        await Task.Yield();

        Assert.NotNull(vm.Campus);
        Assert.Equal(CampusContext.Viewing, vm.Context);
    }

    [Fact]
    public async Task Closing_the_campus_returns_to_the_normal_map_and_clears_campus_state()
    {
        var (vm, _, _, cameras) = Create();
        await vm.OpenFirstCampusAsync();
        await vm.SelectMapItemAsync("building", "b1");
        await vm.SearchAsync("block");
        cameras.Clear();

        vm.ExitCampusCommand.Execute(null);

        Assert.Null(vm.Campus);
        Assert.Empty(vm.Buildings);
        Assert.Empty(vm.Landmarks);
        Assert.Null(vm.Destination);
        Assert.Equal(SearchStatus.Idle, vm.SearchStatus);
        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Equal(CampusContext.None, vm.Context);
    }

    [Fact]
    public async Task A_failed_campus_load_is_an_inline_message_retry_recovers_and_back_to_map_works()
    {
        var fail = true;
        var (vm, api, _, _) = Create(a => a.Buildings = _ => fail ? throw new UnivastApiException("x", 503) : new() { Sample.Building() });
        await vm.InitializeAsync();

        await vm.ChooseCampusAsync(vm.CampusChoices[0]);
        Assert.Equal(HomeState.CampusFailed, vm.State);
        Assert.True(vm.IsError);
        Assert.Contains("server had a problem", vm.ErrorMessage);

        fail = false;
        await vm.RetryAsync();
        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Equal(1, api.CampusCalls); // the directory was not re-fetched

        fail = true;
        await vm.ChooseCampusAsync(vm.CampusChoices[0]);
        vm.DismissCampusErrorCommand.Execute(null);
        Assert.Null(vm.Campus);
        Assert.Equal(HomeState.Ready, vm.State);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task A_campus_with_no_buildings_or_landmarks_says_so()
    {
        var (vm, _, _, _) = Create(api => { api.Buildings = _ => new(); api.Landmarks = _ => new(); });
        await vm.OpenFirstCampusAsync();
        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Equal("No campus locations found", vm.MapEmptyMessage);
    }

    [Fact]
    public async Task Browsing_campuses_lists_all_of_them_and_choosing_one_opens_it_remotely()
    {
        var (vm, api, _, _) = Create(a => a.Campuses = () => new() { Sample.Campus("a"), Sample.Campus("b") });
        await vm.InitializeAsync();

        vm.ShowCampusPickerCommand.Execute(null);
        Assert.True(vm.IsCampusPickerOpen);
        Assert.Equal(2, vm.PickerChoices.Count);
        Assert.Equal(0, api.BuildingCalls);

        await vm.ChooseCampusAsync(vm.PickerChoices[1]);
        Assert.Equal("b", vm.Campus!.Id);
        Assert.False(vm.IsCampusPickerOpen);
    }

    // ---- searching from the plain map ---------------------------------------------------------------------------------

    [Fact]
    public async Task A_room_found_from_the_plain_map_opens_its_campus_remotely_and_shows_the_room()
    {
        var (vm, api, _, _) = Create(a => a.RoomDetail = id => new CampusRoomDetailDto { Id = id, Name = "Hall 1" });
        await vm.InitializeAsync(); // no campus open, location denied: "nowhere near that campus"
        var hit = Sample.RoomHit();
        hit.CampusId = "c1";

        await vm.SelectSearchResultAsync(hit);

        Assert.Equal("c1", vm.Campus!.Id);
        Assert.Equal(CampusContext.Viewing, vm.Context);
        Assert.Equal("r1", vm.Destination!.Id);
        Assert.Equal(1, api.BuildingCalls);
    }

    [Fact]
    public async Task A_university_result_opens_its_campus_for_remote_viewing()
    {
        var (vm, _, _, _) = Create();
        await vm.InitializeAsync();

        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "university", Id = "u", Name = "Test University", UniversityId = "u" });

        Assert.Equal("c1", vm.Campus!.Id);
        Assert.Null(vm.Destination);
    }

    [Fact]
    public async Task A_campus_that_is_not_in_the_directory_gives_a_notice_and_never_opens_a_different_campus()
    {
        var (vm, _, _, _) = Create();
        await vm.InitializeAsync();

        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "campus", Id = "unknown", Name = "Elsewhere", CampusId = "unknown" });

        Assert.Null(vm.Campus);
        Assert.True(vm.HasNotice);
    }

    [Fact]
    public async Task A_general_map_place_is_pinned_without_a_campus_and_directions_are_honestly_unavailable()
    {
        var (vm, api, _, cameras) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.InitializeAsync();
        cameras.Clear();

        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "geo", Id = "osm:node:1", Name = "Calabar", Category = "place", Latitude = 4.95, Longitude = 8.32, Address = "Calabar, Nigeria" });
        await vm.NavigateFromHereAsync();

        Assert.Null(vm.Campus);
        Assert.Equal("osm:node:1", vm.Destination!.Id);
        Assert.Equal(4.95, Assert.Single(cameras).Latitude);
        Assert.Equal(0, api.RouteCalls);
        Assert.Contains("aren't available", vm.RouteMessage);
    }

    [Fact]
    public async Task A_submitted_search_with_no_campus_asks_for_map_places_but_typing_does_not()
    {
        var (vm, api, _, _) = Create();
        await vm.InitializeAsync();
        var included = new List<bool>();
        api.GlobalSearchAsyncOverride = (_, _) =>
        {
            included.Add(api.LastGlobalSearchIncludedGeo);
            return Task.FromResult(new CampusSearchResponseDto { Results = new() });
        };

        await vm.SearchAsync("calabar");        // typing (debounced)
        await vm.SearchNowAsync("calabar");     // keyboard Search key

        Assert.Equal(new[] { false, true }, included.ToArray());
    }

    [Fact]
    public async Task When_map_places_could_not_be_searched_the_user_is_told_instead_of_seeing_a_silent_empty_list()
    {
        var (vm, api, _, _) = Create();
        await vm.InitializeAsync();
        api.GlobalSearchAsyncOverride = (_, _) => Task.FromResult(new CampusSearchResponseDto
        {
            Results = new() { Sample.RoomHit() },
            Geo = new CampusSearchGeoDto { Requested = true, Status = "unavailable" },
        });

        await vm.SearchNowAsync("hall");

        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
        Assert.Contains("map places", vm.SearchMessage, StringComparison.OrdinalIgnoreCase);
    }

    // ---- location & away-from-campus -------------------------------------------------------------------

    [Fact]
    public async Task Away_from_campus_is_honest_and_the_camera_stays_on_the_campus()
    {
        var (vm, _, _, cameras) = Create(
            a => a.Locate = (_, _, _) => new() { Status = "outside" },
            l => l.Result = FakeLocationProvider.At(40, -70));

        await vm.InitializeAsync();
        cameras.Clear(); // start-up may move the camera to the user on the plain map; opening a campus must not
        await vm.ChooseCampusAsync(vm.CampusChoices[0]);

        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Equal(CampusPresence.AwayFromCampus, vm.Presence.Presence);
        Assert.Equal("You’re away from this campus", vm.Presence.Title);
        // The real position is kept (so the dot can be drawn separately) ...
        Assert.Equal(40, vm.UserFix!.Latitude);
        // ... but the camera is never sent to the unrelated user location.
        Assert.DoesNotContain(cameras, c => c.Target == CameraTarget.User);
        Assert.Equal(CameraTarget.Campus, cameras.Last().Target);
        // Exploring and searching still work.
        await vm.SearchAsync("block");
        Assert.NotEqual(SearchStatus.Failed, vm.SearchStatus);
    }

    [Fact]
    public async Task Denied_permission_keeps_the_campus_map_usable_and_asks_only_once()
    {
        var (vm, _, location, _) = Create(configureLocation: l => l.Result = LocationResult.Without(LocationAvailability.PermissionDenied));

        await vm.OpenFirstCampusAsync();

        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Null(vm.UserFix);
        Assert.Equal(CampusPresence.Unknown, vm.Presence.Presence);
        Assert.Contains("explore", vm.Presence.Detail);

        await vm.RecenterAsync();
        await vm.RecenterAsync();

        // Exactly one request was allowed to prompt (start-up); recentering never prompts again.
        Assert.Equal(1, location.PermissionRequests.Count(p => p));
        Assert.Contains("Settings", vm.LocationMessage);
        Assert.True(vm.CanOpenLocationSettings);

        vm.OpenLocationSettingsCommand.Execute(null);
        Assert.Equal(1, location.SettingsOpened);
    }

    [Theory]
    [InlineData(LocationAvailability.ServicesDisabled, "services")]
    [InlineData(LocationAvailability.Unavailable, "can't find your location")]
    public async Task Recenter_explains_why_there_is_no_location(LocationAvailability why, string expected)
    {
        var (vm, _, _, cameras) = Create(configureLocation: l => l.Result = LocationResult.Without(why));
        await vm.OpenFirstCampusAsync();
        cameras.Clear();

        await vm.RecenterAsync();

        Assert.Contains(expected, vm.LocationMessage, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(cameras);
    }

    [Fact]
    public async Task Recenter_moves_the_camera_to_the_real_fix()
    {
        var (vm, _, _, cameras) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1.0005, 2.0005));
        await vm.OpenFirstCampusAsync();
        cameras.Clear();

        await vm.RecenterAsync();

        var request = Assert.Single(cameras);
        Assert.Equal(CameraTarget.User, request.Target);
        Assert.Equal(1.0005, request.Latitude);
        Assert.Null(vm.LocationMessage);
    }

    [Fact]
    public async Task Live_location_updates_move_the_dot_but_never_the_camera()
    {
        var (vm, _, location, cameras) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1.0005, 2.0005));
        await vm.OpenFirstCampusAsync();
        var moved = 0;
        vm.UserLocationChanged += (_, _) => moved++;
        cameras.Clear();

        location.Raise(new LocationFix(1.0006, 2.0006, 5, DateTimeOffset.UtcNow));

        Assert.Equal(1.0006, vm.UserFix!.Latitude);
        Assert.Equal(1, moved);
        Assert.Empty(cameras);
    }

    [Fact]
    public async Task Invalid_live_fixes_are_ignored()
    {
        var (vm, _, location, _) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1.0005, 2.0005));
        await vm.OpenFirstCampusAsync();

        location.Raise(new LocationFix(double.NaN, 0, null, DateTimeOffset.UtcNow));
        location.Raise(new LocationFix(95, 0, null, DateTimeOffset.UtcNow));

        Assert.Equal(1.0005, vm.UserFix!.Latitude);
    }

    [Fact]
    public async Task Live_updates_do_not_hammer_the_locate_endpoint()
    {
        var (vm, api, location, _) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1.0005, 2.0005));
        vm.LocateThrottle = TimeSpan.FromHours(1);
        await vm.OpenFirstCampusAsync();
        var before = api.LocateCalls;

        for (var i = 0; i < 5; i++) location.Raise(new LocationFix(1.0005 + i * 1e-5, 2.0005, 5, DateTimeOffset.UtcNow));

        Assert.Equal(before, api.LocateCalls);
    }

    [Fact]
    public async Task Offline_locate_failure_says_so_instead_of_guessing_on_or_off_campus()
    {
        var (vm, _, _, _) = Create(
            a => a.Locate = (_, _, _) => throw new HttpRequestException("offline"),
            l => l.Result = FakeLocationProvider.At(1, 2));

        await vm.OpenFirstCampusAsync();

        Assert.Equal(HomeState.Ready, vm.State);
        Assert.Equal(CampusPresence.Unknown, vm.Presence.Presence);
        Assert.Contains("Can't check", vm.Presence.Title);
    }

    [Fact]
    public async Task Live_tracking_only_starts_when_a_real_location_exists_and_stops_when_the_page_hides()
    {
        var (vm, _, location, _) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.OpenFirstCampusAsync();
        Assert.Equal(1, location.Starts);

        vm.OnPageDisappearing();
        Assert.Equal(1, location.Stops);

        await vm.OnPageAppearingAsync();
        Assert.Equal(2, location.Starts);

        var (denied, _, deniedLocation, _) = Create();
        await denied.OpenFirstCampusAsync();
        Assert.Equal(0, deniedLocation.Starts);
    }

    // ---- search ------------------------------------------------------------------------------------------

    [Fact]
    public async Task Blank_search_text_never_calls_the_api()
    {
        var (vm, api, _, _) = Create();
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("");
        await vm.SearchAsync("   ");
        await vm.SearchAsync(null);

        Assert.Equal(0, api.SearchCalls);
        Assert.Equal(SearchStatus.Idle, vm.SearchStatus);
    }

    [Fact]
    public async Task Search_uses_the_backend_and_groups_results()
    {
        var (vm, api, _, _) = Create(a => a.Search = (_, _) => new()
        {
            Results = new() { Sample.RoomHit(), new() { Kind = "building", Id = "b1", Name = "Block One", Category = "faculty" } },
        });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("  hall 1 ");

        Assert.Equal(new[] { "hall 1" }, api.SearchQueries.ToArray()); // trimmed, sent as typed — no client-side alias logic
        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
        Assert.Equal(new[] { "ROOMS", "BUILDINGS" }, vm.SearchSections.Select(s => s.Title).ToArray());
        Assert.Equal("Block One · Ground Floor", vm.SearchSections[0].Items[0].Subtitle);
    }

    [Fact]
    public async Task No_results_shows_the_empty_state_with_a_hint()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => new() { Results = new() });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("zzz");

        Assert.Equal(SearchStatus.Empty, vm.SearchStatus);
        Assert.True(vm.ShowSearchEmpty);
        Assert.Equal("Try a place, address, building, room number, landmark, or abbreviation.", vm.SearchMessage);
    }

    [Fact]
    public async Task A_search_failure_is_friendly_and_can_be_retried()
    {
        var fail = true;
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => fail ? throw new HttpRequestException("socket closed") : new() { Results = new() { Sample.RoomHit() } });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("hall");
        Assert.Equal(SearchStatus.Failed, vm.SearchStatus);
        Assert.DoesNotContain("socket", vm.SearchMessage);

        fail = false;
        await vm.SearchAsync("hall");
        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
    }

    [Fact]
    public async Task A_malformed_search_response_with_no_results_array_is_just_empty()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => new CampusSearchResponseDto());
        await vm.OpenFirstCampusAsync();
        await vm.SearchAsync("x");
        Assert.Equal(SearchStatus.Empty, vm.SearchStatus);
    }

    // ---- selecting destinations -------------------------------------------------------------------------

    [Fact]
    public async Task Choosing_a_room_closes_search_moves_the_camera_shows_the_sheet_and_does_not_start_navigation()
    {
        var (vm, api, _, cameras) = Create(a => a.RoomDetail = id => new CampusRoomDetailDto
        {
            Id = id, Name = "Hall 1", Type = "lecture_hall", Aliases = new() { "Hall 1", "Hall One" },
            Floor = new() { Id = "f1", FloorNumber = 0, Name = "Ground Floor" },
            Building = new() { Id = "b1", Name = "Block One", Latitude = 1.001, Longitude = 2.001 },
        });
        await vm.OpenFirstCampusAsync();
        vm.OpenSearchCommand.Execute(null);
        cameras.Clear();

        await vm.SelectSearchResultAsync(Sample.RoomHit());

        Assert.False(vm.IsSearchOpen);
        Assert.Equal(CameraTarget.Point, cameras.First().Target);
        Assert.Equal(1.001, cameras.First().Latitude);
        Assert.Equal("Hall 1", vm.Destination!.Title);
        Assert.Equal("Block One · Ground Floor", vm.Destination.Subtitle);
        Assert.Equal(new[] { "Hall One" }, vm.Destination.Aliases.ToArray());
        Assert.True(vm.Destination.DetailsLoaded);
        Assert.False(vm.IsLoadingDestination);
        Assert.Equal(0, api.RouteCalls);
        // The room's building doors are shown, and the building is highlighted.
        Assert.Single(vm.VisibleEntrances);
        Assert.Equal("b1", vm.SelectedMapItemId);
    }

    [Fact]
    public async Task A_failed_detail_request_keeps_the_destination_visible_with_a_friendly_error()
    {
        var (vm, _, _, _) = Create(a => a.RoomDetail = _ => throw new UnivastApiException("boom", 500));
        await vm.OpenFirstCampusAsync();

        await vm.SelectSearchResultAsync(Sample.RoomHit());

        Assert.NotNull(vm.Destination);
        Assert.Equal("Hall 1", vm.Destination!.Title);
        Assert.Contains("server had a problem", vm.DestinationError);
        Assert.False(vm.IsLoadingDestination);
    }

    [Fact]
    public async Task Tapping_a_building_marker_loads_floors_and_lecture_halls()
    {
        var (vm, _, _, cameras) = Create(a => a.BuildingDetail = id => new CampusBuildingDetailDto
        {
            Id = id, Name = "Block One", Type = "faculty", Latitude = 1.001, Longitude = 2.001,
            Floors = new() { new() { Id = "f1", FloorNumber = 0 }, new() { Id = "f2", FloorNumber = 1 } },
            Rooms = new() { new() { Name = "Hall 1", Type = "lecture_hall" } },
        });
        await vm.OpenFirstCampusAsync();
        cameras.Clear();

        await vm.SelectMapItemAsync("building", "b1");

        Assert.Equal(DestinationKind.Building, vm.Destination!.Kind);
        Assert.Equal(2, vm.Destination.FloorCount);
        Assert.Contains("Hall 1", vm.DestinationFactsText);
        Assert.Contains("2 floors", vm.DestinationFactsText);
        Assert.Equal(CameraTarget.Point, cameras.First().Target);
    }

    [Fact]
    public async Task Tapping_an_entrance_selects_its_building()
    {
        var (vm, _, _, _) = Create();
        await vm.OpenFirstCampusAsync();

        await vm.SelectMapItemAsync("entrance", "b1-e1");

        Assert.Equal("b1", vm.Destination!.Id);
    }

    [Fact]
    public async Task Tapping_a_landmark_shows_it_and_unknown_ids_are_ignored()
    {
        var (vm, _, _, _) = Create();
        await vm.OpenFirstCampusAsync();

        await vm.SelectMapItemAsync("landmark", "does-not-exist");
        Assert.Null(vm.Destination);

        await vm.SelectMapItemAsync("landmark", "l1");
        Assert.Equal("Gate", vm.Destination!.Title);
        Assert.True(vm.Destination.CanNavigate);
    }

    [Fact]
    public async Task Closing_the_sheet_clears_the_destination_route_and_entrances()
    {
        var (vm, _, _, _) = Create();
        await vm.OpenFirstCampusAsync();
        await vm.SelectMapItemAsync("building", "b1");

        vm.CloseDestinationCommand.Execute(null);

        Assert.Null(vm.Destination);
        Assert.Empty(vm.VisibleEntrances);
        Assert.Empty(vm.RouteSteps);
        Assert.Null(vm.RouteMessage);
    }

    // ---- Navigate from here ------------------------------------------------------------------------------

    [Fact]
    public async Task Navigate_from_here_uses_the_real_device_fix_as_the_origin()
    {
        var (vm, api, _, _) = Create(
            a => a.Route = (_, _) => new()
            {
                Status = "ok", DistanceMeters = 273,
                Instructions = new() { new() { Text = "Walk from Gate toward Junction." }, new() { Text = "Enter Block One through Main Entrance." } },
            },
            l => l.Result = FakeLocationProvider.At(1.0002, 2.0003, 7));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        var (from, to) = Assert.Single(api.RouteRequests);
        Assert.Equal(1.0002, from.Latitude);
        Assert.Equal(2.0003, from.Longitude);
        Assert.Equal(7, from.AccuracyMeters);
        Assert.Null(from.LandmarkId);
        Assert.Equal("r1", to.RoomId);
        Assert.Contains("275 m", vm.RouteMessage); // 273 m, shown to the nearest 5 m
        Assert.Equal(2, vm.RouteSteps.Count);
        Assert.False(vm.NeedsStartPoint);
    }

    [Fact]
    public async Task Without_a_location_nothing_is_sent_and_the_user_chooses_a_starting_landmark()
    {
        var (vm, api, _, _) = Create();
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        Assert.Equal(0, api.RouteCalls); // no invented coordinates
        Assert.True(vm.NeedsStartPoint);
        Assert.Contains("starting point", vm.RouteMessage);
        Assert.Single(vm.StartPointOptions);

        await vm.NavigateFromLandmarkAsync(vm.StartPointOptions[0]);

        var (from, to) = Assert.Single(api.RouteRequests);
        Assert.Equal("l1", from.LandmarkId);
        Assert.Null(from.Latitude);
        Assert.Equal("r1", to.RoomId);
        Assert.False(vm.NeedsStartPoint);
    }

    [Fact]
    public async Task A_backend_away_from_campus_answer_is_shown_honestly_with_no_route()
    {
        var (vm, api, _, _) = Create(
            a => a.Route = (_, _) => new() { Status = "away_from_campus", Message = "You're currently away from campus. Choose a starting point on campus to get walking directions." },
            l => l.Result = FakeLocationProvider.At(40, -70));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        Assert.Equal(1, api.RouteCalls);
        Assert.Contains("away from campus", vm.RouteMessage);
        Assert.Empty(vm.RouteSteps);
        Assert.True(vm.NeedsStartPoint);
    }

    [Fact]
    public async Task Start_too_far_from_paths_offers_a_starting_point()
    {
        var (vm, _, _, _) = Create(
            a => a.Route = (_, _) => new() { Status = "start_too_far_from_paths" },
            l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        Assert.True(vm.NeedsStartPoint);
        Assert.Contains("starting point", vm.RouteMessage);
    }

    [Fact]
    public async Task An_unroutable_destination_shows_the_backends_422_message()
    {
        var (vm, _, _, _) = Create(
            a => a.Route = (_, _) => throw new UnivastApiException("No entrance of 'Block One' is connected to the walking network yet", 422),
            l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        Assert.Contains("connected to the walking network", vm.RouteMessage);
        Assert.False(vm.IsRouting);
    }

    [Fact]
    public async Task Routing_network_failures_are_friendly()
    {
        var (vm, _, _, _) = Create(a => a.Route = (_, _) => throw new HttpRequestException("dns"), l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        Assert.Contains("internet", vm.RouteMessage, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_legacy_place_explains_that_directions_are_not_available_and_sends_nothing()
    {
        var (vm, api, _, _) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1, 2));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "location", Id = "x", Name = "Demo ATM", Category = "atm" });

        await vm.NavigateFromHereAsync();

        Assert.Equal(0, api.RouteCalls);
        Assert.Contains("aren't available", vm.RouteMessage);
    }

    [Fact]
    public async Task Switching_campus_clears_the_previous_campus_state()
    {
        var (vm, _, _, _) = Create(a => a.Campuses = () => new() { Sample.Campus("a"), Sample.Campus("b") });
        await vm.InitializeAsync();
        await vm.ChooseCampusAsync(vm.CampusChoices[0]);
        await vm.SelectMapItemAsync("building", "b1");
        await vm.SearchAsync("block");

        await vm.ChooseCampusAsync(vm.CampusChoices[1]);

        Assert.Equal("b", vm.Campus!.Id);
        Assert.Null(vm.Destination);
        Assert.Equal(SearchStatus.Idle, vm.SearchStatus);
    }

    // ---- place card, directions and explore (map UX) ----------------------------------------------------------------

    [Fact]
    public async Task Directions_are_offered_for_a_campus_place_and_not_for_a_general_map_place()
    {
        var (vm, _, _, _) = Create();
        await vm.OpenFirstCampusAsync();

        await vm.SelectSearchResultAsync(Sample.RoomHit());
        Assert.Equal("UNIVAST campus", vm.DestinationSourceLabel);
        Assert.True(vm.ShowNavigateButton);
        Assert.False(vm.ShowNavigateUnavailable);
        Assert.False(vm.ShowOpenInMapsApp);

        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "geo", Id = "osm:node:7", Name = "Calabar", Category = "city", Latitude = 4.95, Longitude = 8.32, Address = "Calabar, Nigeria" });
        Assert.Equal("Map place", vm.DestinationSourceLabel);
        Assert.True(vm.IsGeneralPlace);
        Assert.False(vm.ShowNavigateButton);
        Assert.True(vm.ShowNavigateUnavailable);
        Assert.Equal(DestinationBuilder.GeneralDirectionsUnavailable, vm.NavigateUnavailableText);
        Assert.True(vm.ShowOpenInMapsApp);          // the phone's own maps app can route; UNIVAST shows nothing of its own
        Assert.Equal("4.95000, 8.32000", vm.DestinationCoordinatesText);
        Assert.Empty(vm.DestinationTrail);          // no campus hierarchy is invented for a map place
    }

    [Fact]
    public async Task The_route_preview_names_where_it_starts_and_that_it_is_a_walking_route()
    {
        var (vm, _, _, _) = Create(
            a => a.Route = (_, _) => new() { Status = "ok", DistanceMeters = 120, Instructions = new() { new() { Text = "Walk to the gate." } } },
            l => l.Result = FakeLocationProvider.At(1.0002, 2.0003, 7));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        Assert.Equal("Your location", vm.Navigation.OriginLabel);
        Assert.Equal("Walking", vm.Navigation.ModeLabel);
    }

    [Fact]
    public async Task A_chosen_starting_landmark_is_named_as_the_origin()
    {
        var (vm, _, _, _) = Create(a => a.Route = (_, _) => new() { Status = "ok", DistanceMeters = 50, Instructions = new() { new() { Text = "Walk." } } });
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());
        await vm.NavigateFromHereAsync();

        await vm.NavigateFromLandmarkAsync(vm.StartPointOptions[0]);

        Assert.Equal(vm.Landmarks[0].Name, vm.Navigation.OriginLabel);
    }

    [Fact]
    public async Task Search_offers_real_campuses_to_explore_before_anything_is_typed()
    {
        var (vm, _, _, _) = Create(a => a.Campuses = () => new() { Sample.Campus("a"), Sample.Campus("b") });
        await vm.InitializeAsync();

        Assert.True(vm.ShowExplore);
        Assert.Equal(new[] { "a", "b" }, vm.ExploreCampuses.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task With_no_campuses_there_is_nothing_to_explore_and_search_still_works()
    {
        var (vm, _, _, _) = Create(a => a.Campuses = () => new());
        await vm.InitializeAsync();

        Assert.False(vm.ShowExplore);
        Assert.Empty(vm.ExploreCampuses);
    }

    [Fact]
    public async Task A_place_can_ask_the_map_to_show_its_campus_without_checking_in()
    {
        var (vm, _, _, cameras) = Create();
        await vm.InitializeAsync();
        cameras.Clear();

        await vm.ViewCampusAsync("c1", 1.0005, 2.0005);

        Assert.Equal("c1", vm.Campus!.Id);
        Assert.Equal(CampusContext.Viewing, vm.Context);
        Assert.False(vm.IsCheckedIn);
        Assert.Equal(CameraTarget.Point, cameras.Last().Target);
        Assert.Equal(1.0005, cameras.Last().Latitude);
    }

    [Fact]
    public async Task Asking_the_map_for_an_unknown_campus_gives_a_notice_and_opens_nothing()
    {
        var (vm, _, _, _) = Create();
        await vm.InitializeAsync();

        await vm.ViewCampusAsync("nope", null, null);

        Assert.Null(vm.Campus);
        Assert.True(vm.HasNotice);
    }

    [Fact]
    public void Campus_data_rows_are_marked_and_map_places_are_not()
    {
        var response = new CampusSearchResponseDto
        {
            Results = new()
            {
                new CampusSearchResultDto { Kind = "room", Id = "r", Name = "LT1" },
                new CampusSearchResultDto { Kind = "geo", Id = "osm:node:1", Name = "Calabar" },
            },
        };
        var sections = SearchResultGrouper.Group(response).SelectMany(s => s.Items).ToDictionary(i => i.Result.Kind);
        Assert.True(sections["room"].IsCampusData);
        Assert.False(sections["geo"].IsCampusData);
    }
}
