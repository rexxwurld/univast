using System.Net;
using System.Text.Json;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

public class CampusApiServiceTests
{
    private static (CampusApiService Service, StubHandler Handler) Create(Func<HttpRequestMessage, string?, HttpResponseMessage> respond)
    {
        var handler = new StubHandler(respond);
        return (new CampusApiService(new HttpClient(handler) { BaseAddress = new Uri("https://api.test/") }), handler);
    }

    [Fact]
    public async Task Campuses_are_read_from_the_campus_data_endpoint()
    {
        var (service, handler) = Create((_, _) => Responses.Json(HttpStatusCode.OK, """[{"id":"c1","name":"Main Campus","latitude":1,"longitude":2}]"""));

        var campuses = await service.GetCampusesAsync();

        Assert.Equal("c1", campuses.Single().Id);
        Assert.Equal("/api/v1/campus-data/campuses", handler.Calls.Single().Request.RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task Buildings_landmarks_and_search_use_the_documented_paths_and_escape_input()
    {
        var (service, handler) = Create((req, _) => req.RequestUri!.AbsolutePath.EndsWith("/search")
            ? Responses.Json(HttpStatusCode.OK, """{"results":[]}""")
            : Responses.Json(HttpStatusCode.OK, "[]"));

        await service.GetBuildingsAsync("c 1");
        await service.GetLandmarksAsync("c1");
        await service.SearchAsync("c1", "lecture theatre 1 & more", 7);

        var uris = handler.Calls.Select(c => c.Request.RequestUri!.AbsoluteUri).ToArray();
        Assert.Equal("https://api.test/api/v1/campus-data/c%201/buildings", uris[0]);
        Assert.Equal("https://api.test/api/v1/campus-data/c1/landmarks", uris[1]);
        Assert.Equal("https://api.test/api/v1/campus-data/c1/search?q=lecture%20theatre%201%20%26%20more&limit=7", uris[2]);
    }

    [Fact]
    public async Task Locate_posts_real_coordinates_and_omits_a_missing_accuracy()
    {
        var (service, handler) = Create((_, _) => Responses.Json(HttpStatusCode.OK, """{"status":"outside"}"""));

        var result = await service.LocateAsync("c1", 4.95, 8.33, null);

        Assert.Equal("outside", result.Status);
        var call = handler.Calls.Single();
        Assert.Equal(HttpMethod.Post, call.Request.Method);
        Assert.EndsWith("/api/v1/campus-data/c1/locate", call.Request.RequestUri!.AbsolutePath);
        Assert.Contains("\"latitude\":4.95", call.Body);
        Assert.DoesNotContain("accuracyMeters", call.Body);
    }

    [Fact]
    public async Task Route_from_the_device_sends_coordinates_and_exactly_one_destination_id()
    {
        var (service, handler) = Create((_, _) => Responses.Json(HttpStatusCode.OK, """{"status":"ok","distanceMeters":10}"""));

        await service.RouteAsync("c1", new CampusRouteFrom { Latitude = 1.5, Longitude = 2.5, AccuracyMeters = 8 }, new CampusRouteTo { RoomId = "r1" });

        using var doc = JsonDocument.Parse(handler.Calls.Single().Body!);
        var from = doc.RootElement.GetProperty("from");
        Assert.Equal(1.5, from.GetProperty("latitude").GetDouble());
        Assert.Equal(8, from.GetProperty("accuracyMeters").GetDouble());
        Assert.False(from.TryGetProperty("landmarkId", out _));
        var to = doc.RootElement.GetProperty("to");
        Assert.Equal("r1", to.GetProperty("roomId").GetString());
        Assert.False(to.TryGetProperty("buildingId", out _));
        Assert.False(to.TryGetProperty("landmarkId", out _));
    }

    [Fact]
    public async Task Route_from_a_landmark_sends_only_the_landmark_id()
    {
        var (service, handler) = Create((_, _) => Responses.Json(HttpStatusCode.OK, """{"status":"ok"}"""));

        await service.RouteAsync("c1", new CampusRouteFrom { LandmarkId = "l1" }, new CampusRouteTo { BuildingId = "b1" });

        using var doc = JsonDocument.Parse(handler.Calls.Single().Body!);
        var from = doc.RootElement.GetProperty("from");
        Assert.Equal("l1", from.GetProperty("landmarkId").GetString());
        Assert.False(from.TryGetProperty("latitude", out _));
    }

    [Fact]
    public async Task Backend_error_messages_surface_as_UnivastApiException()
    {
        var (service, _) = Create((_, _) => Responses.Json(HttpStatusCode.UnprocessableEntity, """{"message":"No walking route exists from the starting point to this destination"}"""));

        var ex = await Assert.ThrowsAsync<UnivastApiException>(() => service.RouteAsync("c1", new CampusRouteFrom { LandmarkId = "l" }, new CampusRouteTo { RoomId = "r" }));

        Assert.Equal(422, ex.StatusCode);
        Assert.Contains("No walking route", ex.Message);
    }

    [Fact]
    public async Task A_404_for_an_unknown_campus_is_reported_with_its_status()
    {
        var (service, _) = Create((_, _) => Responses.Json(HttpStatusCode.NotFound, """{"message":"Campus not found"}"""));
        var ex = await Assert.ThrowsAsync<UnivastApiException>(() => service.GetBuildingsAsync("nope"));
        Assert.Equal(404, ex.StatusCode);
    }

    [Fact]
    public async Task A_null_json_body_is_reported_as_an_error_not_a_crash()
    {
        var (service, _) = Create((_, _) => Responses.Json(HttpStatusCode.OK, "null"));
        await Assert.ThrowsAsync<UnivastApiException>(() => service.SearchAsync("c1", "x"));
    }

    [Fact]
    public async Task Malformed_json_throws_JsonException_which_the_error_mapper_makes_friendly()
    {
        var (service, _) = Create((_, _) => Responses.Json(HttpStatusCode.OK, "{ not json"));
        var ex = await Assert.ThrowsAnyAsync<JsonException>(() => service.GetCampusesAsync());
        Assert.Contains("couldn't read", CampusErrorMapper.ToUserMessage(ex));
    }
}
