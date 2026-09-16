namespace UNIVAST.Mobile.Services;

public static class ApiConfig
{
    /// <summary>
    /// Backend base URL.
    /// - The Android emulator cannot reach the host machine via "localhost" — it must use 10.0.2.2.
    /// - iOS simulator, Mac Catalyst, and Windows can reach the host machine via "localhost" directly.
    /// - A physical device needs your machine's LAN IP (e.g. "http://192.168.1.23:5000/") or a
    ///   deployed backend URL — localhost/10.0.2.2 will not work from a real phone.
    /// </summary>
    public static string BaseUrl =>
#if ANDROID
        "http://10.0.2.2:5000/";
#else
        "http://localhost:5000/";
#endif

    /// <summary>
    /// The campus to navigate on. Fill this in with a real Campus _id once you've created
    /// your first campus (e.g. University of Calabar (UNICAL) Main Campus) via the backend API.
    /// Left empty on purpose — populate it once a real campus + coordinates exist in the DB.
    /// </summary>
    public const string DefaultCampusId = "";
}
