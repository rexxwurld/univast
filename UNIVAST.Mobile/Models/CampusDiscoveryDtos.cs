using System.Text.Json;
using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

public sealed class CampusDiscoveryResponseDto
{
    [JsonPropertyName("categoryNames")] public List<string> CategoryNames { get; set; } = new();
    [JsonPropertyName("items")] public List<CampusDiscoveryItemDto> Items { get; set; } = new();
}

public sealed class CampusDiscoveryItemDto
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("category")] public string Category { get; set; } = "";
    [JsonPropertyName("aliases")] public List<string> Aliases { get; set; } = new();
    [JsonPropertyName("campusId")] public string CampusId { get; set; } = "";
    [JsonPropertyName("dataSource")] public string? DataSource { get; set; }
    [JsonPropertyName("details")] public CampusDiscoveryDetailsDto Details { get; set; } = new();
    [JsonIgnore] public bool IsDemoData => string.Equals(DataSource, "DEV_FIXTURE", StringComparison.OrdinalIgnoreCase);
}

public sealed class CampusDiscoveryDetailsDto
{
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("floor")] public string? Floor { get; set; }
    [JsonPropertyName("roomNumber")] public string? RoomNumber { get; set; }
    [JsonPropertyName("capacity")] public int? Capacity { get; set; }
    [JsonPropertyName("latitude")] public double? Latitude { get; set; }
    [JsonPropertyName("longitude")] public double? Longitude { get; set; }
}

public sealed class ContributionDto
{
    [JsonPropertyName("_id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("campusId")] public string CampusId { get; set; } = "";
    [JsonPropertyName("targetModel")] public string TargetModel { get; set; } = "";
    [JsonPropertyName("targetId")] public string TargetId { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("proposedChanges")] public Dictionary<string, JsonElement> ProposedChanges { get; set; } = new();
    [JsonPropertyName("reviewNotes")] public string ReviewNotes { get; set; } = "";
    [JsonPropertyName("rewardPoints")] public int RewardPoints { get; set; }
    [JsonPropertyName("createdAt")] public DateTimeOffset? CreatedAt { get; set; }
}

public sealed class ContributionListDto
{
    [JsonPropertyName("results")] public List<ContributionDto> Results { get; set; } = new();
}

public sealed class SubmissionFileDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("originalName")] public string OriginalName { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "";
}

public sealed class SubmissionFileUploadResponseDto
{
    [JsonPropertyName("files")] public List<SubmissionFileDto> Files { get; set; } = new();
}

public sealed class CreateContributionRequest
{
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("campusId")] public string CampusId { get; set; } = "";
    [JsonPropertyName("targetModel")] public string TargetModel { get; set; } = "";
    [JsonPropertyName("targetId")] public string TargetId { get; set; } = "";
    [JsonPropertyName("proposedChanges")] public Dictionary<string, JsonElement> ProposedChanges { get; set; } = new();
    [JsonPropertyName("evidenceFileIds")] public List<string> EvidenceFileIds { get; set; } = new();
}