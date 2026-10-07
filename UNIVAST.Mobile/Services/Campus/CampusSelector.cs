using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

public enum CampusSelectionKind { NoCampuses, Selected, NeedsUserChoice }

public sealed record CampusSelection(CampusSelectionKind Kind, CampusSummaryDto? Campus, IReadOnlyList<CampusSummaryDto> Candidates, string Reason);

/// <summary>
/// Chooses which campus to open, using only the backend's geofence answers. Never invents a campus and
/// never picks one at random: when the data doesn't point to exactly one campus the user is asked.
/// </summary>
public static class CampusSelector
{
    /// <param name="campuses">Valid campuses from the backend.</param>
    /// <param name="locateResults">campusId -> /locate result for the device location (campuses that could not be checked are simply absent).</param>
    public static CampusSelection Decide(IReadOnlyList<CampusSummaryDto> campuses, IReadOnlyDictionary<string, CampusLocateResultDto> locateResults)
    {
        var valid = campuses.Where(c => c.IsValid).ToList();
        if (valid.Count == 0)
            return new(CampusSelectionKind.NoCampuses, null, Array.Empty<CampusSummaryDto>(), "The server returned no campuses.");

        List<CampusSummaryDto> WithStatus(string status) =>
            valid.Where(c => locateResults.TryGetValue(c.Id, out var r) && r.Status == status).ToList();

        var inside = WithStatus(CampusLocateResultDto.Inside);
        if (inside.Count == 1) return new(CampusSelectionKind.Selected, inside[0], inside, "Your location is inside this campus.");
        if (inside.Count > 1) return new(CampusSelectionKind.NeedsUserChoice, null, inside, "Your location is inside more than one campus.");

        var near = WithStatus(CampusLocateResultDto.Near);
        if (near.Count == 1) return new(CampusSelectionKind.Selected, near[0], near, "Your location is near this campus.");
        if (near.Count > 1) return new(CampusSelectionKind.NeedsUserChoice, null, near, "Your location is near more than one campus.");

        // No geofence match. A single available campus is a legitimate default (e.g. the development campus).
        if (valid.Count == 1) return new(CampusSelectionKind.Selected, valid[0], valid, "This is the only campus available.");

        return new(CampusSelectionKind.NeedsUserChoice, null, valid, "Choose a campus.");
    }
}
