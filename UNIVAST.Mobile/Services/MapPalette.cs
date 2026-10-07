using Mapsui.Styles;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Map marker colours. They are read from the app's colour tokens (Resources/Styles/Colors.xaml via
/// <see cref="UvColors"/>) so the map and the UI can never drift apart.
/// Hierarchy: UNIVAST data markers are neutral ink (shape tells building from landmark); the single accent colour
/// is reserved for "you", the selected place and the active route.
/// </summary>
public static class MapPalette
{
    private static Mapsui.Styles.Color From(string token, int? alpha = null)
    {
        var c = UvColors.Get(token);
        return new Mapsui.Styles.Color((int)Math.Round(c.Red * 255), (int)Math.Round(c.Green * 255), (int)Math.Round(c.Blue * 255), alpha ?? (int)Math.Round(c.Alpha * 255));
    }

    public static Mapsui.Styles.Color Outline => Mapsui.Styles.Color.White;

    /// <summary>Buildings, landmarks and UNIVAST places.</summary>
    public static Mapsui.Styles.Color Data => From("UvInk");
    /// <summary>Minor markers (entrances).</summary>
    public static Mapsui.Styles.Color Minor => From("UvMuted");
    /// <summary>The user's position, selected place and active route.</summary>
    public static Mapsui.Styles.Color Accent => From("UvBlue");
    public static Mapsui.Styles.Color AccentHalo => From("UvBlue", 45);
    public static Mapsui.Styles.Color AccentFill => From("UvBlue", 70);
}
