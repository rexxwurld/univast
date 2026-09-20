namespace UNIVAST.Mobile.Services;

/// <summary>
/// Thrown when the backend responds with a non-success status. Carries the status code and the
/// backend's own error message (see backend/middleware/errorHandler.js) so the UI can show
/// something more useful than a generic "request failed".
/// </summary>
public class UnivastApiException : Exception
{
    public int StatusCode { get; }

    public UnivastApiException(string message, int statusCode) : base(message)
    {
        StatusCode = statusCode;
    }
}
