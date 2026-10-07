using System.Text.Json;
using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

public sealed class CampusPackVersionDto
{
    [JsonPropertyName("currentVersion")] public int CurrentVersion { get; set; }
    [JsonPropertyName("checksum")] public string? Checksum { get; set; }
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; }
    [JsonPropertyName("sizeBytes")] public long SizeBytes { get; set; }
    [JsonPropertyName("publishedAt")] public DateTimeOffset? PublishedAt { get; set; }
    [JsonPropertyName("containsDevFixture")] public bool ContainsDevFixture { get; set; }
    [JsonPropertyName("hasUnpublishedChanges")] public bool HasUnpublishedChanges { get; set; }
}

public sealed class CampusPackDto
{
    [JsonPropertyName("upToDate")] public bool UpToDate { get; set; }
    [JsonPropertyName("version")] public int Version { get; set; }
    [JsonPropertyName("schemaVersion")] public int SchemaVersion { get; set; }
    [JsonPropertyName("checksum")] public string? Checksum { get; set; }
    [JsonPropertyName("containsDevFixture")] public bool ContainsDevFixture { get; set; }
    [JsonPropertyName("publishedAt")] public DateTimeOffset? PublishedAt { get; set; }
    [JsonPropertyName("snapshot")] public JsonElement Snapshot { get; set; }
}

public sealed class CampusPackInstallResult
{
    public required string CampusId { get; init; }
    public required int Version { get; init; }
    public required string Checksum { get; init; }
    public required bool Installed { get; init; }
    public required bool UpToDate { get; init; }
}
