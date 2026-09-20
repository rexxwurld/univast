namespace UNIVAST.Mobile.Models;

/// <summary>
/// Mirrors the response of POST /api/routes/nearest-node.
/// </summary>
public class NearestNodeResponse
{
    public NavigationNodeDto? Node { get; set; }

    /// <summary>Distance from the queried coordinate to Node, in meters.</summary>
    public double Distance { get; set; }
}
