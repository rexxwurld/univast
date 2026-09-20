namespace UNIVAST.Mobile;

public partial class App : Application
{
    public App()
    {
        InitializeComponent();
    }

    // Application.MainPage is obsolete since .NET MAUI 9; the root page is now
    // supplied by creating the app's Window.
    protected override Window CreateWindow(IActivationState? activationState)
        => new Window(new AppShell());
}
