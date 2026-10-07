using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;
using UNIVAST.Mobile.ViewModels;

namespace UNIVAST.Mobile.Tests;

public class SearchQueryTests
{
    [Theory]
    [InlineData("  lt1  ", "lt1")]
    [InlineData("lecture   theatre \t 1", "lecture theatre 1")]
    [InlineData("\n LT1 \n", "LT1")]
    [InlineData("   ", "")]
    [InlineData(null, "")]
    [InlineData("Faculty of   Science", "Faculty of Science")]
    public void Normalize_trims_and_collapses_whitespace_without_changing_the_words(string? input, string expected)
    {
        Assert.Equal(expected, SearchQuery.Normalize(input));
    }

    [Fact]
    public void Normalize_keeps_case_because_the_backend_is_case_insensitive()
    {
        Assert.Equal("LT1", SearchQuery.Normalize("LT1"));
        Assert.Equal("lt1", SearchQuery.Normalize("lt1"));
    }

    [Fact]
    public void Normalize_caps_the_length_at_what_the_backend_accepts()
    {
        var result = SearchQuery.Normalize(new string('a', 500));
        Assert.Equal(SearchQuery.MaxLength, result.Length);
    }

    [Fact]
    public void The_same_search_in_a_different_case_has_the_same_cache_key_but_not_across_campuses()
    {
        Assert.Equal(SearchQuery.CacheKey("c1", "LT1"), SearchQuery.CacheKey("c1", "lt1"));
        Assert.NotEqual(SearchQuery.CacheKey("c1", "lt1"), SearchQuery.CacheKey("c2", "lt1"));
    }
}

public class SearchCacheTests
{
    private sealed class ManualTime : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 4, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public void Entries_expire_after_the_ttl()
    {
        var time = new ManualTime();
        var cache = new SearchCache(time) { Ttl = TimeSpan.FromMinutes(2) };
        cache.Set("k", new CampusSearchResponseDto());

        Assert.True(cache.TryGet("k", out _));
        time.Now += TimeSpan.FromMinutes(3);
        Assert.False(cache.TryGet("k", out _));
    }

    [Fact]
    public void The_oldest_entry_is_evicted_when_full_and_clear_empties_everything()
    {
        var cache = new SearchCache(new ManualTime(), capacity: 2);
        cache.Set("a", new()); cache.Set("b", new()); cache.Set("c", new());

        Assert.False(cache.TryGet("a", out _));
        Assert.True(cache.TryGet("b", out _));
        Assert.True(cache.TryGet("c", out _));

        cache.Clear();
        Assert.False(cache.TryGet("c", out _));
    }
}

public class SearchPresentationTests
{
    private static CampusSearchResultDto Room() => new()
    {
        Kind = "room", Id = "r1", Name = "Hall 1", Category = "lecture_hall", DataSource = "DEV_FIXTURE",
        Building = new() { Id = "b1", Name = "Block One" }, Floor = new() { Id = "f1", FloorNumber = 0, Name = "Ground Floor" },
    };

    [Fact]
    public void A_room_shows_its_type_and_where_it_is_and_never_its_id()
    {
        var item = SearchResultGrouper.Group(new CampusSearchResponseDto { Results = new() { Room() } }).Single().Items.Single();

        Assert.Equal("Hall 1", item.Title);
        Assert.Equal("Room · Lecture hall", item.TypeLine);
        Assert.Equal("Block One · Ground Floor", item.ContextLine);
        Assert.True(item.HasContext);
        Assert.True(item.IsDemoData);
        Assert.DoesNotContain("r1", item.TypeLine + item.ContextLine + item.Title);
    }

    [Theory]
    [InlineData("building", "faculty", "Building · Faculty")]
    [InlineData("landmark", "landmark", "Landmark")]
    [InlineData("landmark", "gate", "Landmark · Gate")]
    [InlineData("landmark", "other", "Landmark")]
    [InlineData("location", "atm", "Place · ATM")]
    [InlineData("place", null, "Place")]
    [InlineData("hologram", null, "Result")]
    public void Type_line_combines_kind_and_a_useful_category(string kind, string? category, string expected)
    {
        Assert.Equal(expected, SearchResultGrouper.TypeLine(new CampusSearchResultDto { Kind = kind, Category = category }));
    }

