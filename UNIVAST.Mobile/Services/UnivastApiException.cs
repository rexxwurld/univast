namespace UNIVAST.Mobile.Services;

/// <summary>
/// Thrown when the backend responds with a non-success status. Carries the status code and the
/// backend's own error message (see backend/middleware/errorHandler.js) so the UI can show
/// something more useful than a generic "request failed".
/// </summary>
public class UnivastApiException : Exception
{
    public int StatusCode { get; }

    /// <summary>
    /// Stable machine-readable error identifier from the backend (e.g. "NO_ROUTE", "DESTINATION_NOT_ROUTABLE"),
    /// when it sent one. Used to pick friendly wording; never shown to users.
    /// </summary>
    public string? Code { get; }

    public UnivastApiException(string message, int statusCode, string? code = null) : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }
}
