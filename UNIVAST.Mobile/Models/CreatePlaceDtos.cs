using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

/// <summary>Body for POST /api/v1/places. Optional fields are omitted (not sent as null): the backend's zod schema rejects null strings.</summary>
public class CreatePlaceRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    /// <summary>Category id.</summary>
    [JsonPropertyName("category")]
    public string Category { get; set; } = "";

    [JsonPropertyName("latitude")]
    public double Latitude { get; set; }

    [JsonPropertyName("longitude")]
    public double Longitude { get; set; }

    [JsonPropertyName("description")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; set; }

    [JsonPropertyName("address")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Address { get; set; }

    [JsonPropertyName("phone")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Phone { get; set; }

    [JsonPropertyName("website")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Website { get; set; }

    [JsonPropertyName("photos")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<string>? Photos { get; set; }
}

public class ReverseGeocodeResponse
{
    [JsonPropertyName("displayName")]
    public string? DisplayName { get; set; }
}

public class UploadImageResponse
{
    [JsonPropertyName("url")]
    public string Url { get; set; } = "";

    [JsonPropertyName("publicId")]
    public string? PublicId { get; set; }
}