    [Fact]
    public void Non_room_results_have_no_context_line_and_real_data_has_no_demo_tag()
    {
        var item = SearchResultGrouper.Group(new CampusSearchResponseDto
        {
            Results = new() { new() { Kind = "building", Id = "b", Name = "Block", Category = "faculty", DataSource = "import" } },
        }).Single().Items.Single();

        Assert.False(item.HasContext);
        Assert.False(item.IsDemoData);
    }

    [Fact]
    public void Business_results_are_their_own_section_after_the_campus_ones()
    {
        var sections = SearchResultGrouper.Group(new CampusSearchResponseDto
        {
            Results = new()
            {
                new() { Kind = "building", Id = "b", Name = "Block" },
                new() { Kind = "place", Id = "p", Name = "Campus Cafe" },
            },
        });
        Assert.Equal(new[] { "BUILDINGS", "NEARBY PLACES" }, sections.Select(s => s.Title).ToArray());
    }

    [Fact]
    public void Hierarchy_trail_for_a_room_is_university_campus_building_floor()
    {
        var room = DestinationBuilder.FromSearchResult(Room());
        Assert.Equal("Test University › Campus One › Block One › Ground Floor", DestinationHierarchy.Trail("Test University", "Campus One", room));
    }

    [Fact]
    public void Hierarchy_trail_for_a_building_or_landmark_stops_at_the_campus()
    {
        var landmark = DestinationBuilder.FromLandmark(new CampusLandmarkDto { Id = "l", Name = "Gate", NavigationNodeId = "n" });
        var building = DestinationBuilder.FromBuilding(new CampusBuildingDto { Id = "b", Name = "Block" });

        Assert.Equal("Test University › Campus One", DestinationHierarchy.Trail("Test University", "Campus One", landmark));
        Assert.Equal("Test University › Campus One", DestinationHierarchy.Trail("Test University", "Campus One", building));
    }

    [Fact]
    public void Hierarchy_trail_only_shows_levels_that_are_known()
    {
        Assert.Equal("Campus One", DestinationHierarchy.Trail("", "Campus One", DestinationBuilder.FromBuilding(new CampusBuildingDto { Id = "b", Name = "B" })));
        Assert.Equal("", DestinationHierarchy.Trail("U", "C", null));
    }

    [Fact]
    public void Session_and_access_errors_have_their_own_friendly_messages()
    {
        Assert.Contains("sign in", CampusErrorMapper.ToUserMessage(new UnivastApiException("x", 401)));
        Assert.Contains("access", CampusErrorMapper.ToUserMessage(new UnivastApiException("x", 403)));
    }
}

public class CampusSearchBehaviourTests
{
    private static (CampusMapViewModel Vm, FakeCampusApi Api, FakePlaceSearch Places, List<CameraRequest> Cameras) Create(
        Action<FakeCampusApi>? configureApi = null, Action<FakePlaceSearch>? configurePlaces = null, bool withPlaces = true,
        Action<FakeLocationProvider>? configureLocation = null, int campuses = 1)
    {
        var api = new FakeCampusApi();
        api.Campuses = () => Enumerable.Range(1, campuses).Select(i => Sample.Campus(i == 1 ? "c1" : $"c{i}")).ToList();
        api.Buildings = _ => new() { Sample.Building() };
        api.Landmarks = _ => new() { Sample.Landmark() };
        configureApi?.Invoke(api);
        var places = new FakePlaceSearch();
        configurePlaces?.Invoke(places);
        var location = new FakeLocationProvider();
        configureLocation?.Invoke(location);

        var vm = new CampusMapViewModel(api, location, places: withPlaces ? places : null) { SearchDebounce = TimeSpan.Zero, LocateThrottle = TimeSpan.Zero };
        var cameras = new List<CameraRequest>();
        vm.CameraRequested += (_, r) => cameras.Add(r);
        return (vm, api, places, cameras);
    }

