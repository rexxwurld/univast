using System.Net.Http;
using System.Text.Json;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

public class CampusSelectorTests
{
    private static CampusSummaryDto Campus(string id, bool geofence = true) => new() { Id = id, Name = $"Campus {id}", GeofenceConfigured = geofence };
    private static CampusLocateResultDto At(string status) => new() { Status = status };
    private static Dictionary<string, CampusLocateResultDto> Results(params (string Id, string Status)[] rows) =>
        rows.ToDictionary(r => r.Id, r => At(r.Status));

    [Fact]
    public void No_campuses_is_reported_not_invented()
    {
        var d = CampusSelector.Decide(new List<CampusSummaryDto>(), Results());
        Assert.Equal(CampusSelectionKind.NoCampuses, d.Kind);
        Assert.Null(d.Campus);
    }

    [Fact]
    public void Campuses_without_an_id_or_name_are_ignored()
    {
        var d = CampusSelector.Decide(new[] { new CampusSummaryDto { Name = "x" } }, Results());
        Assert.Equal(CampusSelectionKind.NoCampuses, d.Kind);
    }

    [Fact]
    public void Picks_the_one_campus_the_device_is_inside()
    {
        var d = CampusSelector.Decide(new[] { Campus("a"), Campus("b") }, Results(("a", "outside"), ("b", "inside")));
        Assert.Equal(CampusSelectionKind.Selected, d.Kind);
        Assert.Equal("b", d.Campus!.Id);
    }

    [Fact]
    public void Picks_the_one_campus_the_device_is_near_when_none_is_inside()
    {
        var d = CampusSelector.Decide(new[] { Campus("a"), Campus("b") }, Results(("a", "outside"), ("b", "near")));
        Assert.Equal("b", d.Campus!.Id);
    }

    [Fact]
    public void Inside_beats_near()
    {
        var d = CampusSelector.Decide(new[] { Campus("a"), Campus("b") }, Results(("a", "near"), ("b", "inside")));
        Assert.Equal("b", d.Campus!.Id);
    }

