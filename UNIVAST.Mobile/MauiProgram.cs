using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SkiaSharp.Views.Maui.Controls.Hosting;
using UNIVAST.Mobile.Pages;
using UNIVAST.Mobile.Services;
using UNIVAST.Mobile.ViewModels;

namespace UNIVAST.Mobile;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();

        builder
            .UseMauiApp<App>()
            // Required by Mapsui.Maui — without this the app crashes as soon as a MapControl
            // is created (see https://mapsui.com/documentation/getting-started-maui.html).
            .UseSkiaSharp()
            .ConfigureFonts(fonts =>
            {
                fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
                fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
            });

        // Token storage must be a singleton: the auth handler and AuthService share it.
        builder.Services.AddSingleton<TokenStore>();

        // All typed API clients: base address, auth header + refresh, retries/timeouts.
        builder.Services.AddUnivastApiClients();

        builder.Services.AddTransient<LoginViewModel>();
        builder.Services.AddTransient<RegisterViewModel>();

        builder.Services.AddTransient<MainPage>();
        builder.Services.AddTransient<RoutePage>();
        builder.Services.AddTransient<PlaceDetailPage>();
        builder.Services.AddTransient<LoginPage>();
        builder.Services.AddTransient<RegisterPage>();
        builder.Services.AddTransient<WriteReviewPage>();
        builder.Services.AddTransient<ClaimBusinessPage>();

#if DEBUG
        builder.Logging.AddDebug();
#endif
        return builder.Build();
    }
}
