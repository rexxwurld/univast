namespace UNIVAST.Mobile;

public partial class MainPage : ContentPage
{
    public MainPage()
    {
        InitializeComponent();
    }

    private void Explore_Clicked(object sender, EventArgs e)
    {
        ExplorePanel.IsVisible = true;
        ExploreButton.IsVisible = false;
    }

    private void CloseExplore_Clicked(object sender, EventArgs e)
    {
        ExplorePanel.IsVisible = false;
        ExploreButton.IsVisible = true;
    }

    private async void Navigate_Clicked(object sender, EventArgs e)
    {
        await Shell.Current.GoToAsync(nameof(Pages.RoutePage));
    }
}