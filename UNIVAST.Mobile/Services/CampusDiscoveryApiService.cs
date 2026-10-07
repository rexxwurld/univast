using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json;
using UNIVAST.Mobile.Models;

using static UNIVAST.Mobile.Services.ApiResponse;

namespace UNIVAST.Mobile.Services;

public sealed class CampusDiscoveryApiService
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public CampusDiscoveryApiService(HttpClient http) => _http = http;

    public async Task<CampusDiscoveryResponseDto> SearchAsync(string campusId, string query, CancellationToken ct = default)
    {
        var url = $"api/v1/discovery/{Uri.EscapeDataString(campusId)}/search?q={Uri.EscapeDataString(query)}";
        using var response = await _http.GetAsync(url, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        return await response.Content.ReadFromJsonAsync<CampusDiscoveryResponseDto>(JsonOptions, ct)
            ?? throw new UnivastApiException("Empty campus discovery response", 502);
    }
}

public sealed class ContributionApiService
{
    private readonly HttpClient _http;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public ContributionApiService(HttpClient http) => _http = http;

    public async Task<ContributionDto> SubmitAsync(CreateContributionRequest request, CancellationToken ct = default)
    {
        using var response = await _http.PostAsJsonAsync("api/v1/contributions", request, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        return await response.Content.ReadFromJsonAsync<ContributionDto>(JsonOptions, ct)
            ?? throw new UnivastApiException("Empty contribution response", 502);
    }

    public async Task<ContributionDto> ResubmitAsync(string contributionId, CreateContributionRequest request, CancellationToken ct = default)
    {
        using var response = await _http.PatchAsJsonAsync($"api/v1/contributions/{Uri.EscapeDataString(contributionId)}/resubmit", request, JsonOptions, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        return await response.Content.ReadFromJsonAsync<ContributionDto>(JsonOptions, ct)
            ?? throw new UnivastApiException("Empty contribution response", 502);
    }

    public async Task<List<ContributionDto>> GetMineAsync(CancellationToken ct = default)
    {
        using var response = await _http.GetAsync("api/v1/contributions/mine", ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        var body = await response.Content.ReadFromJsonAsync<ContributionListDto>(JsonOptions, ct);
        return body?.Results ?? new List<ContributionDto>();
    }

    public async Task<List<SubmissionFileDto>> UploadEvidenceAsync(IReadOnlyList<FileResult> files, CancellationToken ct = default)
    {
        using var form = new MultipartFormDataContent();
        foreach (var file in files)
        {
            var content = new StreamContent(await file.OpenReadAsync());
            content.Headers.ContentType = new MediaTypeHeaderValue(ContentType(file.FileName));
            form.Add(content, "files", file.FileName);
        }

        using var response = await _http.PostAsync("api/v1/submission-files", form, ct);
        await EnsureSuccessOrThrowAsync(response, ct);
        var body = await response.Content.ReadFromJsonAsync<SubmissionFileUploadResponseDto>(JsonOptions, ct);
        return body?.Files ?? new List<SubmissionFileDto>();
    }

    private static string ContentType(string fileName) => Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".pdf" => "application/pdf",
        ".mp4" => "video/mp4",
        ".mov" => "video/quicktime",
        _ => "application/octet-stream",
    };
}