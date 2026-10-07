using System.Net;
using System.Text;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

/// <summary>In-memory stand-in for the SecureStorage-backed TokenStore.</summary>
public sealed class FakeTokenStore : ITokenStore
{
    public string? Token { get; set; }
    public string? RefreshToken { get; set; }
    public UserDto? User { get; set; }
    public bool Cleared { get; private set; }

    public Task SaveAsync(AuthResponse auth)
    {
        Token = auth.Token;
        if (!string.IsNullOrEmpty(auth.RefreshToken)) RefreshToken = auth.RefreshToken;
        User = auth.User;
        return Task.CompletedTask;
    }

    public Task<string?> GetTokenAsync() => Task.FromResult(Token);
    public Task<string?> GetRefreshTokenAsync() => Task.FromResult(RefreshToken);
    public Task<UserDto?> GetUserAsync() => Task.FromResult(User);

    public void Clear()
    {
        Token = null;
        RefreshToken = null;
        User = null;
        Cleared = true;
    }
}

/// <summary>HttpMessageHandler that answers every request with a caller-supplied function and records what it saw.</summary>
public sealed class StubHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, string?, HttpResponseMessage> _respond;

    public List<(HttpRequestMessage Request, string? Body, string? Authorization)> Calls { get; } = new();

    public StubHandler(Func<HttpRequestMessage, string?, HttpResponseMessage> respond) => _respond = respond;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        Calls.Add((request, body, request.Headers.Authorization?.ToString()));
        return _respond(request, body);
    }
}

public sealed class StubHttpClientFactory : IHttpClientFactory
{
    private readonly HttpMessageHandler _handler;
    public StubHttpClientFactory(HttpMessageHandler handler) => _handler = handler;

    public HttpClient CreateClient(string name) =>
        new(_handler, disposeHandler: false) { BaseAddress = new Uri("https://api.test/") };
}

public static class Responses
{
    public static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    public static HttpResponseMessage Status(HttpStatusCode status) => new(status);

    public static string AuthJson(string token, string? refresh = "refresh-new") =>
        "{\"token\":\"" + token + "\"," +
        (refresh is null ? "" : "\"refreshToken\":\"" + refresh + "\",") +
        "\"user\":{\"id\":\"u1\",\"name\":\"Ada\",\"email\":\"ada@example.com\",\"role\":\"user\"}}";
}
