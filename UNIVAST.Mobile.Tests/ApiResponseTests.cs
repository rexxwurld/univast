using System.Net;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

public class ApiResponseTests
{
    [Fact]
    public async Task Success_does_not_throw()
    {
        using var response = Responses.Status(HttpStatusCode.OK);
        await ApiResponse.EnsureSuccessOrThrowAsync(response, CancellationToken.None);
    }

    [Fact]
    public async Task Uses_the_backend_message_when_present()
    {
        using var response = Responses.Json(HttpStatusCode.Conflict, "{\"message\":\"You have already reviewed this place\"}");

        var ex = await Assert.ThrowsAsync<UnivastApiException>(
            () => ApiResponse.EnsureSuccessOrThrowAsync(response, CancellationToken.None));

        Assert.Equal(409, ex.StatusCode);
        Assert.Equal("You have already reviewed this place", ex.Message);
    }

    [Fact]
    public async Task Falls_back_to_a_generic_message_for_non_json_bodies()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.BadGateway)
        {
            Content = new StringContent("<html>Bad gateway</html>", System.Text.Encoding.UTF8, "text/html"),
        };

        var ex = await Assert.ThrowsAsync<UnivastApiException>(
            () => ApiResponse.EnsureSuccessOrThrowAsync(response, CancellationToken.None));

        Assert.Equal(502, ex.StatusCode);
        Assert.Contains("502", ex.Message);
    }

    [Fact]
    public async Task Falls_back_to_a_generic_message_for_malformed_json()
    {
        using var response = Responses.Json(HttpStatusCode.InternalServerError, "{not json");

        var ex = await Assert.ThrowsAsync<UnivastApiException>(
            () => ApiResponse.EnsureSuccessOrThrowAsync(response, CancellationToken.None));

        Assert.Equal(500, ex.StatusCode);
    }

    [Fact]
    public async Task Ignores_a_blank_message()
    {
        using var response = Responses.Json(HttpStatusCode.BadRequest, "{\"message\":\"  \"}");

        var ex = await Assert.ThrowsAsync<UnivastApiException>(
            () => ApiResponse.EnsureSuccessOrThrowAsync(response, CancellationToken.None));

        Assert.Contains("400", ex.Message);
    }
}
