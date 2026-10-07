using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>The Phase 2 campus API as used by the map homepage (see CampusApiService).</summary>
public interface ICampusApi
{
    Task<List<CampusSummaryDto>> GetCampusesAsync(CancellationToken ct = default);
    Task<List<CampusBuildingDto>> GetBuildingsAsync(string campusId, CancellationToken ct = default);
    Task<List<CampusLandmarkDto>> GetLandmarksAsync(string campusId, CancellationToken ct = default);
    Task<CampusSearchResponseDto> SearchAsync(string campusId, string query, int limit = 20, CancellationToken ct = default);
    Task<CampusSearchResponseDto> GlobalSearchAsync(string query, int limit = 20, CancellationToken ct = default, bool includeGeo = false, double? nearLatitude = null, double? nearLongitude = null);
    Task<CampusPackVersionDto> GetPackVersionAsync(string campusId, CancellationToken ct = default);
    Task<CampusPackDto> GetPackAsync(string campusId, int? sinceVersion = null, CancellationToken ct = default);
    Task<CampusLocateResultDto> LocateAsync(string campusId, double latitude, double longitude, double? accuracyMeters, CancellationToken ct = default);
    Task<CampusBuildingDetailDto> GetBuildingAsync(string campusId, string buildingId, CancellationToken ct = default);
    Task<CampusRoomDetailDto> GetRoomAsync(string campusId, string roomId, CancellationToken ct = default);
    Task<CampusRouteResponseDto> RouteAsync(string campusId, CampusRouteFrom start, CampusRouteTo destination, CampusRouteOptions? options = null, CancellationToken ct = default);
}
