using System.Globalization;

namespace UNIVAST.Mobile.Services;

/// <summary>Human-friendly distance and time strings. Deterministic and culture-independent.</summary>
public static class NavigationFormat
{
    /// <summary>"8 m", "85 m", "1.2 km". Short distances are rounded to 5 m; no false precision.</summary>
    public static string Distance(double meters)
    {
        if (!double.IsFinite(meters) || meters < 0) meters = 0;
        var rounded = meters < 10 ? Math.Round(meters) : Math.Round(meters / 5) * 5;
        if (rounded < 1000) return rounded.ToString("0", CultureInfo.InvariantCulture) + " m";
        return (meters / 1000).ToString("0.0", CultureInfo.InvariantCulture) + " km";
    }

    /// <summary>"Less than 1 min", "4 min", "1 h 5 min". Always rounds up: better early than late.</summary>
    public static string Duration(double seconds)
    {
        if (!double.IsFinite(seconds) || seconds <= 0) return "Less than 1 min";
        var minutes = (int)Math.Ceiling(seconds / 60.0);
        if (minutes < 1) return "Less than 1 min";
        if (minutes < 60) return minutes.ToString(CultureInfo.InvariantCulture) + " min";
        var hours = minutes / 60;
        var rest = minutes % 60;
        return rest == 0 ? $"{hours} h" : $"{hours} h {rest} min";
    }

    /// <summary>Glyph for a backend maneuver (UI only; the instruction text carries the meaning).</summary>
    public static string ManeuverGlyph(string? maneuver) => maneuver switch
    {
        "depart" => "▶",
        "continue" => "↑",
        "slight_left" => "↖",
        "slight_right" => "↗",
        "turn_left" => "←",
        "turn_right" => "→",
        "sharp_left" => "↙",
        "sharp_right" => "↘",
        "u_turn" => "↩",
        "enter_building" => "⇥",
        "exit_building" => "⇤",
        "take_stairs" => "⇅",
        "take_ramp" => "⤴",
        "take_elevator" => "⇕",
        "arrive" => "⚑",
        _ => "•",
    };
}
