using System.Text.Json;
using SQLite;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Offline cache of /places/nearby results, kept in a local SQLite database. Unlike the
/// old single-slot Preferences blob, entries are keyed by map area + category, so going
/// offline after browsing two different neighbourhoods (or filtering by "Restaurants")
/// still shows the right places. Best effort: any failure just means "no cache".
/// </summary>
public static class NearbyPlacesCache
{
    private const int MaxEntries = 40;

    // ~2.2 km grid cells (0.02 degrees). Fetches from anywhere inside a cell share one row.
    private const double CellDegrees = 0.02;

    // When offline, use the closest cached area within ~5.5 km of the user.
    private const double MaxLoadDistanceDegrees = 0.05;

    private static readonly object Gate = new();
    private static SQLiteConnection? _db;

    /// <summary>Saves the results of a fetch centered on (lat, lng). Only unfiltered-by-text results should be cached.</summary>
    public static void Save(double latitude, double longitude, string? categoryId, List<PlaceDto> places)
    {
        try
        {
            lock (Gate)
            {
                var db = Db();
                db.InsertOrReplace(new CachedRegion
                {
                    Key = MakeKey(latitude, longitude, categoryId),
                    CategoryId = categoryId ?? string.Empty,
                    Latitude = latitude,
                    Longitude = longitude,
                    Json = JsonSerializer.Serialize(places),
                    SavedAtUtcTicks = DateTime.UtcNow.Ticks,
                });

                // Keep the table small: drop the oldest rows beyond MaxEntries.
                db.Execute(
                    "DELETE FROM cached_regions WHERE Key NOT IN " +
                    "(SELECT Key FROM cached_regions ORDER BY SavedAtUtcTicks DESC LIMIT ?)",
                    MaxEntries);
            }
        }
        catch (Exception)
        {
            // Caching is a best-effort convenience — a failed write shouldn't
            // surface as an error to the user.
        }
    }

    /// <summary>Closest cached result set for this category near (lat, lng), or null.</summary>
    public static List<PlaceDto>? Load(double latitude, double longitude, string? categoryId)
    {
        try
        {
            lock (Gate)
            {
                var category = categoryId ?? string.Empty;
                var nearest = Db()
                    .Table<CachedRegion>()
                    .Where(r => r.CategoryId == category)
                    .ToList()
                    .Where(r => Math.Abs(r.Latitude - latitude) <= MaxLoadDistanceDegrees
                             && Math.Abs(r.Longitude - longitude) <= MaxLoadDistanceDegrees)
                    .OrderBy(r => Math.Pow(r.Latitude - latitude, 2) + Math.Pow(r.Longitude - longitude, 2))
                    .FirstOrDefault();

                return nearest is null ? null : JsonSerializer.Deserialize<List<PlaceDto>>(nearest.Json);
            }
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static string MakeKey(double latitude, double longitude, string? categoryId)
    {
        var cellLat = (long)Math.Floor(latitude / CellDegrees);
        var cellLng = (long)Math.Floor(longitude / CellDegrees);
        return $"{cellLat}:{cellLng}:{categoryId ?? string.Empty}";
    }

    private static SQLiteConnection Db()
    {
        if (_db is null)
        {
            var path = Path.Combine(FileSystem.AppDataDirectory, "univast_cache.db3");
            _db = new SQLiteConnection(path);
            _db.CreateTable<CachedRegion>();

            // The previous implementation stored one blob in Preferences; clean it up.
            Preferences.Default.Remove("cached_nearby_places");
        }

        return _db;
    }
}

[Table("cached_regions")]
public class CachedRegion
{
    [PrimaryKey]
    public string Key { get; set; } = string.Empty;

    [Indexed]
    public string CategoryId { get; set; } = string.Empty;

    public double Latitude { get; set; }

    public double Longitude { get; set; }

    public string Json { get; set; } = string.Empty;

    public long SavedAtUtcTicks { get; set; }
}
