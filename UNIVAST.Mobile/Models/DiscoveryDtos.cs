using System.Text.Json.Serialization;

namespace UNIVAST.Mobile.Models;

public class CategoryDto
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("slug")]
    public string Slug { get; set; } = "";

    [JsonPropertyName("icon")]
    public string? Icon { get; set; }
}

public class PlaceLocationDto
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "Point";

    /// <summary>GeoJSON order: [longitude, latitude].</summary>
    [JsonPropertyName("coordinates")]
    public double[] Coordinates { get; set; } = new double[2];

    public double Longitude => Coordinates.Length > 0 ? Coordinates[0] : 0;
    public double Latitude => Coordinates.Length > 1 ? Coordinates[1] : 0;
}

public class PlaceDto
{
    [JsonPropertyName("_id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("address")]
    public string? Address { get; set; }

    [JsonPropertyName("phone")]
    public string? Phone { get; set; }

    [JsonPropertyName("website")]
    public string? Website { get; set; }

    [JsonPropertyName("location")]
    public PlaceLocationDto Location { get; set; } = new();

    [JsonPropertyName("category")]
    public CategoryDto? Category { get; set; }

    [JsonPropertyName("ratingAvg")]
    public double RatingAvg { get; set; }

    [JsonPropertyName("ratingCount")]
    public int RatingCount { get; set; }

    /// <summary>Set only for places generated from the Campus migration (Phase 1) — see
    /// backend/scripts/migrateCampusesToPlaces.js. Non-null here means this place's
    /// campus has a real indoor/outdoor navigation graph (Phase 7 reintroduces it).</summary>
    [JsonPropertyName("sourceCampusId")]
    public string? SourceCampusId { get; set; }

    /// <summary>Only populated by /places/nearby (a $geoNear aggregation field) — null for /places list/detail.</summary>
    [JsonPropertyName("distanceMeters")]
    public double? DistanceMeters { get; set; }
}

public class PaginationInfo
{
    [JsonPropertyName("page")]
    public int Page { get; set; }

    [JsonPropertyName("limit")]
    public int Limit { get; set; }

    [JsonPropertyName("hasNextPage")]
    public bool HasNextPage { get; set; }
}

public class PagedPlacesResponse
{
    [JsonPropertyName("data")]
    public List<PlaceDto> Data { get; set; } = new();

    [JsonPropertyName("pagination")]
    public PaginationInfo Pagination { get; set; } = new();
}
