using System.Net.Http.Json;
using System.Text.Json;
using UNIVAST.Mobile.Models;

using static UNIVAST.Mobile.Services.ApiResponse;

namespace UNIVAST.Mobile.Services;

public class ReportApiService
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public ReportApiService(HttpClient http)
    {
        _http = http;
    }

    /// <param name="targetType">Must match the backend's Report.TARGET_TYPES exactly: "Place", "Review", or "Business".</param>
    public async Task CreateAsync(string targetType, string targetId, string reason, CancellationToken ct = default)
    {
        var payload = new CreateReportRequest { TargetType = targetType, TargetId = targetId, Reason = reason };
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/v1/reports")
        {
            Content = JsonContent.Create(payload, options: JsonOptions),
        };

        using var response = await _http.SendAsync(request, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
    }
}
