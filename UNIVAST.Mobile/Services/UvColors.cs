namespace UNIVAST.Mobile.Services;

/// <summary>
/// Looks the app's colours up by token name (Resources/Styles/Colors.xaml) for the few places that colour things
/// in code. There are no colour values in C# outside this fallback table, which only matters if a token is missing
/// (for example in unit tests without an Application).
/// </summary>
public static class UvColors
{
    private static readonly Dictionary<string, string> Fallback = new()
    {
        ["UvBlue"] = "#1F6FEB", ["UvBlueSoft"] = "#E8F0FE", ["UvBackground"] = "#F3F5F9", ["UvSurface"] = "#FFFFFF",
        ["UvHairline"] = "#E3E8EF", ["UvText"] = "#0B1F3A", ["UvMuted"] = "#5B6777", ["UvOnAccent"] = "#FFFFFF",
        ["UvInk"] = "#0B1F3A", ["UvSuccess"] = "#067647", ["UvWarning"] = "#B54708", ["UvDanger"] = "#D92D20",
    };

    public static Color Get(string token)
    {
        if (Application.Current?.Resources.TryGetValue(token, out var value) == true && value is Color color)
            return color;
        return Color.FromArgb(Fallback.TryGetValue(token, out var hex) ? hex : "#0B1F3A");
    }
}