    // ---- what the app sends ------------------------------------------------------------------------------------

    [Theory]
    [InlineData("lt1", "lt1")]
    [InlineData("LT1", "LT1")]
    [InlineData("  Lecture   Theater  1 ", "Lecture Theater 1")]
    public async Task The_query_is_sent_trimmed_and_otherwise_exactly_as_typed(string typed, string expectedSent)
    {
        var (vm, api, _, _) = Create();
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync(typed);

        Assert.Equal(new[] { expectedSent }, api.SearchQueries.ToArray());
    }

    [Fact]
    public async Task Results_for_aliases_are_rendered_exactly_as_the_backend_returns_them()
    {
        // The app has no alias table: whatever alias the user types, it is the backend that resolves it.
        var (vm, _, _, _) = Create(a => a.Search = (_, q) => new()
        {
            Results = new() { Sample.RoomHit("r1", "Hall 1") },
        });
        await vm.OpenFirstCampusAsync();

        foreach (var typed in new[] { "lt1", "LT 1", "Lecture Theater 1" })
        {
            await vm.SearchAsync(typed);
            Assert.Equal("r1", vm.SearchSections.Single().Items.Single().Result.Id);
        }
    }

    [Fact]
    public async Task The_search_is_scoped_to_the_selected_campus_only()
    {
        string? seen = null;
        var (vm, _, _, _) = Create(a => a.Search = (campusId, _) => { seen = campusId; return new() { Results = new() }; });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("block");

        Assert.Equal("c1", seen);
    }

    [Fact]
    public async Task Search_does_not_download_the_campus_database()
    {
        var (vm, api, _, _) = Create();
        await vm.OpenFirstCampusAsync();
        var buildingCalls = api.BuildingCalls;
        var landmarkCalls = api.LandmarkCalls;

        await vm.SearchAsync("block");
        await vm.SearchAsync("blocks");

        Assert.Equal(buildingCalls, api.BuildingCalls);
        Assert.Equal(landmarkCalls, api.LandmarkCalls);
    }

    // ---- stale responses & debounce ------------------------------------------------------------------------------

    [Fact]
    public async Task An_older_slow_response_can_never_overwrite_a_newer_search()
    {
        var gates = new Dictionary<string, TaskCompletionSource<CampusSearchResponseDto>>();
        var (vm, api, _, _) = Create(a => a.SearchAsyncOverride = (_, q, ct) =>
        {
            var tcs = new TaskCompletionSource<CampusSearchResponseDto>();
            gates[q] = tcs;
            return tcs.Task; // deliberately ignores cancellation, like a slow server that answers anyway
        });
        await vm.OpenFirstCampusAsync();

        var first = vm.SearchAsync("lt");
        var second = vm.SearchAsync("lt1");

        gates["lt1"].SetResult(new() { Results = new() { Sample.RoomHit("new", "Newest") } });
        await second;
        gates["lt"].SetResult(new() { Results = new() { Sample.RoomHit("old", "Oldest") } });
        await first;

        Assert.Equal("new", vm.SearchSections.Single().Items.Single().Result.Id);
        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
    }

    [Fact]
    public async Task A_stale_failure_does_not_replace_a_newer_success()
    {
        var gates = new Dictionary<string, TaskCompletionSource<CampusSearchResponseDto>>();
        var (vm, _, _, _) = Create(a => a.SearchAsyncOverride = (_, q, _) => (gates[q] = new()).Task);
        await vm.OpenFirstCampusAsync();

        var first = vm.SearchAsync("a1");
        var second = vm.SearchAsync("a12");
        gates["a12"].SetResult(new() { Results = new() { Sample.RoomHit() } });
        await second;
        gates["a1"].SetException(new HttpRequestException("late failure"));
        await first;

        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
        Assert.Null(vm.SearchMessage);
    }

