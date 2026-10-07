using System.Net.Http.Json;
using System.Text.Json;
using UNIVAST.Mobile.Models;

using static UNIVAST.Mobile.Services.ApiResponse;

namespace UNIVAST.Mobile.Services;

public class ReviewsApiService
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public ReviewsApiService(HttpClient http)
    {
        _http = http;
    }

    public async Task<List<ReviewDto>> GetByPlaceAsync(string placeId, int limit = 10, CancellationToken ct = default)
    {
        var url = $"api/v1/reviews?place={Uri.EscapeDataString(placeId)}&limit={limit}";
        using var response = await _http.GetAsync(url, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        var result = await response.Content.ReadFromJsonAsync<PagedReviewsResponse>(JsonOptions, ct);
        return result?.Data ?? new List<ReviewDto>();
    }

    public async Task<ReviewDto> CreateAsync(string placeId, int rating, string text, CancellationToken ct = default)
    {
        var payload = new CreateReviewRequest { Place = placeId, Rating = rating, Text = text };
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/v1/reviews")
        {
            Content = JsonContent.Create(payload, options: JsonOptions),
        };

        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccessOrThrowAsync(response, ct);

        return await response.Content.ReadFromJsonAsync<ReviewDto>(JsonOptions, ct)
            ?? throw new UnivastApiException("Empty response from create review", 502);
    }
}
