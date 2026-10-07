namespace UNIVAST.Mobile.Services;

/// <summary>
/// Sent (CommunityToolkit WeakReferenceMessenger) by detail pages that want the map to show a campus — for example a
/// place that belongs to a campus. The map opens that campus for viewing (no check-in, no need to be there) and
/// optionally centres on the given point. Replaces the old stand-alone node-picker route page.
/// </summary>
public sealed record ViewCampusOnMapMessage(string CampusId, double? Latitude, double? Longitude);