    [Fact]
    public void Overlapping_matches_ask_the_user_instead_of_guessing()
    {
        var d = CampusSelector.Decide(new[] { Campus("a"), Campus("b"), Campus("c") }, Results(("a", "inside"), ("b", "inside"), ("c", "outside")));
        Assert.Equal(CampusSelectionKind.NeedsUserChoice, d.Kind);
        Assert.Equal(new[] { "a", "b" }, d.Candidates.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void A_single_campus_is_opened_even_when_the_user_is_away()
    {
        var d = CampusSelector.Decide(new[] { Campus("only") }, Results(("only", "outside")));
        Assert.Equal(CampusSelectionKind.Selected, d.Kind);
        Assert.Equal("only", d.Campus!.Id);
    }

    [Fact]
    public void Several_campuses_and_no_match_means_the_user_chooses()
    {
        var d = CampusSelector.Decide(new[] { Campus("a"), Campus("b") }, Results(("a", "outside"), ("b", "outside")));
        Assert.Equal(CampusSelectionKind.NeedsUserChoice, d.Kind);
        Assert.Equal(2, d.Candidates.Count);
    }

    [Fact]
    public void Several_campuses_and_no_location_means_the_user_chooses()
    {
        var d = CampusSelector.Decide(new[] { Campus("a"), Campus("b") }, Results());
        Assert.Equal(CampusSelectionKind.NeedsUserChoice, d.Kind);
    }

    [Fact]
    public void An_unknown_boundary_never_counts_as_a_match()
    {
        var d = CampusSelector.Decide(new[] { Campus("a"), Campus("b") }, Results(("a", "unknown"), ("b", "unknown")));
        Assert.Equal(CampusSelectionKind.NeedsUserChoice, d.Kind);
    }
}

public class CampusPresenceTests
{
    [Fact]
    public void Away_uses_the_honest_message_and_never_claims_the_user_is_on_campus()
    {
        var s = CampusPresenceMapper.From(new CampusLocateResultDto { Status = "outside" }, LocationAvailability.Available);
        Assert.Equal(CampusPresence.AwayFromCampus, s.Presence);
        Assert.Equal("You’re away from this campus", s.Title);
        Assert.True(s.IsAway);
        Assert.Contains("explore", s.Detail);
    }

    [Theory]
    [InlineData("inside", CampusPresence.OnCampus)]
    [InlineData("near", CampusPresence.NearCampus)]
    [InlineData("unknown", CampusPresence.BoundaryNotConfigured)]
    [InlineData("something-new", CampusPresence.BoundaryNotConfigured)]
    public void Maps_backend_statuses(string status, CampusPresence expected)
    {
        Assert.Equal(expected, CampusPresenceMapper.From(new CampusLocateResultDto { Status = status }, LocationAvailability.Available).Presence);
    }

    [Theory]
    [InlineData(LocationAvailability.PermissionDenied)]
    [InlineData(LocationAvailability.PermissionRestricted)]
    [InlineData(LocationAvailability.ServicesDisabled)]
    [InlineData(LocationAvailability.Unavailable)]
    public void Without_a_location_presence_is_unknown_and_exploring_is_still_offered(LocationAvailability why)
    {
        var s = CampusPresenceMapper.From(null, why);
        Assert.Equal(CampusPresence.Unknown, s.Presence);
        Assert.Contains("explore", s.Detail);
    }

    [Fact]
    public void Low_accuracy_is_called_out()
    {
        var s = CampusPresenceMapper.From(new CampusLocateResultDto { Status = "inside", Ambiguous = true }, LocationAvailability.Available);
        Assert.Contains("accuracy", s.Detail, StringComparison.OrdinalIgnoreCase);
    }
}

public class SearchGroupingTests
{
    private static CampusSearchResultDto R(string kind, string id, string name, string? category = null) => new() { Kind = kind, Id = id, Name = name, Category = category };

    [Fact]
    public void Groups_into_labelled_sections_in_a_stable_order()
    {
        var response = new CampusSearchResponseDto
        {
            Results = new()
            {
                R("landmark", "l1", "Demo Main Gate", "gate"),
                R("room", "r1", "LT1", "lecture_hall"),
                R("building", "b1", "Test Science Block", "faculty"),
                R("location", "x1", "Demo ATM", "atm"),
            },
        };

        var sections = SearchResultGrouper.Group(response);

        // The section with the backend's best hit (landmark) comes first; the rest keep the fixed order.
        Assert.Equal(new[] { "LANDMARKS", "BUILDINGS", "ROOMS", "PLACES" }, sections.Select(s => s.Title).ToArray());
    }

    [Fact]
    public void Keeps_the_backend_order_within_a_section_and_does_not_rerank()
    {
        var response = new CampusSearchResponseDto { Results = new() { R("room", "r2", "B"), R("room", "r1", "A") } };
        var items = SearchResultGrouper.Group(response).Single().Items;
        Assert.Equal(new[] { "r2", "r1" }, items.Select(i => i.Result.Id).ToArray());
    }

    [Fact]
    public void Null_empty_and_invalid_results_give_no_sections()
    {
        Assert.Empty(SearchResultGrouper.Group(null));
        Assert.Empty(SearchResultGrouper.Group(new CampusSearchResponseDto()));
        Assert.Empty(SearchResultGrouper.Group(new CampusSearchResponseDto { Results = new() { R("room", "", "x"), R("room", "r1", "") } }));
    }

    [Fact]
    public void Unknown_kinds_are_not_dropped()
    {
        var sections = SearchResultGrouper.Group(new CampusSearchResponseDto { Results = new() { R("hologram", "h1", "H") } });
        Assert.Equal("OTHER", sections.Single().Title);
    }

    [Fact]
    public void Room_subtitle_is_building_and_floor_and_others_use_the_category()
    {
        var room = new CampusSearchResultDto
        {
            Kind = "room", Id = "r1", Name = "LT1", Category = "lecture_hall",
            Building = new() { Id = "b1", Name = "Test Science Block" }, Floor = new() { Id = "f1", FloorNumber = 0, Name = "Ground Floor" },
        };
        Assert.Equal("Test Science Block · Ground Floor", SearchResultGrouper.Subtitle(room));
        Assert.Equal("Lecture hall", SearchResultGrouper.Subtitle(R("building", "b", "X", "lecture_hall")));
        Assert.Equal("ATM", SearchResultGrouper.Subtitle(R("location", "x", "X", "atm")));
        Assert.Equal("Place", SearchResultGrouper.Subtitle(R("location", "x", "X")));
    }
}

public class DestinationAndHandoffTests
{
    private static CampusRoomDetailDto Room() => new()
    {
        Id = "r1", Name = "LT1", Type = "lecture_hall", Aliases = new() { "LT1", "Lecture Theatre 1", "Lecture Theater 1", "Test LT1" },
        Floor = new() { Id = "f1", FloorNumber = 0, Name = "Ground Floor" },
        Building = new() { Id = "b1", Name = "Test Science Block", Latitude = 0.001, Longitude = 0.00025 },
        DataSource = "DEV_FIXTURE",
    };

    [Fact]
    public void Room_destination_shows_building_floor_and_aliases_without_repeating_its_own_name()
    {
        var d = DestinationBuilder.FromRoom(Room());

        Assert.Equal("LT1", d.Title);
        Assert.Equal("Test Science Block · Ground Floor", d.Subtitle);
        Assert.Equal(new[] { "Lecture Theatre 1", "Lecture Theater 1", "Test LT1" }, d.Aliases.ToArray());
        Assert.Equal("b1", d.BuildingId);
        Assert.Equal(0.001, d.Latitude);
        Assert.True(d.CanNavigate);
        Assert.True(d.IsDemoData);
    }

    [Fact]
    public void Floor_labels()
    {
        Assert.Equal("Ground Floor", DestinationBuilder.FloorLabel("Ground Floor", 0));
        Assert.Equal("Ground floor", DestinationBuilder.FloorLabel(null, 0));
        Assert.Equal("Floor 2", DestinationBuilder.FloorLabel("", 2));
        Assert.Equal("Basement 1", DestinationBuilder.FloorLabel(null, -1));
        Assert.Null(DestinationBuilder.FloorLabel(null, null));
    }

    [Fact]
    public void Building_destination_reports_floor_count_and_lecture_halls()
    {
        var detail = new CampusBuildingDetailDto
        {
            Id = "b1", Name = "Test Science Block", Type = "faculty", Latitude = 1, Longitude = 2,
            Aliases = new() { "Test Science" },
            Floors = new() { new() { Id = "f1", FloorNumber = 0 }, new() { Id = "f2", FloorNumber = 1 } },
            Rooms = new() { new() { Name = "LT1", Type = "lecture_hall" }, new() { Name = "Office", Type = "office" } },
        };

        var d = DestinationBuilder.FromBuilding(detail, detail);

        Assert.Equal(2, d.FloorCount);
        Assert.Equal(new[] { "LT1" }, d.NotableRooms.ToArray());
        Assert.Equal("Faculty", d.TypeLabel);
        Assert.True(d.DetailsLoaded);
    }

    [Fact]
    public void A_legacy_place_is_shown_but_cannot_be_navigated_to()
    {
        var d = DestinationBuilder.FromSearchResult(new CampusSearchResultDto { Kind = "location", Id = "x", Name = "Demo ATM", Category = "atm" });
        Assert.False(d.CanNavigate);
        Assert.NotNull(d.CannotNavigateReason);
        Assert.Equal(HandoffKind.NotRoutable, NavigationHandoff.Plan(d, new LocationFix(0, 0, null, DateTimeOffset.UtcNow), LocationAvailability.Available).Kind);
    }

    [Fact]
    public void A_landmark_with_no_graph_node_cannot_be_routed_to()
    {
        var d = DestinationBuilder.FromLandmark(new CampusLandmarkDto { Id = "l1", Name = "Fountain" });
        Assert.False(d.CanNavigate);
        Assert.Null(NavigationHandoff.TargetFor(d));
    }

    [Fact]
    public void Real_location_means_the_route_starts_from_the_device()
    {
        var d = DestinationBuilder.FromRoom(Room());
        var plan = NavigationHandoff.Plan(d, new LocationFix(0.0001, 0.0, 12, DateTimeOffset.UtcNow), LocationAvailability.Available);

        Assert.Equal(HandoffKind.RouteFromDevice, plan.Kind);
        Assert.Equal("r1", plan.Target!.RoomId);
        Assert.Null(plan.Target.BuildingId);
    }

    [Fact]
    public void Zero_zero_is_a_valid_real_coordinate()
    {
        var d = DestinationBuilder.FromRoom(Room());
        Assert.Equal(HandoffKind.RouteFromDevice, NavigationHandoff.Plan(d, new LocationFix(0, 0, null, DateTimeOffset.UtcNow), LocationAvailability.Available).Kind);
    }

    [Theory]
    [InlineData(double.NaN, 0)]
    [InlineData(91, 0)]
    [InlineData(0, 181)]
    public void Invalid_coordinates_are_never_used_as_an_origin(double lat, double lng)
    {
        var d = DestinationBuilder.FromRoom(Room());
        var plan = NavigationHandoff.Plan(d, new LocationFix(lat, lng, null, DateTimeOffset.UtcNow), LocationAvailability.Available);
        Assert.Equal(HandoffKind.NeedsStartPoint, plan.Kind);
    }

    [Theory]
    [InlineData(LocationAvailability.PermissionDenied, "turned off")]
    [InlineData(LocationAvailability.PermissionRestricted, "turned off")]
    [InlineData(LocationAvailability.ServicesDisabled, "services")]
    [InlineData(LocationAvailability.Unavailable, "can't find your location")]
    public void Without_location_the_user_is_offered_a_starting_point_instead(LocationAvailability why, string expected)
    {
        var d = DestinationBuilder.FromRoom(Room());
        var plan = NavigationHandoff.Plan(d, null, why);

        Assert.Equal(HandoffKind.NeedsStartPoint, plan.Kind);
        Assert.Contains(expected, plan.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("starting point", plan.Message);
    }
}

public class CampusBoundsTests
{
    [Fact]
    public void Bounds_cover_the_campus_centre_buildings_entrances_and_landmarks()
    {
        var campus = new CampusSummaryDto { Id = "c", Name = "C", Latitude = 0.0005, Longitude = 0.0006 };
        var buildings = new[]
        {
            new CampusBuildingDto { Latitude = 0.001, Longitude = 0.00025, Entrances = new() { new() { Latitude = 0.001, Longitude = 0.0004 } } },
        };
        var landmarks = new[] { new CampusLandmarkDto { Latitude = 0, Longitude = 0 }, new CampusLandmarkDto { Latitude = 0.0005, Longitude = 0.0009 } };

        var b = CampusBounds.Compute(campus, buildings, landmarks);

        Assert.Equal(0, b.MinLat);
        Assert.Equal(0.001, b.MaxLat);
        Assert.Equal(0, b.MinLng);
        Assert.Equal(0.0009, b.MaxLng);
        Assert.False(b.IsPoint);
    }

    [Fact]
    public void With_no_markers_the_bounds_are_the_campus_centre_only()
    {
        var b = CampusBounds.Compute(new CampusSummaryDto { Id = "c", Name = "C", Latitude = 4.9, Longitude = 8.3 }, Array.Empty<CampusBuildingDto>(), Array.Empty<CampusLandmarkDto>());
        Assert.True(b.IsPoint);
        Assert.Equal(4.9, b.MinLat);
    }

    [Fact]
    public void Invalid_coordinates_are_ignored()
    {
        var campus = new CampusSummaryDto { Id = "c", Name = "C", Latitude = 1, Longitude = 1 };
        var b = CampusBounds.Compute(campus, new[] { new CampusBuildingDto { Latitude = double.NaN, Longitude = 5 }, new CampusBuildingDto { Latitude = 200, Longitude = 5 } }, Array.Empty<CampusLandmarkDto>());
        Assert.True(b.IsPoint);
    }

    [Fact]
    public void Zoom_level_zero_is_the_whole_world_in_one_tile()
    {
        Assert.Equal(156543.03392804097, CampusBounds.ResolutionForZoom(0), 6);
        Assert.Equal(CampusBounds.ResolutionForZoom(17) / 2, CampusBounds.ResolutionForZoom(18), 9);
    }
}

public class CampusErrorMapperTests
{
    [Theory]
    [InlineData(500, "server had a problem")]
    [InlineData(503, "server had a problem")]
    [InlineData(404, "couldn't find")]
    [InlineData(429, "Too many requests")]
    public void Api_errors_become_friendly_text(int status, string expected)
    {
        Assert.Contains(expected, CampusErrorMapper.ToUserMessage(new UnivastApiException("boom", status)), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validation_messages_from_the_backend_are_passed_through()
    {
        Assert.Equal("q is required", CampusErrorMapper.ToUserMessage(new UnivastApiException("q is required", 400)));
    }

    [Fact]
    public void Network_failures_and_timeouts_are_explained_without_exception_text()
    {
        var offline = CampusErrorMapper.ToUserMessage(new HttpRequestException("Name or service not known: api.example.com"));
        Assert.Contains("internet", offline, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("service not known", offline);

        Assert.Contains("too long", CampusErrorMapper.ToUserMessage(new TaskCanceledException("The request was canceled")), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Malformed_data_never_leaks_the_parser_message()
    {
        var message = CampusErrorMapper.ToUserMessage(new JsonException("'<' is an invalid start of a value. LineNumber: 0"));
        Assert.Contains("couldn't read", message);
        Assert.DoesNotContain("LineNumber", message);
    }

    [Fact]
    public void Unexpected_exceptions_get_a_generic_message()
    {
        var message = CampusErrorMapper.ToUserMessage(new InvalidOperationException("secret stack detail"), "search this campus");
        Assert.Equal("Couldn't search this campus. Please try again.", message);
    }
}
