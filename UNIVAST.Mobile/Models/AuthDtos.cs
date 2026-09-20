using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

public class RegisterRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("email")]
    public string Email { get; set; } = "";

    [JsonPropertyName("password")]
    public string Password { get; set; } = "";
}

public class LoginRequest
{
    [JsonPropertyName("email")]
    public string Email { get; set; } = "";

    [JsonPropertyName("password")]
    public string Password { get; set; } = "";
}

public class UserDto
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("email")]
    public string Email { get; set; } = "";

    [JsonPropertyName("role")]
    public string Role { get; set; } = "user";
}

public class AuthResponse
{
    [JsonPropertyName("token")]
    public string Token { get; set; } = "";

    /// <summary>Long-lived, single-use (rotating) token used to get a new access token.</summary>
    [JsonPropertyName("refreshToken")]
    public string? RefreshToken { get; set; }

    [JsonPropertyName("user")]
    public UserDto User { get; set; } = new();
}
