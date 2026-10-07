using UNIVAST.Mobile.Pages;

namespace UNIVAST.Mobile;

public partial class AppShell : Shell
{
    public AppShell()
    {
        InitializeComponent();

        // Detail pages are pushed on top of the map (the only Shell content), so they are registered here.
        Routing.RegisterRoute(nameof(NearbyPlacesPage), typeof(NearbyPlacesPage));
        Routing.RegisterRoute(nameof(PlaceDetailPage), typeof(PlaceDetailPage));
        Routing.RegisterRoute(nameof(LoginPage), typeof(LoginPage));
        Routing.RegisterRoute(nameof(RegisterPage), typeof(RegisterPage));
        Routing.RegisterRoute(nameof(WriteReviewPage), typeof(WriteReviewPage));
        Routing.RegisterRoute(nameof(ClaimBusinessPage), typeof(ClaimBusinessPage));
        Routing.RegisterRoute(nameof(AddPlacePage), typeof(AddPlacePage));
        Routing.RegisterRoute(nameof(CampusDiscoveryPage), typeof(CampusDiscoveryPage));
        Routing.RegisterRoute(nameof(ContributionCenterPage), typeof(ContributionCenterPage));
    }
}
