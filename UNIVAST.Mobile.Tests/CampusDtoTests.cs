using System.Text.Json;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Tests;

/// <summary>JSON bodies below mirror the real Phase 2 backend responses (campusDataController / campusSearchService).</summary>
public class CampusDtoTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Campus_summary_maps_every_field_from_the_campuses_endpoint()
    {
        const string json = """
        [{"id":"c1","name":"Main Campus","description":"d","latitude":0.0005,"longitude":0.0006,
          "university":{"id":"u1","name":"UNIVAST Demo University","abbreviation":"DEMO"},
          "geofenceConfigured":true,"mapMetadata":{"defaultZoom":18,"minZoom":15,"maxZoom":20,"notes":"DEV_FIXTURE"},
          "packVersion":0,"dataSource":"DEV_FIXTURE"}]
        """;

        var campus = JsonSerializer.Deserialize<List<CampusSummaryDto>>(json, Web)!.Single();

        Assert.Equal("c1", campus.Id);
        Assert.Equal("Main Campus", campus.Name);
        Assert.Equal(0.0005, campus.Latitude);
        Assert.Equal("UNIVAST Demo University", campus.University!.Name);
        Assert.True(campus.GeofenceConfigured);
        Assert.Equal(18, campus.MapMetadata!.DefaultZoom);
        Assert.Equal("DEV_FIXTURE", campus.DataSource);
        Assert.True(campus.IsValid);
    }

    [Fact]
    public void Campus_summary_tolerates_missing_and_null_fields()
    {
        var campus = JsonSerializer.Deserialize<CampusSummaryDto>("""{"id":"c1","name":"X","university":null,"mapMetadata":null}""", Web)!;

        Assert.Null(campus.University);
        Assert.Null(campus.MapMetadata);
        Assert.False(campus.GeofenceConfigured);
        Assert.True(campus.IsValid);
    }

    [Fact]
    public void Campus_without_an_id_is_not_valid()
    {
        var campus = JsonSerializer.Deserialize<CampusSummaryDto>("""{"name":"X"}""", Web)!;
        Assert.False(campus.IsValid);
    }

    [Fact]
    public void Building_maps_entrances_and_aliases_using_mongo_ids()
    {
        const string json = """
        [{"_id":"b1","campusId":"c1","name":"Test Science Block","abbreviation":"TSB","type":"faculty","description":"",
          "latitude":0.001,"longitude":0.00025,"aliases":["Test Science","Old Science Block"],"dataSource":"DEV_FIXTURE",
          "entrances":[{"_id":"e1","buildingId":"b1","name":"Main Entrance","type":"main","latitude":0.001,"longitude":0.0004,"navigationNodeId":"n1"}]}]
        """;

        var b = JsonSerializer.Deserialize<List<CampusBuildingDto>>(json, Web)!.Single();

        Assert.Equal("b1", b.Id);
        Assert.Equal("faculty", b.Type);
        Assert.Contains("Old Science Block", b.Aliases!);
        var entrance = Assert.Single(b.Entrances!);
        Assert.Equal("e1", entrance.Id);
        Assert.Equal(0.0004, entrance.Longitude);
        Assert.Equal("n1", entrance.NavigationNodeId);
    }

    [Fact]
    public void Building_detail_adds_floors_and_rooms()
    {
        const string json = """
        {"_id":"b1","name":"Test Science Block","latitude":0.001,"longitude":0.00025,"aliases":[],"entrances":[],
         "floors":[{"_id":"f1","floorNumber":0,"name":"Ground Floor"}],
         "rooms":[{"_id":"r1","floorId":"f1","name":"LT1","roomNumber":"LT1","type":"lecture_hall","aliases":["Lecture Theatre 1"]}]}
        """;

        var detail = JsonSerializer.Deserialize<CampusBuildingDetailDto>(json, Web)!;

        Assert.Equal("Ground Floor", detail.Floors!.Single().Name);
        var room = detail.Rooms!.Single();
        Assert.Equal("lecture_hall", room.Type);
        Assert.Equal("Lecture Theatre 1", room.Aliases!.Single());
    }

    [Fact]
    public void Room_detail_carries_its_floor_building_and_entrances()
    {
        const string json = """
        {"_id":"r1","name":"LT1","type":"lecture_hall","aliases":["Lecture Theatre 1","Lecture Theater 1"],
         "floor":{"_id":"f1","floorNumber":0,"name":"Ground Floor"},
         "building":{"_id":"b1","name":"Test Science Block","latitude":0.001,"longitude":0.00025},
         "entrances":[{"_id":"e1","name":"Main Entrance","latitude":0.001,"longitude":0.0004}]}
        """;

        var room = JsonSerializer.Deserialize<CampusRoomDetailDto>(json, Web)!;

        Assert.Equal("Test Science Block", room.Building!.Name);
        Assert.Equal(0, room.Floor!.FloorNumber);
        Assert.Equal(2, room.Aliases!.Count);
        Assert.Single(room.Entrances!);
    }

    [Fact]
    public void Landmark_maps_navigation_node_and_alias_fields()
    {
        const string json = """[{"_id":"l1","name":"Demo Main Gate","type":"gate","latitude":0,"longitude":0,"aliases":["Front Gate"],"navigationNodeId":"n9","dataSource":"DEV_FIXTURE"}]""";

        var l = JsonSerializer.Deserialize<List<CampusLandmarkDto>>(json, Web)!.Single();

        Assert.Equal("l1", l.Id);
        Assert.Equal("gate", l.Type);
        Assert.Equal(0, l.Latitude); // (0,0) is a valid coordinate
        Assert.Equal("n9", l.NavigationNodeId);
    }

    [Fact]
    public void Search_response_maps_rooms_with_building_and_floor_context()
    {
        const string json = """
        {"query":"LT1","ambiguous":false,"category":null,"results":[
          {"kind":"room","id":"r1","name":"LT1","category":"lecture_hall","description":"","score":100,"matchedOn":"lt1","dataSource":"DEV_FIXTURE",
           "building":{"id":"b1","name":"Test Science Block"},"floor":{"id":"f1","floorNumber":0,"name":"Ground Floor"},
           "latitude":0.001,"longitude":0.00025},
          {"kind":"landmark","id":"l1","name":"Demo Main Gate","category":"gate","score":55,"latitude":0,"longitude":0}]}
        """;

        var response = JsonSerializer.Deserialize<CampusSearchResponseDto>(json, Web)!;

        Assert.Equal(2, response.Results!.Count);
        var room = response.Results[0];
        Assert.Equal("room", room.Kind);
        Assert.Equal(100, room.Score);
        Assert.Equal("Test Science Block", room.Building!.Name);
        Assert.Equal(0, room.Floor!.FloorNumber);
        Assert.Equal(0.001, room.Latitude);
        Assert.False(response.Ambiguous);
    }

    [Fact]
    public void Search_response_with_no_results_array_does_not_throw()
    {
        var response = JsonSerializer.Deserialize<CampusSearchResponseDto>("""{"query":"x"}""", Web)!;
        Assert.Null(response.Results);
    }

    [Fact]
    public void Locate_result_maps_the_geofence_answer()
    {
        var r = JsonSerializer.Deserialize<CampusLocateResultDto>(
            """{"status":"outside","method":"polygon","distanceToBoundaryMeters":1234.5,"ambiguous":false,"accuracyMeters":null,"message":"You're currently away from campus."}""", Web)!;

        Assert.Equal(CampusLocateResultDto.Outside, r.Status);
        Assert.Equal(1234.5, r.DistanceToBoundaryMeters);
        Assert.Null(r.AccuracyMeters);
    }

    [Fact]
    public void Route_response_maps_ok_with_instructions_and_away_without_a_route()
    {
        var ok = JsonSerializer.Deserialize<CampusRouteResponseDto>(
            """{"status":"ok","distanceMeters":273,"destination":{"kind":"room","name":"LT1"},"instructions":[{"type":"depart","text":"Walk from Demo Main Gate toward Demo Junction."}],"warnings":[]}""", Web)!;
        Assert.Equal(CampusRouteResponseDto.Ok, ok.Status);
        Assert.Equal(273, ok.DistanceMeters);
        Assert.Equal("Walk from Demo Main Gate toward Demo Junction.", ok.Instructions!.Single().Text);

        var away = JsonSerializer.Deserialize<CampusRouteResponseDto>(
            """{"status":"away_from_campus","message":"You're currently away from campus.","geofence":{"status":"outside"},"route":null}""", Web)!;
        Assert.Equal(CampusRouteResponseDto.AwayFromCampus, away.Status);
        Assert.Null(away.Instructions);
    }
}
