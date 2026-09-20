namespace UNIVAST.Mobile.Services;

public static class ApiConfig
{
#if DEBUG
    // ---- Development ----------------------------------------------------------------
    // A physical phone reaches your PC over Wi-Fi: set this to the PC's LAN IP
    // (run `ipconfig` / `ifconfig`). Phone and PC must be on the same network.
    private const string DevMachineLanHost = "192.168.1.164";

    private const int DevPort = 5000;

    /// <summary>
    /// Debug builds talk to the backend on the developer machine:
    /// - Android emulator: 10.0.2.2 is the emulator's alias for the host's localhost.
    /// - iOS simulator: shares the Mac's network, so localhost works.
    /// - Any physical device (or Windows / Mac Catalyst): the PC's LAN IP above.
    /// Plain HTTP is only allowed in DEBUG (see Platforms/Android/MainApplication.cs).
    /// </summary>
    public static string BaseUrl
    {
        get
        {
            var host = DevMachineLanHost;

            if (DeviceInfo.Current.DeviceType == DeviceType.Virtual)
            {
                host = DeviceInfo.Current.Platform == DevicePlatform.Android ? "10.0.2.2" : "localhost";
            }

            return $"http://{host}:{DevPort}";
        }
    }
#else
    // ---- Production -----------------------------------------------------------------
    // TODO: replace with your deployed backend's HTTPS URL before building a Release
    // (store) build. Release builds refuse plain HTTP on Android.
    public static string BaseUrl => "https://univast-q4tg.onrender.com";
#endif

    /// <summary>
    /// The campus to navigate on. Fill this in with a real Campus _id once you've created
    /// your first campus (e.g. University of Calabar (UNICAL) Main Campus) via the backend API.
    /// </summary>
    public const string DefaultCampusId = "6aac49c6d04bfe80e72af078";
}
