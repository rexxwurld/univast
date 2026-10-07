using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

public class CreateReportRequest
{
    [JsonPropertyName("targetType")]
    public string TargetType { get; set; } = "";

    [JsonPropertyName("targetId")]
    public string TargetId { get; set; } = "";

    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "";
}
