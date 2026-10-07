using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Storage for the signed-in session (access token, refresh token, user). Exists so the auth
/// handler's refresh-and-retry logic can be unit tested with an in-memory fake instead of
/// MAUI's SecureStorage.
/// </summary>
public interface ITokenStore
{
    Task SaveAsync(AuthResponse auth);
    Task<string?> GetTokenAsync();
    Task<string?> GetRefreshTokenAsync();
    Task<UserDto?> GetUserAsync();
    void Clear();
}
