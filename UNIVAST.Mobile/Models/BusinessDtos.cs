using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

public class BusinessDto
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("verificationStatus")]
    public string VerificationStatus { get; set; } = "pending";
}

public class CreateBusinessRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("description")]
    public string Description { get; set; } = "";
}

public class ClaimPlaceRequest
{
    [JsonPropertyName("businessId")]
    public string BusinessId { get; set; } = "";
}
