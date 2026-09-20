using System.Net.Http.Json;
using System.Text.Json;
using UNIVAST.Mobile.Models;

using static UNIVAST.Mobile.Services.ApiResponse;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Thin wrapper around HttpClient for /api/v1/auth. Registered as a typed client in
/// MauiProgram.cs. Follows the same error-unwrapping pattern as UnivastApiService.
/// </summary>
public class AuthService
{
    private readonly HttpClient _http;
    private readonly TokenStore _tokenStore;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public AuthService(HttpClient http, TokenStore tokenStore)
    {
        _http = http;
        _tokenStore = tokenStore;
    }

    public async Task<UserDto> RegisterAsync(string name, string email, string password, CancellationToken ct = default)
    {
        var payload = new RegisterRequest { Name = name, Email = email, Password = password };
        using var response = await _http.PostAsJsonAsync("api/v1/auth/register", payload, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>(JsonOptions, ct)
            ?? throw new UnivastApiException("Empty response from register endpoint", 502);
        await _tokenStore.SaveAsync(auth);
        return auth.User;
    }

    public async Task<UserDto> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        var payload = new LoginRequest { Email = email, Password = password };
        using var response = await _http.PostAsJsonAsync("api/v1/auth/login", payload, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var auth = await response.Content.ReadFromJsonAsync<AuthResponse>(JsonOptions, ct)
            ?? throw new UnivastApiException("Empty response from login endpoint", 502);
        await _tokenStore.SaveAsync(auth);
        return auth.User;
    }

    /// <summary>
    /// Signs out: revokes this device's refresh token on the server (best effort — a
    /// network failure must never stop the user from logging out locally), then clears
    /// the stored tokens.
    /// </summary>
    public async Task LogoutAsync(CancellationToken ct = default)
    {
        try
        {
            var refreshToken = await _tokenStore.GetRefreshTokenAsync();
            if (!string.IsNullOrEmpty(refreshToken))
            {
                using var response = await _http.PostAsJsonAsync(
                    "api/v1/auth/logout", new { refreshToken }, JsonOptions, ct);
            }
        }
        catch (Exception)
        {
            // Offline / server down: still log out locally.
        }
        finally
        {
            _tokenStore.Clear();
        }
    }

    public Task<UserDto?> GetCurrentUserAsync() => _tokenStore.GetUserAsync();

    public async Task<bool> IsLoggedInAsync() => await _tokenStore.GetTokenAsync() is not null;
}
