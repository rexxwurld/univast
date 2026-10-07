using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using UNIVAST.Mobile.Models;

using static UNIVAST.Mobile.Services.ApiResponse;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Typed client for /api/v1/campus-data (Phase 2). Registered in HttpClientRegistration, so it inherits the
/// base address, auth handler and resilience policy. Reads are public; no auth is required.
/// </summary>
public class CampusApiService : ICampusApi
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public CampusApiService(HttpClient http) => _http = http;

    private static string Base(string campusId) => $"api/v1/campus-data/{Uri.EscapeDataString(campusId)}";

    private async Task<T> GetAsync<T>(string url, CancellationToken ct) where T : class
    {
        using var response = await _http.GetAsync(url, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        var body = await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct);
        return body ?? throw new UnivastApiException("Empty response from the campus service", 502);
    }

    public async Task<List<CampusSummaryDto>> GetCampusesAsync(CancellationToken ct = default) =>
        await GetAsync<List<CampusSummaryDto>>("api/v1/campus-data/campuses", ct);

    public async Task<List<CampusBuildingDto>> GetBuildingsAsync(string campusId, CancellationToken ct = default) =>
        await GetAsync<List<CampusBuildingDto>>($"{Base(campusId)}/buildings", ct);

    public async Task<List<CampusLandmarkDto>> GetLandmarksAsync(string campusId, CancellationToken ct = default) =>
        await GetAsync<List<CampusLandmarkDto>>($"{Base(campusId)}/landmarks", ct);

    public async Task<CampusSearchResponseDto> SearchAsync(string campusId, string query, int limit = 20, CancellationToken ct = default) =>
        await GetAsync<CampusSearchResponseDto>($"{Base(campusId)}/search?q={Uri.EscapeDataString(query)}&limit={limit}", ct);

    public async Task<CampusSearchResponseDto> GlobalSearchAsync(string query, int limit = 20, CancellationToken ct = default, bool includeGeo = false, double? nearLatitude = null, double? nearLongitude = null)
    {
        var url = $"api/v1/search?q={Uri.EscapeDataString(query)}&limit={limit}";
        if (includeGeo)
        {
            url += "&geo=1";
            if (nearLatitude is double lat && nearLongitude is double lng)
                url += $"&lat={lat.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}&lng={lng.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}";
        }
        return await GetAsync<CampusSearchResponseDto>(url, ct);
    }

    public async Task<CampusPackVersionDto> GetPackVersionAsync(string campusId, CancellationToken ct = default) =>
        await GetAsync<CampusPackVersionDto>($"{Base(campusId)}/pack/version", ct);

    public async Task<CampusPackDto> GetPackAsync(string campusId, int? sinceVersion = null, CancellationToken ct = default)
    {
        var url = $"{Base(campusId)}/pack";
        if (sinceVersion.HasValue) url += $"?sinceVersion={sinceVersion.Value}";
        return await GetAsync<CampusPackDto>(url, ct);
    }

    public async Task<CampusBuildingDetailDto> GetBuildingAsync(string campusId, string buildingId, CancellationToken ct = default) =>
        await GetAsync<CampusBuildingDetailDto>($"{Base(campusId)}/buildings/{Uri.EscapeDataString(buildingId)}", ct);

    public async Task<CampusRoomDetailDto> GetRoomAsync(string campusId, string roomId, CancellationToken ct = default) =>
        await GetAsync<CampusRoomDetailDto>($"{Base(campusId)}/rooms/{Uri.EscapeDataString(roomId)}", ct);

    public async Task<CampusLocateResultDto> LocateAsync(string campusId, double latitude, double longitude, double? accuracyMeters, CancellationToken ct = default)
    {
        var payload = new { latitude, longitude, accuracyMeters };
        using var response = await _http.PostAsJsonAsync($"{Base(campusId)}/locate", payload, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        var body = await response.Content.ReadFromJsonAsync<CampusLocateResultDto>(JsonOptions, ct);
        return body ?? throw new UnivastApiException("Empty response from the campus service", 502);
    }

    public async Task<CampusRouteResponseDto> RouteAsync(string campusId, CampusRouteFrom start, CampusRouteTo destination, CampusRouteOptions? options = null, CancellationToken ct = default)
    {
        // Exactly one kind of origin is sent: a landmark id, or the real device coordinates. Null fields are omitted.
        var fromPayload = start.LandmarkId is not null
            ? new Dictionary<string, object?> { ["landmarkId"] = start.LandmarkId }
            : start.EntranceId is not null
                ? new Dictionary<string, object?> { ["entranceId"] = start.EntranceId }
                : new Dictionary<string, object?>
                {
                    ["latitude"] = start.Latitude,
                    ["longitude"] = start.Longitude,
                    ["accuracyMeters"] = start.AccuracyMeters,
                    ["source"] = start.Source,
                };
        var toPayload = new Dictionary<string, object?>
        {
            ["roomId"] = destination.RoomId,
            ["buildingId"] = destination.BuildingId,
            ["landmarkId"] = destination.LandmarkId,
            ["entranceId"] = destination.EntranceId,
        }.Where(kv => kv.Value is not null).ToDictionary(kv => kv.Key, kv => kv.Value);
        fromPayload = fromPayload.Where(kv => kv.Value is not null).ToDictionary(kv => kv.Key, kv => kv.Value);
        var payload = new Dictionary<string, object?> { ["from"] = fromPayload, ["to"] = toPayload };
        if (options is { AccessibleOnly: true }) payload["options"] = new Dictionary<string, object?> { ["accessibleOnly"] = true };

        using var response = await _http.PostAsJsonAsync($"{Base(campusId)}/route", payload, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        var body = await response.Content.ReadFromJsonAsync<CampusRouteResponseDto>(JsonOptions, ct);
        return body ?? throw new UnivastApiException("Empty response from the routing service", 502);
    }
}
