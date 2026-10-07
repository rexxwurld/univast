using Android.App;
using Android.Runtime;

namespace UNIVAST.Mobile;

// Cleartext (http://) traffic is allowed in Debug only, so a dev machine on the LAN
// works. Release builds must use HTTPS. (Android's default is to block cleartext.)
#if DEBUG
[Application(UsesCleartextTraffic = true)]
#else
[Application]
#endif
public class MainApplication : MauiApplication
{
	public MainApplication(IntPtr handle, JniHandleOwnership ownership)
		: base(handle, ownership)
	{
	}

	protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}
