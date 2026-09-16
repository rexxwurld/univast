using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

/// <summary>
/// Mirrors the backend's NavigationNode document (see backend/models/NavigationNode.js).
/// </summary>
public class NavigationNodeDto
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = string.Empty;

    public string CampusId { get; set; } = string.Empty;

    public string? Name { get; set; }

    public string? Type { get; set; }

    public double Latitude { get; set; }

    public double Longitude { get; set; }

    public string? LocationId { get; set; }

    /// <summary>Friendly label for pickers/lists when the node has no name set.</summary>
    [JsonIgnore]
    public string DisplayName =>
        string.IsNullOrWhiteSpace(Name)
            ? $"Unnamed {(string.IsNullOrWhiteSpace(Type) ? "node" : Type)} ({Latitude:F5}, {Longitude:F5})"
            : Name!;
}
