using UNIVAST.Mobile.Pages;

namespace UNIVAST.Mobile;

public partial class AppShell : Shell
{
    public AppShell()
    {
        InitializeComponent();

        // RoutePage is a pushed detail page, not a Shell tab, so it's registered here
        // rather than as a <ShellContent> in AppShell.xaml.
        Routing.RegisterRoute(nameof(RoutePage), typeof(RoutePage));
    }
}
