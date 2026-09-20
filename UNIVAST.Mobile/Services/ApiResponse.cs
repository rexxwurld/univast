using System.Net.Http.Json;
using System.Text.Json;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Shared error unwrapping for every API service: turns a non-2xx response into a
/// <see cref="UnivastApiException"/> carrying the backend's { message } text.
/// (Previously copy-pasted into each service.)
/// </summary>
public static class ApiResponse
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task EnsureSuccessOrThrowAsync(HttpResponseMessage response, CancellationToken ct)
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
        catch (NotSupportedException)
        {
            // Content-Type wasn't JSON (e.g. an HTML error page from a proxy) — keep the generic message.
        }

        throw new UnivastApiException(message, (int)response.StatusCode);
    }

    private sealed class ErrorBody
    {
        public string? Message { get; set; }
    }
}