    [Fact]
    public async Task Typing_quickly_sends_one_request_for_the_final_text()
    {
        var (vm, api, _, _) = Create();
        vm.SearchDebounce = TimeSpan.FromMilliseconds(120);
        await vm.OpenFirstCampusAsync();

        var a = vm.SearchAsync("l");
        var b = vm.SearchAsync("lt");
        var c = vm.SearchAsync("lt1");
        await Task.WhenAll(a, b, c);

        Assert.Equal(new[] { "lt1" }, api.SearchQueries.ToArray());
    }

    [Fact]
    public async Task Clearing_the_box_while_a_search_is_in_flight_leaves_the_search_idle()
    {
        var gate = new TaskCompletionSource<CampusSearchResponseDto>();
        var (vm, _, _, _) = Create(a => a.SearchAsyncOverride = (_, _, _) => gate.Task);
        await vm.OpenFirstCampusAsync();

        var pending = vm.SearchAsync("block");
        await vm.SearchAsync("");
        gate.SetResult(new() { Results = new() { Sample.RoomHit() } });
        await pending;

        Assert.Equal(SearchStatus.Idle, vm.SearchStatus);
        Assert.Empty(vm.SearchSections);
    }

    [Fact]
    public async Task Search_now_skips_the_debounce()
    {
        var (vm, api, _, _) = Create();
        vm.SearchDebounce = TimeSpan.FromSeconds(30);
        await vm.OpenFirstCampusAsync();

        await vm.SearchNowAsync("block");

        Assert.Equal(1, api.SearchCalls);
    }

    // ---- caching ---------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Repeating_a_search_is_answered_from_the_cache_regardless_of_case_and_spacing()
    {
        var (vm, api, _, _) = Create(a => a.Search = (_, _) => new() { Results = new() { Sample.RoomHit() } });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("lt1");
        await vm.SearchAsync("  LT1 ");

        Assert.Equal(1, api.SearchCalls);
        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
    }

    [Fact]
    public async Task Failures_are_never_cached_so_retry_really_retries()
    {
        var fail = true;
        var (vm, api, _, _) = Create(a => a.Search = (_, _) => fail ? throw new HttpRequestException("x") : new() { Results = new() { Sample.RoomHit() } });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("hall");
        fail = false;
        await vm.SearchNowAsync("hall");

        Assert.Equal(2, api.SearchCalls);
        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
    }

    // ---- empty / failures --------------------------------------------------------------------------------------------

    [Fact]
    public async Task No_results_uses_the_documented_wording()
    {
        var (vm, _, _, _) = Create();
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("zzzz");

        Assert.Equal(SearchStatus.Empty, vm.SearchStatus);
        Assert.Equal("Try a place, address, building, room number, landmark, or abbreviation.", vm.SearchMessage);
    }

