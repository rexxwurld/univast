using System.Net;
using System.Net.Http.Json;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

public class AuthHeaderHandlerTests
{
    private static (HttpClient Client, FakeTokenStore Store, StubHandler Api, StubHandler Refresh) Create(
        Func<HttpRequestMessage, string?, HttpResponseMessage> api,
        Func<HttpRequestMessage, string?, HttpResponseMessage>? refresh = null,
        string? token = "access-old",
        string? refreshToken = "refresh-old")
    {
        var store = new FakeTokenStore { Token = token, RefreshToken = refreshToken };
        var apiHandler = new StubHandler(api);
        var refreshHandler = new StubHandler(refresh ?? ((_, _) => Responses.Status(HttpStatusCode.InternalServerError)));
        var handler = new AuthHeaderHandler(store, new StubHttpClientFactory(refreshHandler)) { InnerHandler = apiHandler };
        var client = new HttpClient(handler) { BaseAddress = new Uri("https://api.test/") };
        return (client, store, apiHandler, refreshHandler);
    }

    [Fact]
    public async Task Sends_no_Authorization_header_when_signed_out()
    {
        var (client, _, api, _) = Create((_, _) => Responses.Status(HttpStatusCode.OK), token: null);

        await client.GetAsync("api/v1/places/nearby");

        Assert.Null(api.Calls.Single().Authorization);
    }

    [Fact]
    public async Task Attaches_the_bearer_token_when_signed_in()
    {
        var (client, _, api, _) = Create((_, _) => Responses.Status(HttpStatusCode.OK));

        await client.GetAsync("api/v1/places/nearby");

        Assert.Equal("Bearer access-old", api.Calls.Single().Authorization);
    }

    [Fact]
    public async Task Leaves_auth_endpoints_alone()
    {
        var (client, _, api, _) = Create((_, _) => Responses.Status(HttpStatusCode.OK));

        await client.PostAsJsonAsync("api/v1/auth/login", new { email = "a@b.c", password = "x" });

        Assert.Null(api.Calls.Single().Authorization);
    }

    [Fact]
    public async Task Refreshes_on_401_and_retries_once_with_the_new_token()
    {
        var (client, store, api, refresh) = Create(
            api: (req, _) => req.Headers.Authorization?.Parameter == "access-new"
                ? Responses.Json(HttpStatusCode.OK, "{}")
                : Responses.Status(HttpStatusCode.Unauthorized),
            refresh: (_, _) => Responses.Json(HttpStatusCode.OK, Responses.AuthJson("access-new", "refresh-new")));

        var response = await client.GetAsync("api/v1/places/nearby");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, api.Calls.Count);
        Assert.Equal("Bearer access-new", api.Calls[1].Authorization);
        Assert.Single(refresh.Calls);
        Assert.Contains("refresh-old", refresh.Calls[0].Body);
        Assert.Equal("access-new", store.Token);
        Assert.Equal("refresh-new", store.RefreshToken);
    }

    [Fact]
    public async Task Replays_the_request_body_on_retry()
    {
        var (client, _, api, _) = Create(
            api: (req, _) => req.Headers.Authorization?.Parameter == "access-new"
                ? Responses.Status(HttpStatusCode.Created)
                : Responses.Status(HttpStatusCode.Unauthorized),
            refresh: (_, _) => Responses.Json(HttpStatusCode.OK, Responses.AuthJson("access-new")));

        var response = await client.PostAsJsonAsync("api/v1/reviews", new { place = "p1", rating = 5 });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(2, api.Calls.Count);
        Assert.Equal(api.Calls[0].Body, api.Calls[1].Body);
        Assert.Contains("\"rating\":5", api.Calls[1].Body);
    }

    [Fact]
    public async Task Signs_out_when_the_refresh_token_is_rejected()
    {
        var (client, store, api, _) = Create(
            api: (_, _) => Responses.Status(HttpStatusCode.Unauthorized),
            refresh: (_, _) => Responses.Json(HttpStatusCode.Unauthorized, "{\"message\":\"expired\"}"));

        var response = await client.GetAsync("api/v1/places/nearby");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Single(api.Calls); // no retry
        Assert.True(store.Cleared);
        Assert.Null(store.Token);
    }

    [Fact]
    public async Task Keeps_the_session_when_the_refresh_endpoint_has_a_transient_failure()
    {
        var (client, store, _, _) = Create(
            api: (_, _) => Responses.Status(HttpStatusCode.Unauthorized),
            refresh: (_, _) => Responses.Status(HttpStatusCode.ServiceUnavailable));

        var response = await client.GetAsync("api/v1/places/nearby");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.False(store.Cleared);
        Assert.Equal("refresh-old", store.RefreshToken);
    }

    [Fact]
    public async Task Does_not_try_to_refresh_without_a_refresh_token()
    {
        var (client, _, _, refresh) = Create(
            api: (_, _) => Responses.Status(HttpStatusCode.Unauthorized),
            refreshToken: null);

        var response = await client.GetAsync("api/v1/places/nearby");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(refresh.Calls);
    }

    [Fact]
    public async Task Does_not_loop_when_the_retry_is_also_rejected()
    {
        var (client, _, api, refresh) = Create(
            api: (_, _) => Responses.Status(HttpStatusCode.Unauthorized),
            refresh: (_, _) => Responses.Json(HttpStatusCode.OK, Responses.AuthJson("access-new")));

        var response = await client.GetAsync("api/v1/places/nearby");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(2, api.Calls.Count);
        Assert.Single(refresh.Calls);
    }
}
