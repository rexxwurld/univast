using System.Text;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Input hygiene for the search box. Deliberately NOT a search engine: spelling variants, abbreviations and
/// aliases ("LT1" / "Lecture Theater 1") are resolved by the backend (backend/utils/campusText.js).
/// </summary>
public static class SearchQuery
{
    /// <summary>The backend rejects queries longer than this (campusDataController.search).</summary>
    public const int MaxLength = 100;

    /// <summary>Trims, collapses runs of whitespace to one space and caps the length. Case is left alone (the backend ignores it).</summary>
    public static string Normalize(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var sb = new StringBuilder(text.Length);
        var pendingSpace = false;
        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch)) { pendingSpace = sb.Length > 0; continue; }
            if (pendingSpace) { sb.Append(' '); pendingSpace = false; }
            sb.Append(ch);
            if (sb.Length >= MaxLength) break;
        }
        return sb.ToString().TrimEnd();
    }

    /// <summary>Cache key: same words in a different case or spacing are the same search.</summary>
    public static string CacheKey(string campusId, string normalizedQuery) =>
        campusId + "|" + normalizedQuery.ToLowerInvariant();
}

/// <summary>
/// Tiny in-memory cache of recent search responses (per campus). Short TTL so edits made by campus
/// editors show up soon; failures are never cached; cleared when the campus changes. Not an offline index.
/// </summary>
public sealed class SearchCache
{
    private readonly TimeProvider _time;
    private readonly int _capacity;
    private readonly Dictionary<string, (DateTimeOffset At, CampusSearchResponseDto Value)> _items = new();
    private readonly Queue<string> _order = new();

    public TimeSpan Ttl { get; set; } = TimeSpan.FromMinutes(2);

    public SearchCache(TimeProvider time, int capacity = 20)
    {
        _time = time;
        _capacity = capacity;
    }

    public bool TryGet(string key, out CampusSearchResponseDto value)
    {
        if (_items.TryGetValue(key, out var hit) && _time.GetUtcNow() - hit.At <= Ttl)
        {
            value = hit.Value;
            return true;
        }
        value = null!;
        return false;
    }

    public void Set(string key, CampusSearchResponseDto value)
    {
        if (!_items.ContainsKey(key))
        {
            _order.Enqueue(key);
            while (_order.Count > _capacity) _items.Remove(_order.Dequeue());
        }
        _items[key] = (_time.GetUtcNow(), value);
    }

    public void Clear()
    {
        _items.Clear();
        _order.Clear();
    }
}

/// <summary>Existing UNIVAST places/businesses (GET /api/v1/places/nearby) as extra search hits. Never throws for "no results".</summary>
public interface IPlaceSearchApi
{
    Task<IReadOnlyList<CampusSearchResultDto>> SearchAsync(double latitude, double longitude, string query, CancellationToken ct = default);
}

/// <summary>
/// Adapts the existing DiscoveryApiService (places/businesses, unchanged) to search hits of kind "place".
/// Coordinates come from the place's own stored location; the search origin is the selected CAMPUS's centre.
/// </summary>
public sealed class PlaceSearchAdapter : IPlaceSearchApi
{
    /// <summary>Same radius the original places screen used for "around here".</summary>
    public const double RadiusMeters = 3000;
    public const int MaxResults = 5;

    private readonly DiscoveryApiService _discovery;

    public PlaceSearchAdapter(DiscoveryApiService discovery) => _discovery = discovery;

    public async Task<IReadOnlyList<CampusSearchResultDto>> SearchAsync(double latitude, double longitude, string query, CancellationToken ct = default)
    {
        var places = await _discovery.GetNearbyAsync(latitude, longitude, RadiusMeters, categoryId: null, query: query, ct: ct);
        return places
            .Where(p => !string.IsNullOrWhiteSpace(p.Id) && !string.IsNullOrWhiteSpace(p.Name))
            .Take(MaxResults)
            .Select(p => new CampusSearchResultDto
            {
                Kind = "place",
                Id = p.Id,
                Name = p.Name,
                Category = p.Category?.Name,
                Description = p.Address,
                Latitude = p.Location.Coordinates.Length > 1 ? p.Location.Latitude : null,
                Longitude = p.Location.Coordinates.Length > 1 ? p.Location.Longitude : null,
            })
            .ToList();
    }
}

public static class DestinationHierarchy
{
    /// <summary>
    /// "University › Campus › Building › Floor" for the selected destination (the destination's own name is the
    /// sheet title, so it is not repeated). Only levels that are actually known are shown.
    /// </summary>
    public static string Trail(string? universityName, string? campusName, DestinationDetail? destination)
    {
        if (destination is null) return "";
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(universityName)) parts.Add(universityName!);
        if (!string.IsNullOrWhiteSpace(campusName)) parts.Add(campusName!);
        if (destination.Kind == DestinationKind.Room)
        {
            if (!string.IsNullOrWhiteSpace(destination.BuildingName)) parts.Add(destination.BuildingName!);
            if (!string.IsNullOrWhiteSpace(destination.FloorName)) parts.Add(destination.FloorName!);
        }
        return string.Join(" › ", parts);
    }
}
