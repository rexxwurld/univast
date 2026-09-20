using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Message handler that (1) attaches the current access token as a Bearer header to
/// every request, and (2) if the server answers 401, silently exchanges the stored
/// refresh token for a new pair (POST /api/v1/auth/refresh) and retries the request
/// once. Replaces the old per-call AuthService.AttachAuthAsync pattern, so a service
/// only has to build its request — it never touches tokens.
/// </summary>
public class AuthHeaderHandler : DelegatingHandler
{
    /// <summary>Name of the plain (handler-free) HttpClient used only for the refresh call.</summary>
    public const string RefreshClientName = "univast-refresh";

    // One refresh at a time across the whole app: refresh tokens are single-use, so two
    // parallel 401s must not both try to spend the same one.
    private static readonly SemaphoreSlim RefreshLock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly TokenStore _tokens;
    private readonly IHttpClientFactory _clientFactory;

    public AuthHeaderHandler(TokenStore tokens, IHttpClientFactory clientFactory)
    {
        _tokens = tokens;
        _clientFactory = clientFactory;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // Login/register/refresh/logout carry their own credentials — never decorate or retry them.
        var path = request.RequestUri?.AbsolutePath ?? string.Empty;
        if (path.Contains("/auth/", StringComparison.OrdinalIgnoreCase))
        {
            return await base.SendAsync(request, cancellationToken);
        }

        var token = await _tokens.GetTokenAsync();
        if (string.IsNullOrEmpty(token))
        {
            return await base.SendAsync(request, cancellationToken);
        }

        // Buffer the body now so it can be replayed if we have to retry after a refresh.
        if (request.Content is not null)
        {
            await request.Content.LoadIntoBufferAsync();
        }

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await base.SendAsync(request, cancellationToken);

        if (response.StatusCode != HttpStatusCode.Unauthorized)
        {
            return response;
        }

        var newToken = await RefreshAsync(token, cancellationToken);
        if (newToken is null)
        {
            return response; // caller sees the original 401
        }

        response.Dispose();
        var retry = await CloneAsync(request, cancellationToken);
        retry.Headers.Authorization = new AuthenticationHeaderValue("Bearer", newToken);
        return await base.SendAsync(retry, cancellationToken);
    }

    /// <summary>Returns a fresh access token, or null if the session can't be renewed.</summary>
    private async Task<string?> RefreshAsync(string staleAccessToken, CancellationToken ct)
    {
        await RefreshLock.WaitAsync(ct);
        try
        {
            // Another request may have refreshed while we waited for the lock.
            var current = await _tokens.GetTokenAsync();
            if (!string.IsNullOrEmpty(current) && current != staleAccessToken)
            {
                return current;
            }

            var refreshToken = await _tokens.GetRefreshTokenAsync();
            if (string.IsNullOrEmpty(refreshToken))
            {
                return null;
            }

            var client = _clientFactory.CreateClient(RefreshClientName);
            using var response = await client.PostAsJsonAsync(
                "api/v1/auth/refresh", new { refreshToken }, JsonOptions, ct);

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.BadRequest)
            {
                // Refresh token is expired/revoked: the session is over.
                _tokens.Clear();
                return null;
            }

            if (!response.IsSuccessStatusCode)
            {
                return null; // transient server problem — keep the tokens, try again later
            }

            var auth = await response.Content.ReadFromJsonAsync<AuthResponse>(JsonOptions, ct);
            if (auth is null || string.IsNullOrEmpty(auth.Token))
            {
                return null;
            }

            await _tokens.SaveAsync(auth);
            return auth.Token;
        }
        catch (HttpRequestException)
        {
            return null; // offline
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return null; // request timed out
        }
        finally
        {
            RefreshLock.Release();
        }
    }

    private static async Task<HttpRequestMessage> CloneAsync(HttpRequestMessage original, CancellationToken ct)
    {
        var clone = new HttpRequestMessage(original.Method, original.RequestUri) { Version = original.Version };

        foreach (var header in original.Headers)
        {
            clone.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        if (original.Content is not null)
        {
            var bytes = await original.Content.ReadAsByteArrayAsync(ct);
            var content = new ByteArrayContent(bytes);
            foreach (var header in original.Content.Headers)
            {
                content.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
            clone.Content = content;
        }

        return clone;
    }
}
