using System.Net.Http.Json;
using System.Text.Json;
using UNIVAST.Mobile.Models;

using static UNIVAST.Mobile.Services.ApiResponse;

namespace UNIVAST.Mobile.Services;

public class BusinessApiService
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public BusinessApiService(HttpClient http)
    {
        _http = http;
    }

    public async Task<List<BusinessDto>> GetMineAsync(CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "api/v1/businesses/mine");

        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var businesses = await response.Content.ReadFromJsonAsync<List<BusinessDto>>(JsonOptions, ct);
        return businesses ?? new List<BusinessDto>();
    }

    public async Task<BusinessDto> CreateAsync(string name, string description, CancellationToken ct = default)
    {
        var payload = new CreateBusinessRequest { Name = name, Description = description };
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/v1/businesses")
        {
            Content = JsonContent.Create(payload, options: JsonOptions),
        };

        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        return await response.Content.ReadFromJsonAsync<BusinessDto>(JsonOptions, ct)
            ?? throw new UnivastApiException("Empty response from create business", 502);
    }

    public async Task ClaimPlaceAsync(string placeId, string businessId, CancellationToken ct = default)
    {
        var payload = new ClaimPlaceRequest { BusinessId = businessId };
        using var request = new HttpRequestMessage(HttpMethod.Post, $"api/v1/places/{Uri.EscapeDataString(placeId)}/claim")
        {
            Content = JsonContent.Create(payload, options: JsonOptions),
        };

        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
    }
}
