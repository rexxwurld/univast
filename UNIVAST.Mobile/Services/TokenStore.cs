using System.Text.Json;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Wraps .NET MAUI SecureStorage for the auth tokens and current user. SecureStorage
/// (Keystore on Android, Keychain on iOS) is the right place for a JWT — plain
/// Preferences is not encrypted.
/// </summary>
public class TokenStore
{
    private const string TokenKey = "auth_token";
    private const string RefreshTokenKey = "auth_refresh_token";
    private const string UserKey = "auth_user";

    public async Task SaveAsync(AuthResponse auth)
    {
        await SecureStorage.Default.SetAsync(TokenKey, auth.Token);

        if (!string.IsNullOrEmpty(auth.RefreshToken))
        {
            await SecureStorage.Default.SetAsync(RefreshTokenKey, auth.RefreshToken);
        }

        if (auth.User is not null)
        {
            await SecureStorage.Default.SetAsync(UserKey, JsonSerializer.Serialize(auth.User));
        }
    }

    public Task<string?> GetTokenAsync() => SafeGetAsync(TokenKey);

    public Task<string?> GetRefreshTokenAsync() => SafeGetAsync(RefreshTokenKey);

    public async Task<UserDto?> GetUserAsync()
    {
        var json = await SafeGetAsync(UserKey);
        if (string.IsNullOrWhiteSpace(json)) return null;

        try
        {
            return JsonSerializer.Deserialize<UserDto>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public void Clear()
    {
        SecureStorage.Default.Remove(TokenKey);
        SecureStorage.Default.Remove(RefreshTokenKey);
        SecureStorage.Default.Remove(UserKey);
    }

    // SecureStorage can throw if the platform key store was invalidated (e.g. a
    // restored device backup or changed lock screen). Treat that as "signed out"
    // instead of crashing.
    private static async Task<string?> SafeGetAsync(string key)
    {
        try
        {
            return await SecureStorage.Default.GetAsync(key);
        }
        catch (Exception)
        {
            SecureStorage.Default.Remove(key);
            return null;
        }
    }
}
