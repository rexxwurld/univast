using UNIVAST.Mobile.Services;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Pages;

[QueryProperty(nameof(CampusId), "campusId")]
[QueryProperty(nameof(CampusName), "campusName")]
public partial class CampusDiscoveryPage : ContentPage
{
    private readonly CampusDiscoveryApiService _api;
    private CancellationTokenSource? _searchCts;

    public string CampusId { get; set; } = "";
    public string CampusName { get; set; } = "";

    public CampusDiscoveryPage(CampusDiscoveryApiService api)
    {
        InitializeComponent();
        _api = api;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        if (!string.IsNullOrWhiteSpace(CampusName)) CampusTitle.Text = CampusName;
    }

    private async void Search_Clicked(object? sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(CampusId))
        {
            SetStatus("Choose a campus first.");
            return;
        }

        _searchCts?.Cancel();
        var cts = _searchCts = new CancellationTokenSource();
        BusyIndicator.IsVisible = BusyIndicator.IsRunning = true;
        StatusLabel.IsVisible = false;
        try
        {
            var response = await _api.SearchAsync(CampusId, QueryEntry.Text?.Trim() ?? "", cts.Token);
            ResultsList.ItemsSource = response.Items;
            CategoriesLabel.Text = response.CategoryNames.Count == 0
                ? ""
                : "Campus categories: " + string.Join(" · ", response.CategoryNames);
            if (response.Items.Count == 0) SetStatus("No matching campus locations.");
            else StatusLabel.IsVisible = false;
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            ResultsList.ItemsSource = null;
            SetStatus(CampusErrorMapper.ToUserMessage(ex, "search campus locations"));
        }
        finally
        {
            if (!cts.IsCancellationRequested)
                BusyIndicator.IsVisible = BusyIndicator.IsRunning = false;
        }
    }

    private void SetStatus(string text)
    {
        StatusLabel.Text = text;
        StatusLabel.IsVisible = true;
    }

    private async void SuggestCorrection_Clicked(object? sender, EventArgs e)
    {
        if ((sender as Button)?.BindingContext is not CampusDiscoveryItemDto item) return;
        var targetModel = item.Kind.ToLowerInvariant() switch
        {
            "building" => "Building",
            "floor" => "Floor",
            "room" => "Room",
            "entrance" => "Entrance",
            "landmark" => "Landmark",
            _ => null,
        };
        if (targetModel is null) return;

        await Shell.Current.GoToAsync($"{nameof(ContributionCenterPage)}?campusId={Uri.EscapeDataString(CampusId)}&campusName={Uri.EscapeDataString(CampusName)}&targetModel={targetModel}&targetId={Uri.EscapeDataString(item.Id)}&targetName={Uri.EscapeDataString(item.Name)}");
    }

    protected override void OnDisappearing()
    {
        _searchCts?.Cancel();
        base.OnDisappearing();
    }
}