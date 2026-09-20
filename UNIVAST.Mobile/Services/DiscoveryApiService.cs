using System.Net.Http.Json;
using System.Text.Json;
using UNIVAST.Mobile.Models;

using static UNIVAST.Mobile.Services.ApiResponse;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Thin wrapper around HttpClient for /api/v1/categories and /api/v1/places.
/// Registered as a typed client in MauiProgram.cs (BaseAddress = ApiConfig.BaseUrl).
/// </summary>
public class DiscoveryApiService
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public DiscoveryApiService(HttpClient http)
    {
        _http = http;
    }

    public async Task<List<CategoryDto>> GetCategoriesAsync(CancellationToken ct = default)
    {
        using var response = await _http.GetAsync("api/v1/categories", ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var categories = await response.Content.ReadFromJsonAsync<List<CategoryDto>>(JsonOptions, ct);
        return categories ?? new List<CategoryDto>();
    }

    /// <summary>GET /api/v1/places/nearby — places within radius meters of (lat, lng), closest first.</summary>
    public async Task<List<PlaceDto>> GetNearbyAsync(
        double latitude,
        double longitude,
        double radiusMeters = 3000,
        string? categoryId = null,
        string? query = null,
        CancellationToken ct = default)
    {
        var url = $"api/v1/places/nearby?lat={latitude}&lng={longitude}&radius={radiusMeters}";
        if (!string.IsNullOrWhiteSpace(categoryId)) url += $"&category={Uri.EscapeDataString(categoryId)}";
        if (!string.IsNullOrWhiteSpace(query)) url += $"&q={Uri.EscapeDataString(query)}";

        using var response = await _http.GetAsync(url, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var result = await response.Content.ReadFromJsonAsync<PagedPlacesResponse>(JsonOptions, ct);
        return result?.Data ?? new List<PlaceDto>();
    }

    public async Task<PlaceDto> GetPlaceAsync(string placeId, CancellationToken ct = default)
    {
        using var response = await _http.GetAsync($"api/v1/places/{Uri.EscapeDataString(placeId)}", ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var place = await response.Content.ReadFromJsonAsync<PlaceDto>(JsonOptions, ct);
        return place ?? throw new UnivastApiException("Empty response for place detail", 502);
    }
}
