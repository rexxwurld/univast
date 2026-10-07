using System.Net.Http;
using System.Text.Json;

namespace UNIVAST.Mobile.Services;

/// <summary>Turns any exception into a short, friendly message. Raw exception text is never shown to users.</summary>
public static class CampusErrorMapper
{
    public static string ToUserMessage(Exception ex, string whatFailed = "load campus data")
    {
        switch (ex)
        {
            case UnivastApiException api when api.StatusCode == 404:
                return "We couldn't find that on the server. It may have been removed.";
            case UnivastApiException api when api.StatusCode == 401:
                return "Your session has expired. Please sign in again.";
            case UnivastApiException api when api.StatusCode == 403:
                return "You don't have access to that.";
            case UnivastApiException api when api.StatusCode == 429:
                return "Too many requests. Please wait a moment and try again.";
            case UnivastApiException api when api.StatusCode >= 500:
                return "The UNIVAST server had a problem. Please try again shortly.";
            case UnivastApiException api when api.StatusCode == 400 || api.StatusCode == 422:
                // The backend's own validation text is user-safe (see backend/middleware/errorHandler.js).
                return string.IsNullOrWhiteSpace(api.Message) ? $"Couldn't {whatFailed}." : api.Message;
            case UnivastApiException:
                return $"Couldn't {whatFailed}. Please try again.";
            case JsonException:
            case NotSupportedException:
                return "The server sent data the app couldn't read. Please try again later.";
            case HttpRequestException:
                return "No internet connection, or the server can't be reached. Check your connection and try again.";
            case OperationCanceledException:
            case TimeoutException:
                return "That took too long. Check your connection and try again.";
            default:
                return $"Couldn't {whatFailed}. Please try again.";
        }
    }

    /// <summary>
    /// Friendly wording for routing failures, chosen from the backend's stable error code (see
    /// backend/services/campusRoutingService.js). Unknown 422s keep the backend's own user-safe message.
    /// </summary>
    public static string ToRouteMessage(Exception ex)
    {
        if (ex is UnivastApiException api)
        {
            switch (api.Code)
            {
                case "DESTINATION_NOT_FOUND": return "We couldn't find that destination. It may have been removed.";
                case "ORIGIN_NOT_FOUND": return "We couldn't find that starting point.";
                case "DESTINATION_NOT_ROUTABLE": return "You can't be guided to this destination yet: its entrance isn't connected to the campus paths.";
                case "ENTRANCE_NOT_ROUTABLE":
                case "LANDMARK_NOT_ROUTABLE": return "That place isn't connected to the campus paths yet.";
                case "INDOOR_UNREACHABLE": return "The way inside to that room isn't mapped yet.";
                case "ROOM_NODE_MISSING": return "This room's location data is incomplete, so we can't guide you there yet.";
                case "NO_ROUTE": return "No walking route was found between these points.";
                case "NO_NAVIGATION_GRAPH": return "Walking directions aren't available for this campus yet.";
                case "CAMPUS_NOT_FOUND": return "We couldn't find this campus. Try choosing it again.";
            }
        }
        return ToUserMessage(ex, "get directions");
    }
}
