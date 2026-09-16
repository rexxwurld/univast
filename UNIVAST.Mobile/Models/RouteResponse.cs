namespace UNIVAST.Mobile.Models;

/// <summary>
/// Mirrors the response of POST /api/routes/route (see services/routingService.js).
/// </summary>
public class RouteResponse
{
    /// <summary>Total walking distance in meters.</summary>
    public double Distance { get; set; }

    public List<string> NodeIds { get; set; } = new();

    /// <summary>The nodes along the route, in walking order.</summary>
    public List<NavigationNodeDto> Nodes { get; set; } = new();
}
