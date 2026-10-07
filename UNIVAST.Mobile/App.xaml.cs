namespace UNIVAST.Mobile;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();

        // One light design system (Resources/Styles/Colors.xaml). Following the phone's dark mode would make the
        // stock controls turn dark while every screen's surfaces stay light, so the app stays light until a real
        // dark palette exists.
        UserAppTheme = AppTheme.Light;
    }

    // Application.MainPage is obsolete since .NET MAUI 9; the root page is now
    // supplied by creating the app's Window.
    protected override Window CreateWindow(IActivationState? activationState)
        => new Window(new AppShell());
}