    [Theory]
    [InlineData(500)]
    [InlineData(503)]
    [InlineData(429)]
    [InlineData(401)]
    public async Task Server_and_session_errors_become_friendly_messages_with_retry(int status)
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => throw new UnivastApiException("stack trace at Foo.Bar()", status));
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("block");

        Assert.Equal(SearchStatus.Failed, vm.SearchStatus);
        Assert.True(vm.ShowSearchFailed);
        Assert.DoesNotContain("stack trace", vm.SearchMessage);
        Assert.Empty(vm.SearchSections);
    }

    [Fact]
    public async Task A_timeout_is_explained_without_exception_text()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => throw new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout"));
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("block");

        Assert.Equal(SearchStatus.Failed, vm.SearchStatus);
        Assert.Contains("too long", vm.SearchMessage);
        Assert.DoesNotContain("HttpClient", vm.SearchMessage);
    }

    [Fact]
    public async Task A_malformed_response_is_a_friendly_error()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => throw new System.Text.Json.JsonException("'<' is an invalid start of a value"));
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("block");

        Assert.Equal(SearchStatus.Failed, vm.SearchStatus);
        Assert.Contains("couldn't read", vm.SearchMessage);
    }

    [Fact]
    public async Task An_empty_response_body_with_no_results_property_is_just_no_results()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => new CampusSearchResponseDto());
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("x");

        Assert.Equal(SearchStatus.Empty, vm.SearchStatus);
    }

    [Fact]
    public async Task The_ambiguity_flag_from_the_backend_is_surfaced()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => new() { Ambiguous = true, Results = new() { Sample.RoomHit("r1"), Sample.RoomHit("r2") } });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("lt1");

        Assert.True(vm.ShowAmbiguityHint);

        await vm.SearchAsync("");
        Assert.False(vm.ShowAmbiguityHint);
    }

    // ---- existing places/businesses ---------------------------------------------------------------------------------

    [Fact]
    public async Task Existing_places_appear_as_a_separate_section_searched_around_the_campus_centre()
    {
        var (vm, _, places, _) = Create(
            a => a.Search = (_, _) => new() { Results = new() { Sample.RoomHit() } },
            p => p.Results = _ => new[] { new CampusSearchResultDto { Kind = "place", Id = "p1", Name = "Campus Cafe", Category = "Food" } });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("cafe");

        Assert.Equal(new[] { "ROOMS", "NEARBY PLACES" }, vm.SearchSections.Select(s => s.Title).ToArray());
        var call = Assert.Single(places.Calls);
        Assert.Equal(1, call.Lat); // the selected campus's own centre (Sample.Campus), not the device and not invented
        Assert.Equal(2, call.Lng);
    }

    [Fact]
    public async Task A_places_failure_never_breaks_campus_results()
    {
        var (vm, _, _, _) = Create(
            a => a.Search = (_, _) => new() { Results = new() { Sample.RoomHit() } },
            p => p.Results = _ => throw new HttpRequestException("places down"));
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("hall");

        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
        Assert.Equal("ROOMS", vm.SearchSections.Single().Title);
    }

    [Fact]
    public async Task Places_alone_are_enough_to_show_results()
    {
        var (vm, _, _, _) = Create(configurePlaces: p => p.Results = _ => new[] { new CampusSearchResultDto { Kind = "place", Id = "p1", Name = "Campus Cafe" } });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("cafe");

        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
    }

    [Fact]
    public async Task One_character_queries_skip_the_places_search_but_still_search_the_campus()
    {
        var (vm, api, places, _) = Create();
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("a");

        Assert.Equal(1, api.SearchCalls);
        Assert.Empty(places.Calls);
    }

    [Fact]
    public async Task Choosing_a_place_opens_its_own_screen_and_does_not_open_a_campus_destination()
    {
        var (vm, api, _, cameras) = Create();
        await vm.OpenFirstCampusAsync();
        string? opened = null;
        vm.PlaceRequested += (_, id) => opened = id;
        vm.OpenSearchCommand.Execute(null);
        cameras.Clear();

        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "place", Id = "p1", Name = "Campus Cafe" });

        Assert.Equal("p1", opened);
        Assert.False(vm.IsSearchOpen);
        Assert.Null(vm.Destination);
        Assert.Empty(cameras);
        Assert.Equal(0, api.RouteCalls);
    }

    [Fact]
    public async Task Without_a_places_service_campus_search_still_works()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => new() { Results = new() { Sample.RoomHit() } }, withPlaces: false);
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("hall");

        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
    }

    // ---- selecting results -------------------------------------------------------------------------------------------

    [Fact]
    public async Task Selecting_a_room_shows_the_university_campus_building_floor_trail()
    {
        var (vm, _, _, _) = Create(a => a.RoomDetail = id => new CampusRoomDetailDto
        {
            Id = id, Name = "Hall 1", Type = "lecture_hall",
            Floor = new() { Id = "f1", FloorNumber = 0, Name = "Ground Floor" },
            Building = new() { Id = "b1", Name = "Block One", Latitude = 1.001, Longitude = 2.001 },
        });
        await vm.OpenFirstCampusAsync();

        await vm.SelectSearchResultAsync(Sample.RoomHit());

        Assert.Equal("Test University › Campus c1 › Block One › Ground Floor", vm.DestinationTrail);
        Assert.True(vm.HasDestinationTrail);
    }

    [Fact]
    public async Task A_room_hit_without_coordinates_is_resolved_through_its_detail_record()
    {
        var hit = Sample.RoomHit();
        hit.Latitude = null;
        hit.Longitude = null;
        var (vm, _, _, cameras) = Create(a => a.RoomDetail = id => new CampusRoomDetailDto
        {
            Id = id, Name = "Hall 1", Type = "lecture_hall",
            Building = new() { Id = "b1", Name = "Block One", Latitude = 1.5, Longitude = 2.5 },
        });
        await vm.OpenFirstCampusAsync();
        cameras.Clear();

        await vm.SelectSearchResultAsync(hit);

        var move = Assert.Single(cameras, c => c.Target == CameraTarget.Point);
        Assert.Equal(1.5, move.Latitude);
        Assert.Equal(2.5, move.Longitude);
        Assert.Null(vm.DestinationError);
    }

    [Fact]
    public async Task A_result_with_no_resolvable_position_says_so_and_does_not_invent_one()
    {
        var hit = Sample.RoomHit();
        hit.Latitude = null;
        hit.Longitude = null;
        var (vm, _, _, cameras) = Create(a => a.RoomDetail = id => new CampusRoomDetailDto { Id = id, Name = "Hall 1" });
        await vm.OpenFirstCampusAsync();
        cameras.Clear();

        await vm.SelectSearchResultAsync(hit);

        Assert.DoesNotContain(cameras, c => c.Target == CameraTarget.Point);
        Assert.Contains("map position", vm.DestinationError);
        Assert.NotNull(vm.Destination);
    }

    [Fact]
    public async Task Selecting_a_landmark_and_a_building_result_focuses_the_map_and_keeps_navigation_available()
    {
        var (vm, _, _, cameras) = Create(a => a.BuildingDetail = id => new CampusBuildingDetailDto { Id = id, Name = "Block One", Latitude = 1.001, Longitude = 2.001 });
        await vm.OpenFirstCampusAsync();
        cameras.Clear();

        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "landmark", Id = "l1", Name = "Gate", Category = "gate", Latitude = 1, Longitude = 2 });
        Assert.Equal(DestinationKind.Landmark, vm.Destination!.Kind);
        Assert.Equal(CameraTarget.Point, cameras.Last().Target);

        await vm.SelectSearchResultAsync(new CampusSearchResultDto { Kind = "building", Id = "b1", Name = "Block One", Latitude = 1.001, Longitude = 2.001 });
        Assert.Equal(DestinationKind.Building, vm.Destination!.Kind);
        Assert.True(vm.Destination.CanNavigate);
        Assert.Equal("b1", vm.SelectedMapItemId);
    }

    [Fact]
    public async Task Selecting_a_room_then_navigating_hands_off_to_the_route_endpoint_with_the_room_id()
    {
        var (vm, api, _, _) = Create(configureLocation: l => l.Result = FakeLocationProvider.At(1.0002, 2.0003, 6));
        await vm.OpenFirstCampusAsync();
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        await vm.NavigateFromHereAsync();

        var (from, to) = Assert.Single(api.RouteRequests);
        Assert.Equal(1.0002, from.Latitude);
        Assert.Equal("r1", to.RoomId);
    }

    // ---- campuses and away-from-campus ---------------------------------------------------------------------------------

    [Fact]
    public async Task Switching_campus_clears_results_and_the_cache_and_the_next_search_targets_the_new_campus()
    {
        var seen = new List<string>();
        var (vm, api, _, _) = Create(a => a.Search = (campusId, _) => { seen.Add(campusId); return new() { Results = new() { Sample.RoomHit() } }; }, campuses: 2);
        await vm.InitializeAsync();                       // two campuses, no location -> picker
        await vm.ChooseCampusAsync(vm.CampusChoices[0]);
        await vm.SearchAsync("hall");
        Assert.Equal(SearchStatus.Results, vm.SearchStatus);

        await vm.ChooseCampusAsync(vm.CampusChoices[1]);

        Assert.Equal(SearchStatus.Idle, vm.SearchStatus);
        Assert.Empty(vm.SearchSections);
        Assert.Equal("", vm.SearchText);

        await vm.SearchAsync("hall"); // same words, different campus: must not be served from the old campus's cache
        Assert.Equal(new[] { "c1", "c2" }, seen.ToArray());
        Assert.Equal(2, api.SearchCalls);
    }

    [Fact]
    public async Task A_search_still_in_flight_when_the_campus_changes_is_dropped()
    {
        var gate = new TaskCompletionSource<CampusSearchResponseDto>();
        var (vm, _, _, _) = Create(a => a.SearchAsyncOverride = (_, _, _) => gate.Task, campuses: 2);
        await vm.InitializeAsync();
        await vm.ChooseCampusAsync(vm.CampusChoices[0]);

        var pending = vm.SearchAsync("hall");
        await vm.ChooseCampusAsync(vm.CampusChoices[1]);
        gate.SetResult(new() { Results = new() { Sample.RoomHit("from-old-campus") } });
        await pending;

        Assert.Empty(vm.SearchSections);
        Assert.Equal(SearchStatus.Idle, vm.SearchStatus);
    }

    [Fact]
    public async Task Away_from_campus_search_and_selection_work_and_the_camera_never_goes_to_the_user()
    {
        var (vm, api, _, cameras) = Create(
            a =>
            {
                a.Locate = (_, _, _) => new() { Status = "outside" };
                a.Search = (_, _) => new() { Results = new() { Sample.RoomHit() } };
            },
            configureLocation: l => l.Result = FakeLocationProvider.At(40, -70));

        await vm.InitializeAsync();
        cameras.Clear(); // start-up may move the camera to the user on the plain map; opening a campus must not
        await vm.ChooseCampusAsync(vm.CampusChoices[0]);
        await vm.SearchAsync("hall");
        await vm.SelectSearchResultAsync(Sample.RoomHit());

        Assert.True(vm.Presence.IsAway);
        Assert.Equal(40, vm.UserFix!.Latitude);          // real position kept separately
        Assert.Equal("r1", vm.Destination!.Id);
        Assert.DoesNotContain(cameras, c => c.Target == CameraTarget.User);
        Assert.Equal(1.001, cameras.Last().Latitude);    // the destination, not the device
    }

    [Fact]
    public async Task Searching_works_with_location_denied()
    {
        var (vm, _, _, _) = Create(a => a.Search = (_, _) => new() { Results = new() { Sample.RoomHit() } });
        await vm.OpenFirstCampusAsync();

        await vm.SearchAsync("hall");

        Assert.Null(vm.UserFix);
        Assert.Equal(SearchStatus.Results, vm.SearchStatus);
    }
}

