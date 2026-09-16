using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Thin wrapper around HttpClient for the endpoints the mobile navigation flow needs.
/// Registered as a typed client in MauiProgram.cs (BaseAddress = ApiConfig.BaseUrl).
/// </summary>
public class UnivastApiService
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public UnivastApiService(HttpClient http)
    {
        _http = http;
    }

    /// <summary>GET /api/navigation?campusId=... — all navigation nodes for a campus.</summary>
    public async Task<List<NavigationNodeDto>> GetNavigationNodesAsync(string campusId, CancellationToken ct = default)
    {
        var url = $"api/navigation?campusId={Uri.EscapeDataString(campusId)}";
        using var response = await _http.GetAsync(url, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var nodes = await response.Content.ReadFromJsonAsync<List<NavigationNodeDto>>(JsonOptions, ct);
        return nodes ?? new List<NavigationNodeDto>();
    }

    /// <summary>POST /api/routes/route — shortest walking route between two nodes.</summary>
    public async Task<RouteResponse> GetRouteAsync(
        string campusId,
        string startNodeId,
        string endNodeId,
        CancellationToken ct = default)
    {
        var payload = new { campusId, startNodeId, endNodeId };
        using var response = await _http.PostAsJsonAsync("api/routes/route", payload, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var result = await response.Content.ReadFromJsonAsync<RouteResponse>(JsonOptions, ct);
        return result ?? throw new UnivastApiException("Empty response from routing endpoint", 502);
    }

    /// <summary>POST /api/routes/nearest-node — nearest navigation node to a coordinate.</summary>
    public async Task<NearestNodeResponse> GetNearestNodeAsync(
        string campusId,
        double latitude,
        double longitude,
        CancellationToken ct = default)
    {
        var payload = new { campusId, latitude, longitude };
        using var response = await _http.PostAsJsonAsync("api/routes/nearest-node", payload, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var result = await response.Content.ReadFromJsonAsync<NearestNodeResponse>(JsonOptions, ct);
        return result ?? throw new UnivastApiException("Empty response from nearest-node endpoint", 502);
    }

    private static async Task EnsureSuccessOrThrowAsync(HttpResponseMessage response, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode) return;

        var message = $"Request failed ({(int)response.StatusCode} {response.StatusCode})";
        try
        {
            var body = await response.Content.ReadFromJsonAsync<ErrorBody>(JsonOptions, ct);
            if (!string.IsNullOrWhiteSpace(body?.Message))
            {
                message = body!.Message!;
            }
        }
        catch (JsonException)
        {
            // Response body wasn't the expected JSON error shape — keep the generic message.
        }

        throw new UnivastApiException(message, (int)response.StatusCode);
    }

    private class ErrorBody
    {
        [JsonPropertyName("message")]
        public string? Message { get; set; }
    }
}
