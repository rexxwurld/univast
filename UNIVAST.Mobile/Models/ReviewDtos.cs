using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

public class ReviewAuthorDto
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";
}

public class ReviewDto
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("rating")]
    public int Rating { get; set; }

    [JsonPropertyName("text")]
    public string? Text { get; set; }

    [JsonPropertyName("user")]
    public ReviewAuthorDto? User { get; set; }

    [JsonPropertyName("createdAt")]
    public DateTime CreatedAt { get; set; }
}

public class CreateReviewRequest
{
    [JsonPropertyName("place")]
    public string Place { get; set; } = "";

    [JsonPropertyName("rating")]
    public int Rating { get; set; }

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";
}

public class PagedReviewsResponse
{
    [JsonPropertyName("data")]
    public List<ReviewDto> Data { get; set; } = new();

    [JsonPropertyName("pagination")]
    public PaginationInfo Pagination { get; set; } = new();
}