public class PlaceSearchAdapterTests
{
    [Fact]
    public async Task Maps_places_to_search_hits_using_their_own_stored_coordinates_and_ignores_incomplete_rows()
    {
        var handler = new StubHandler((_, _) => Responses.Json(System.Net.HttpStatusCode.OK, """
            {"data":[{"_id":"p1","name":"Campus Cafe","address":"Gate Road","location":{"type":"Point","coordinates":[8.33,4.95]},"category":{"_id":"c","name":"Food","slug":"food"}},
                     {"_id":"","name":"No id","location":{"type":"Point","coordinates":[1,2]}}],
             "pagination":{"page":1,"limit":20,"hasNextPage":false}}
            """));
        var adapter = new PlaceSearchAdapter(new DiscoveryApiService(new HttpClient(handler) { BaseAddress = new Uri("https://api.test/") }));

        var hits = await adapter.SearchAsync(4.9, 8.3, "cafe");

        var hit = Assert.Single(hits);
        Assert.Equal("place", hit.Kind);
        Assert.Equal("Campus Cafe", hit.Name);
        Assert.Equal("Food", hit.Category);
        Assert.Equal(4.95, hit.Latitude);
        Assert.Equal(8.33, hit.Longitude);
        var url = handler.Calls.Single().Request.RequestUri!.AbsoluteUri;
        Assert.Contains("lat=4.9&lng=8.3", url);
        Assert.Contains("q=cafe", url);
    }
}
