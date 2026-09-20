using System.Text.Json;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Stores favorited place ids in on-device Preferences. This is intentionally NOT
/// synced to the backend — there is no Favorite model/API yet (planned for Phase 5:
/// reviews/business accounts). It exists so the "Save" action on a place is a real,
/// working feature today rather than a button with no effect, but it will not
/// follow the user to a new device or survive an app uninstall/reinstall.
/// Replace this with a call to a real /api/v1/favorites endpoint once that exists.
/// </summary>
public static class LocalFavoritesStore
{
    private const string PrefsKey = "local_favorite_place_ids";

    public static List<string> GetAll()
    {
        var json = Preferences.Default.Get(PrefsKey, "[]");
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch (JsonException)
        {
            return new List<string>();
        }
    }

    public static bool IsFavorite(string placeId) => GetAll().Contains(placeId);

    public static void Toggle(string placeId)
    {
        var ids = GetAll();
        if (!ids.Remove(placeId))
        {
            ids.Add(placeId);
        }
        Preferences.Default.Set(PrefsKey, JsonSerializer.Serialize(ids));
    }
}
