namespace UNIVAST.Mobile.Services;

public static class ApiConfig
{
    // true  = use the Render backend (Debug and Release)
    // false = use the backend on your PC (Debug only)
    private const bool UseRender = true;

    private const string RenderUrl = "https://univast-q4tg.onrender.com";

#if DEBUG
    private const string DevMachineLanHost = "192.168.1.164";
    private const int DevPort = 5000;

    public static string BaseUrl
    {
        get
        {
            if (UseRender) return RenderUrl;

            var host = DevMachineLanHost;

            if (DeviceInfo.Current.DeviceType == DeviceType.Virtual)
            {
                host = DeviceInfo.Current.Platform == DevicePlatform.Android ? "10.0.2.2" : "localhost";
            }

            return $"http://{host}:{DevPort}";
        }
    }
#else
    public static string BaseUrl => RenderUrl;
#endif

    public const string DefaultCampusId = "6aac49c6d04bfe80e72af078";
}
