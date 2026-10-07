using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SkiaSharp.Views.Maui.Controls.Hosting;
using UNIVAST.Mobile.Pages;
using UNIVAST.Mobile.Services;
using UNIVAST.Mobile.ViewModels;
#if MAUI_DEVFLOW
using Microsoft.Maui.DevFlow.Agent;
#endif

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

        // Borderless Entry so inputs sit cleanly inside our rounded containers.
        Microsoft.Maui.Handlers.EntryHandler.Mapper.AppendToMapping("NoUnderline", (handler, view) =>
        {
#if ANDROID
            handler.PlatformView.BackgroundTintList = Android.Content.Res.ColorStateList.ValueOf(Android.Graphics.Color.Transparent);
#elif IOS || MACCATALYST
            handler.PlatformView.BorderStyle = UIKit.UITextBorderStyle.None;
#endif
        });

        #if MAUI_DEVFLOW
            builder.AddMauiDevFlowAgent();
        #endif

        // Token storage must be a singleton: the auth handler and AuthService share it.
        builder.Services.AddSingleton<TokenStore>();
        builder.Services.AddSingleton<ITokenStore>(sp => sp.GetRequiredService<TokenStore>());

        // All typed API clients: base address, auth header + refresh, retries/timeouts.
        builder.Services.AddUnivastApiClients();

        // Campus-first map homepage (Phase 3): one location source for the app, one view model per page instance.
        builder.Services.AddSingleton<ILocationProvider, MauiLocationProvider>();
        // Existing places/businesses as an extra, optional "NEARBY PLACES" section of campus search results.
        builder.Services.AddTransient<IPlaceSearchApi, PlaceSearchAdapter>();
        builder.Services.AddTransient<CampusPackManager>();
        builder.Services.AddTransient<CampusMapViewModel>();

        builder.Services.AddTransient<LoginViewModel>();
        builder.Services.AddTransient<RegisterViewModel>();

        builder.Services.AddTransient<MainPage>();
        builder.Services.AddTransient<NearbyPlacesPage>();
        builder.Services.AddTransient<PlaceDetailPage>();
        builder.Services.AddTransient<LoginPage>();
        builder.Services.AddTransient<RegisterPage>();
        builder.Services.AddTransient<WriteReviewPage>();
        builder.Services.AddTransient<ClaimBusinessPage>();
        builder.Services.AddTransient<AddPlacePage>();
        builder.Services.AddTransient<CampusDiscoveryPage>();
        builder.Services.AddTransient<ContributionCenterPage>();

#if DEBUG
        builder.Logging.AddDebug();
#endif
        return builder.Build();
    }
}
